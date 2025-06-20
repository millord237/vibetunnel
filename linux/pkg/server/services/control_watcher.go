package services

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/vibetunnel/linux/pkg/session"
)

// ControlDirectoryWatcher watches the control directory for changes
type ControlDirectoryWatcher struct {
	controlPath     string
	sessionManager  *session.Manager
	streamWatcher   *StreamWatcher
	watcher         *fsnotify.Watcher
	stopChan        chan struct{}
	mu              sync.RWMutex
	watchedSessions map[string]bool
}

// NewControlDirectoryWatcher creates a new control directory watcher
func NewControlDirectoryWatcher(controlPath string, sessionManager *session.Manager, streamWatcher *StreamWatcher) (*ControlDirectoryWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	cdw := &ControlDirectoryWatcher{
		controlPath:     controlPath,
		sessionManager:  sessionManager,
		streamWatcher:   streamWatcher,
		watcher:         watcher,
		stopChan:        make(chan struct{}),
		watchedSessions: make(map[string]bool),
	}

	// Watch the control directory
	if err := watcher.Add(controlPath); err != nil {
		watcher.Close()
		return nil, err
	}

	// Start watching existing session directories
	if err := cdw.scanExistingSessions(); err != nil {
		log.Printf("[ControlWatcher] Error scanning existing sessions: %v", err)
	}

	return cdw, nil
}

// Start begins watching for control directory changes
func (cdw *ControlDirectoryWatcher) Start() {
	go cdw.watch()
}

// Stop stops the watcher
func (cdw *ControlDirectoryWatcher) Stop() {
	close(cdw.stopChan)
	cdw.watcher.Close()
}

// watch is the main watch loop
func (cdw *ControlDirectoryWatcher) watch() {
	debounceTimer := time.NewTimer(0)
	<-debounceTimer.C // Drain initial timer

	pendingScans := make(map[string]bool)
	
	for {
		select {
		case event, ok := <-cdw.watcher.Events:
			if !ok {
				return
			}

			// Handle different event types
			switch {
			case event.Op&fsnotify.Create == fsnotify.Create:
				if cdw.isSessionDirectory(event.Name) {
					log.Printf("[ControlWatcher] New session directory created: %s", filepath.Base(event.Name))
					pendingScans[event.Name] = true
					debounceTimer.Reset(100 * time.Millisecond)
				}

			case event.Op&fsnotify.Write == fsnotify.Write:
				// Check if it's a stream-out file
				if strings.HasSuffix(event.Name, "/stream-out") {
					sessionID := filepath.Base(filepath.Dir(event.Name))
					cdw.handleStreamUpdate(sessionID)
				}

			case event.Op&fsnotify.Remove == fsnotify.Remove:
				if cdw.isSessionDirectory(event.Name) {
					sessionID := filepath.Base(event.Name)
					log.Printf("[ControlWatcher] Session directory removed: %s", sessionID)
					cdw.removeSessionWatch(sessionID)
				}
			}

		case err, ok := <-cdw.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("[ControlWatcher] Watch error: %v", err)

		case <-debounceTimer.C:
			// Process pending scans
			for path := range pendingScans {
				sessionID := filepath.Base(path)
				if err := cdw.watchSessionDirectory(sessionID); err != nil {
					log.Printf("[ControlWatcher] Failed to watch session %s: %v", sessionID, err)
				}
			}
			pendingScans = make(map[string]bool)

		case <-cdw.stopChan:
			return
		}
	}
}

// scanExistingSessions scans for existing session directories
func (cdw *ControlDirectoryWatcher) scanExistingSessions() error {
	entries, err := ioutil.ReadDir(cdw.controlPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() && cdw.isValidSessionID(entry.Name()) {
			if err := cdw.watchSessionDirectory(entry.Name()); err != nil {
				log.Printf("[ControlWatcher] Failed to watch existing session %s: %v", entry.Name(), err)
			}
		}
	}

	return nil
}

