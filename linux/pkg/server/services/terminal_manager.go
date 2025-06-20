package services

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/vibetunnel/linux/pkg/session"
	"github.com/vibetunnel/linux/pkg/terminal"
	"github.com/vibetunnel/linux/pkg/termsocket"
)

// TerminalManager handles terminal session management
type TerminalManager struct {
	sessionManager      *session.Manager
	noSpawn             bool
	doNotAllowColumnSet bool
	bufferCallbacks     map[string][]func([]byte)
	mu                  sync.RWMutex
}

// NewTerminalManager creates a new terminal manager service
func NewTerminalManager(sessionManager *session.Manager) *TerminalManager {
	return &TerminalManager{
		sessionManager:  sessionManager,
		bufferCallbacks: make(map[string][]func([]byte)),
	}
}

// SetNoSpawn configures whether terminal spawning is allowed
func (tm *TerminalManager) SetNoSpawn(noSpawn bool) {
	tm.noSpawn = noSpawn
}

// SetDoNotAllowColumnSet configures whether terminal resizing is allowed
func (tm *TerminalManager) SetDoNotAllowColumnSet(doNotAllowColumnSet bool) {
	tm.doNotAllowColumnSet = doNotAllowColumnSet
	tm.sessionManager.SetDoNotAllowColumnSet(doNotAllowColumnSet)
}

// CreateSession creates a new terminal session
func (tm *TerminalManager) CreateSession(config SessionConfig) (*session.Session, error) {
	sessionConfig := session.Config{
		Name:      config.Name,
		Cmdline:   config.Command,
		Cwd:       config.WorkingDir,
		Width:     config.Cols,
		Height:    config.Rows,
		IsSpawned: config.SpawnTerminal,
	}

	// Process working directory
	cwd := tm.processWorkingDirectory(config.WorkingDir)
	sessionConfig.Cwd = cwd

	// Set default dimensions if not provided
	if sessionConfig.Width <= 0 {
		sessionConfig.Width = 120
	}
	if sessionConfig.Height <= 0 {
		sessionConfig.Height = 30
	}

	if config.SpawnTerminal && !tm.noSpawn {
		return tm.createSpawnedSession(sessionConfig, config.Term)
	}

	// Create regular (detached) session
	sess, err := tm.sessionManager.CreateSession(sessionConfig)
	if err != nil {
		return nil, err
	}
	
	// Add buffer change callback
	sess.AddBufferChangeCallback(func(sessionID string) {
		tm.NotifyBufferChange(sessionID)
	})
	
	return sess, nil
}

// createSpawnedSession creates a session that will be spawned in a terminal
func (tm *TerminalManager) createSpawnedSession(config session.Config, terminalType string) (*session.Session, error) {
	// Try to use the Mac app's terminal spawn service first
	if conn, err := termsocket.TryConnect(""); err == nil {
		defer conn.Close()

		sessionID := session.GenerateID()
		vtPath := tm.findVTBinary()
		if vtPath == "" {
			return nil, fmt.Errorf("vibetunnel binary not found")
		}

		// Format spawn request for Mac app
		spawnReq := &termsocket.SpawnRequest{
			Command:    termsocket.FormatCommand(sessionID, vtPath, config.Cmdline),
			WorkingDir: config.Cwd,
			SessionID:  sessionID,
			TTYFwdPath: vtPath,
			Terminal:   terminalType,
		}

		// Create session with specific ID
		sess, err := tm.sessionManager.CreateSessionWithID(sessionID, config)
		if err != nil {
			return nil, fmt.Errorf("failed to create session: %w", err)
		}

		// Send spawn request to Mac app
		resp, err := termsocket.SendSpawnRequest(conn, spawnReq)
		if err != nil {
			tm.sessionManager.RemoveSession(sess.ID)
			return nil, fmt.Errorf("failed to send terminal spawn request: %w", err)
		}

		if !resp.Success {
			tm.sessionManager.RemoveSession(sess.ID)
			errorMsg := resp.Error
			if errorMsg == "" {
				errorMsg = "Unknown error"
			}
			return nil, fmt.Errorf("terminal spawn failed: %s", errorMsg)
		}

		log.Printf("[INFO] Successfully spawned terminal session via Mac app: %s", sessionID)
		
		// Add buffer change callback
		sess.AddBufferChangeCallback(func(sessionID string) {
			tm.NotifyBufferChange(sessionID)
		})
		
		return sess, nil
	}

	// Fallback to native terminal spawning
	log.Printf("[INFO] Mac app socket not available, falling back to native terminal spawn")

	sess, err := tm.sessionManager.CreateSession(config)
	if err != nil {
		return nil, err
	}
	
	// Add buffer change callback
	sess.AddBufferChangeCallback(func(sessionID string) {
		tm.NotifyBufferChange(sessionID)
	})

	vtPath := tm.findVTBinary()
	if vtPath == "" {
		tm.sessionManager.RemoveSession(sess.ID)
		return nil, fmt.Errorf("vibetunnel binary not found")
	}

	// Spawn terminal using native method
	if err := terminal.SpawnInTerminal(sess.ID, vtPath, config.Cmdline, config.Cwd); err != nil {
		tm.sessionManager.RemoveSession(sess.ID)
		return nil, fmt.Errorf("failed to spawn terminal: %w", err)
	}

	log.Printf("[INFO] Successfully spawned terminal session natively: %s", sess.ID)
	return sess, nil
}

