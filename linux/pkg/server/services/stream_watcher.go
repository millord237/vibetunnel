package services

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// StreamClient represents an SSE client connection
type StreamClient struct {
	Writer   http.ResponseWriter
	Flusher  http.Flusher
	Done     chan bool
}

// StreamWatcher watches files and streams updates to SSE clients
type StreamWatcher struct {
	mu       sync.RWMutex
	clients  map[string][]*StreamClient // sessionID -> clients
	watchers map[string]*FileWatcher     // sessionID -> watcher
}

// FileWatcher watches a single file for changes
type FileWatcher struct {
	sessionID string
	filePath  string
	clients   []*StreamClient
	stopChan  chan bool
	position  int64
}

// NewStreamWatcher creates a new stream watcher
func NewStreamWatcher() *StreamWatcher {
	return &StreamWatcher{
		clients:  make(map[string][]*StreamClient),
		watchers: make(map[string]*FileWatcher),
	}
}

// AddClient adds a new SSE client for a session
func (sw *StreamWatcher) AddClient(sessionID, streamPath string, w http.ResponseWriter) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	client := &StreamClient{
		Writer:  w,
		Flusher: flusher,
		Done:    make(chan bool),
	}

	sw.mu.Lock()
	sw.clients[sessionID] = append(sw.clients[sessionID], client)

	// Start file watcher if not already running
	if _, exists := sw.watchers[sessionID]; !exists {
		watcher := &FileWatcher{
			sessionID: sessionID,
			filePath:  streamPath,
			clients:   sw.clients[sessionID],
			stopChan:  make(chan bool),
			position:  0,
		}
		sw.watchers[sessionID] = watcher
		go sw.watchFile(sessionID, watcher)
	}
	sw.mu.Unlock()

	// Send existing content
	sw.sendExistingContent(client, streamPath)
}

// RemoveClient removes an SSE client
func (sw *StreamWatcher) RemoveClient(sessionID string, w http.ResponseWriter) {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	clients := sw.clients[sessionID]
	newClients := []*StreamClient{}

	for _, client := range clients {
		if client.Writer != w {
			newClients = append(newClients, client)
		} else {
			close(client.Done)
		}
	}

	if len(newClients) == 0 {
		delete(sw.clients, sessionID)
		// Stop watcher if no more clients
		if watcher, exists := sw.watchers[sessionID]; exists {
			close(watcher.stopChan)
			delete(sw.watchers, sessionID)
		}
	} else {
		sw.clients[sessionID] = newClients
	}
}

// sendExistingContent sends the current file content to a new client
func (sw *StreamWatcher) sendExistingContent(client *StreamClient, filePath string) {
	file, err := os.Open(filePath)
	if err != nil {
		log.Printf("[STREAM] Error opening file %s: %v", filePath, err)
		return
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err != io.EOF {
				log.Printf("[STREAM] Error reading file: %v", err)
			}
			break
		}

		sw.sendToClient(client, line)
	}
}

// watchFile watches a file for changes and streams to clients
func (sw *StreamWatcher) watchFile(sessionID string, watcher *FileWatcher) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-watcher.stopChan:
			log.Printf("[STREAM] Stopping watcher for session %s", sessionID)
			return

		case <-ticker.C:
			sw.checkFileChanges(sessionID, watcher)
		}
	}
}

// checkFileChanges checks for new content in the file
func (sw *StreamWatcher) checkFileChanges(sessionID string, watcher *FileWatcher) {
	file, err := os.Open(watcher.filePath)
	if err != nil {
		return
	}
	defer file.Close()

	// Seek to last position
	_, err = file.Seek(watcher.position, 0)
	if err != nil {
		return
	}

	reader := bufio.NewReader(file)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err != io.EOF {
				log.Printf("[STREAM] Error reading file: %v", err)
			}
			break
		}

		// Update position
		watcher.position += int64(len(line))

		// Send to all clients
		sw.mu.RLock()
		clients := sw.clients[sessionID]
		sw.mu.RUnlock()

		for _, client := range clients {
			sw.sendToClient(client, line)
		}
	}
}

// sendToClient sends data to a specific SSE client
func (sw *StreamWatcher) sendToClient(client *StreamClient, data []byte) {
	// Encode as base64 for SSE
	encoded := base64.StdEncoding.EncodeToString(data)
	
	// Send as SSE event
	fmt.Fprintf(client.Writer, "data: %s\n\n", encoded)
	client.Flusher.Flush()
}
// Stop stops all stream watchers
func (sw *StreamWatcher) Stop() {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	
	// Stop all watchers
	for _, watcher := range sw.watchers {
		if watcher.stopChan != nil {
			close(watcher.stopChan)
		}
	}
	
	// Clear maps
	sw.watchers = make(map[string]*FileWatcher)
	sw.clients = make(map[string][]*StreamClient)
}

// StopWatching stops watching a specific session
func (sw *StreamWatcher) StopWatching(sessionID string) {
	sw.mu.Lock()
	defer sw.mu.Unlock()
	
	if watcher, exists := sw.watchers[sessionID]; exists {
		if watcher.stopChan != nil {
			close(watcher.stopChan)
		}
		delete(sw.watchers, sessionID)
	}
	
	delete(sw.clients, sessionID)
}