// watchSessionDirectory starts watching a specific session directory
func (cdw *ControlDirectoryWatcher) watchSessionDirectory(sessionID string) error {
	cdw.mu.Lock()
	if cdw.watchedSessions[sessionID] {
		cdw.mu.Unlock()
		return nil // Already watching
	}
	cdw.watchedSessions[sessionID] = true
	cdw.mu.Unlock()

	sessionPath := filepath.Join(cdw.controlPath, sessionID)
	
	// Add the session directory to the watcher
	if err := cdw.watcher.Add(sessionPath); err != nil {
		cdw.mu.Lock()
		delete(cdw.watchedSessions, sessionID)
		cdw.mu.Unlock()
		return err
	}

	// Check if info.json exists
	infoPath := filepath.Join(sessionPath, "info.json")
	if _, err := os.Stat(infoPath); err == nil {
		// Session already registered, just ensure we're watching the stream
		streamPath := filepath.Join(sessionPath, "stream-out")
		if _, err := os.Stat(streamPath); err == nil {
			// Let StreamWatcher handle the file watching through AddClient
		}
	} else {
		// New session, wait for info.json
		log.Printf("[ControlWatcher] Waiting for info.json for session %s", sessionID)
		go cdw.waitForSessionInfo(sessionID)
	}

	return nil
}

// waitForSessionInfo waits for a session's info.json file to be created
func (cdw *ControlDirectoryWatcher) waitForSessionInfo(sessionID string) {
	sessionPath := filepath.Join(cdw.controlPath, sessionID)
	infoPath := filepath.Join(sessionPath, "info.json")

	// Poll for info.json (max 5 seconds)
	for i := 0; i < 50; i++ {
		if _, err := os.Stat(infoPath); err == nil {
			// info.json exists, load the session
			if err := cdw.loadSession(sessionID); err != nil {
				log.Printf("[ControlWatcher] Failed to load session %s: %v", sessionID, err)
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}

	log.Printf("[ControlWatcher] Timeout waiting for info.json for session %s", sessionID)
}

// loadSession loads a session from disk
func (cdw *ControlDirectoryWatcher) loadSession(sessionID string) error {
	// Check if session already exists
	if _, err := cdw.sessionManager.GetSession(sessionID); err == nil {
		// Session already loaded
		return nil
	}

	sessionPath := filepath.Join(cdw.controlPath, sessionID)
	infoPath := filepath.Join(sessionPath, "info.json")

	// Read session info
	data, err := ioutil.ReadFile(infoPath)
	if err != nil {
		return err
	}

	var info session.RustSessionInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return err
	}

	// Register the session with the manager
	if err := cdw.sessionManager.LoadSessionFromDisk(sessionID); err != nil {
		return err
	}

	log.Printf("[ControlWatcher] Loaded session %s from disk", sessionID)

	// Start watching the stream file
	streamPath := filepath.Join(sessionPath, "stream-out")
	if _, err := os.Stat(streamPath); err == nil {
		// Let StreamWatcher handle the file watching through AddClient
	}

	return nil
}

// handleStreamUpdate handles updates to a session's stream file
func (cdw *ControlDirectoryWatcher) handleStreamUpdate(sessionID string) {
	// The stream watcher will handle the actual streaming
	// We just need to ensure the session is loaded
	if _, err := cdw.sessionManager.GetSession(sessionID); err != nil {
		// Try to load the session
		if err := cdw.loadSession(sessionID); err != nil {
			log.Printf("[ControlWatcher] Failed to load session %s on stream update: %v", sessionID, err)
		}
	}
}

// removeSessionWatch removes a session from being watched
func (cdw *ControlDirectoryWatcher) removeSessionWatch(sessionID string) {
	cdw.mu.Lock()
	delete(cdw.watchedSessions, sessionID)
	cdw.mu.Unlock()

	// Remove from watcher
	sessionPath := filepath.Join(cdw.controlPath, sessionID)
	cdw.watcher.Remove(sessionPath)

	// Stop watching the stream
	cdw.streamWatcher.StopWatching(sessionID)
}

// isSessionDirectory checks if a path is a session directory
func (cdw *ControlDirectoryWatcher) isSessionDirectory(path string) bool {
	base := filepath.Base(path)
	return cdw.isValidSessionID(base) && filepath.Dir(path) == cdw.controlPath
}

// isValidSessionID checks if a string looks like a valid session ID (UUID)
func (cdw *ControlDirectoryWatcher) isValidSessionID(id string) bool {
	// Basic UUID format check
	if len(id) != 36 {
		return false
	}
	
	// Check for hyphens in the right places
	if id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		return false
	}
	
	return true
}