// processWorkingDirectory handles working directory expansion and validation
func (tm *TerminalManager) processWorkingDirectory(cwd string) string {
	if cwd == "" {
		homeDir, _ := os.UserHomeDir()
		return homeDir
	}

	// Expand ~ in working directory
	if cwd[0] == '~' {
		if cwd == "~" || len(cwd) >= 2 && cwd[:2] == "~/" {
			homeDir, err := os.UserHomeDir()
			if err == nil {
				if cwd == "~" {
					cwd = homeDir
				} else {
					cwd = filepath.Join(homeDir, cwd[2:])
				}
			}
		}
	}

	// Validate the working directory exists
	if _, err := os.Stat(cwd); err != nil {
		log.Printf("[WARN] Working directory '%s' not accessible: %v. Using home directory instead.", cwd, err)
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("[ERROR] Failed to get home directory: %v", err)
			return ""
		}
		return homeDir
	}

	return cwd
}

// findVTBinary locates the vibetunnel Go binary
func (tm *TerminalManager) findVTBinary() string {
	// Get the directory of the current executable
	execPath, err := os.Executable()
	if err == nil {
		return execPath
	}

	// Check common locations
	paths := []string{
		"/Applications/VibeTunnel.app/Contents/Resources/vibetunnel",
		"./linux/cmd/vibetunnel/vibetunnel",
		"../linux/cmd/vibetunnel/vibetunnel",
		"../../linux/cmd/vibetunnel/vibetunnel",
		"./vibetunnel",
		"../vibetunnel",
		"/usr/local/bin/vibetunnel",
	}

	for _, path := range paths {
		if _, err := os.Stat(path); err == nil {
			absPath, _ := filepath.Abs(path)
			return absPath
		}
	}

	// Try to find in PATH
	if path, err := exec.LookPath("vibetunnel"); err == nil {
		return path
	}

	return ""
}

// ResizeSession handles terminal resize requests
func (tm *TerminalManager) ResizeSession(sessionID string, cols, rows int) error {
	if tm.doNotAllowColumnSet {
		return fmt.Errorf("terminal resizing is disabled by server configuration")
	}

	sess, err := tm.sessionManager.GetSession(sessionID)
	if err != nil {
		return err
	}

	return sess.Resize(cols, rows)
}

// GetBufferSnapshot gets a snapshot of the terminal buffer for a session
func (tm *TerminalManager) GetBufferSnapshot(sessionID string) ([]byte, error) {
	sess, err := tm.sessionManager.GetSession(sessionID)
	if err != nil {
		return nil, err
	}

	// Get terminal buffer from session
	buffer := sess.GetTerminalBuffer()
	if buffer == nil {
		return nil, fmt.Errorf("no terminal buffer available")
	}

	// Get snapshot and encode it
	snapshot := buffer.GetSnapshot()
	return snapshot.SerializeToBinary(), nil
}


// SubscribeToBufferChanges subscribes to buffer changes for a session
func (tm *TerminalManager) SubscribeToBufferChanges(sessionID string, callback func([]byte)) func() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	// Add callback to list
	tm.bufferCallbacks[sessionID] = append(tm.bufferCallbacks[sessionID], callback)

	// Return unsubscribe function
	return func() {
		tm.mu.Lock()
		defer tm.mu.Unlock()

		callbacks := tm.bufferCallbacks[sessionID]
		newCallbacks := []func([]byte){}
		for _, cb := range callbacks {
			if &cb != &callback {
				newCallbacks = append(newCallbacks, cb)
			}
		}
		tm.bufferCallbacks[sessionID] = newCallbacks

		if len(newCallbacks) == 0 {
			delete(tm.bufferCallbacks, sessionID)
		}
	}
}

// NotifyBufferChange notifies all subscribers of a buffer change
func (tm *TerminalManager) NotifyBufferChange(sessionID string) {
	tm.mu.RLock()
	callbacks := tm.bufferCallbacks[sessionID]
	tm.mu.RUnlock()

	if len(callbacks) == 0 {
		return
	}

	// Get encoded buffer snapshot
	buffer, err := tm.GetBufferSnapshot(sessionID)
	if err != nil {
		return
	}

	// Notify all callbacks
	for _, callback := range callbacks {
		callback(buffer)
	}
}

// SessionConfig represents configuration for creating a session
type SessionConfig struct {
	Name          string
	Command       []string
	WorkingDir    string
	Cols          int
	Rows          int
	SpawnTerminal bool
	Term          string
}
