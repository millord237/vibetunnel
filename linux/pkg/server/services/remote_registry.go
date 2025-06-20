package services

import (
	"fmt"
	"sync"
)

// RemoteServer represents a registered remote server
type RemoteServer struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	URL        string   `json:"url"`
	Token      string   `json:"token"`
	SessionIDs []string `json:"sessionIds"`
}

// RemoteRegistry manages registered remote servers (for HQ mode)
type RemoteRegistry struct {
	mu        sync.RWMutex
	remotes   map[string]*RemoteServer
	remoteSeq int
}

// NewRemoteRegistry creates a new remote registry
func NewRemoteRegistry() *RemoteRegistry {
	return &RemoteRegistry{
		remotes: make(map[string]*RemoteServer),
	}
}

// Register adds a new remote server to the registry
func (rr *RemoteRegistry) Register(remote RemoteServer) (*RemoteServer, error) {
	rr.mu.Lock()
	defer rr.mu.Unlock()

	// Check if remote with same ID already exists
	if _, exists := rr.remotes[remote.ID]; exists {
		return nil, fmt.Errorf("remote with ID %s already registered", remote.ID)
	}

	// Check if remote with same name already exists
	for _, r := range rr.remotes {
		if r.Name == remote.Name {
			return nil, fmt.Errorf("remote with name %s already registered", remote.Name)
		}
	}

	// Initialize empty session list
	remote.SessionIDs = []string{}

	// Store the remote
	rr.remotes[remote.ID] = &remote
	rr.remoteSeq++

	return &remote, nil
}

// Unregister removes a remote server from the registry
func (rr *RemoteRegistry) Unregister(remoteID string) bool {
	rr.mu.Lock()
	defer rr.mu.Unlock()

	if _, exists := rr.remotes[remoteID]; exists {
		delete(rr.remotes, remoteID)
		return true
	}
	return false
}

// GetRemote returns a specific remote by ID
func (rr *RemoteRegistry) GetRemote(remoteID string) *RemoteServer {
	rr.mu.RLock()
	defer rr.mu.RUnlock()

	return rr.remotes[remoteID]
}

// GetRemotes returns all registered remotes
func (rr *RemoteRegistry) GetRemotes() []*RemoteServer {
	rr.mu.RLock()
	defer rr.mu.RUnlock()

	remotes := make([]*RemoteServer, 0, len(rr.remotes))
	for _, remote := range rr.remotes {
		remoteCopy := *remote
		remotes = append(remotes, &remoteCopy)
	}
	return remotes
}

// GetRemoteBySessionID finds which remote owns a specific session
func (rr *RemoteRegistry) GetRemoteBySessionID(sessionID string) *RemoteServer {
	rr.mu.RLock()
	defer rr.mu.RUnlock()

	for _, remote := range rr.remotes {
		for _, sid := range remote.SessionIDs {
			if sid == sessionID {
				return remote
			}
		}
	}
	return nil
}

// UpdateRemoteSessions updates the list of sessions for a remote
func (rr *RemoteRegistry) UpdateRemoteSessions(remoteID string, sessionIDs []string) {
	rr.mu.Lock()
	defer rr.mu.Unlock()

	if remote, exists := rr.remotes[remoteID]; exists {
		remote.SessionIDs = sessionIDs
	}
}

// AddSessionToRemote adds a session ID to a remote's session list
func (rr *RemoteRegistry) AddSessionToRemote(remoteID, sessionID string) {
	rr.mu.Lock()
	defer rr.mu.Unlock()

	if remote, exists := rr.remotes[remoteID]; exists {
		// Check if session already exists
		for _, sid := range remote.SessionIDs {
			if sid == sessionID {
				return
			}
		}
		remote.SessionIDs = append(remote.SessionIDs, sessionID)
	}
}

// RemoveSessionFromRemote removes a session ID from all remotes
func (rr *RemoteRegistry) RemoveSessionFromRemote(sessionID string) {
	rr.mu.Lock()
	defer rr.mu.Unlock()

	for _, remote := range rr.remotes {
		newSessions := []string{}
		for _, sid := range remote.SessionIDs {
			if sid != sessionID {
				newSessions = append(newSessions, sid)
			}
		}
		remote.SessionIDs = newSessions
	}
}