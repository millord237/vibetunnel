package routes

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/vibetunnel/linux/pkg/server/services"
)

// RemoteRoutes handles remote server management endpoints (HQ mode)
type RemoteRoutes struct {
	remoteRegistry *services.RemoteRegistry
	isHQMode       bool
}

// NewRemoteRoutes creates a new remote routes handler
func NewRemoteRoutes(remoteRegistry *services.RemoteRegistry, isHQMode bool) *RemoteRoutes {
	return &RemoteRoutes{
		remoteRegistry: remoteRegistry,
		isHQMode:       isHQMode,
	}
}

// RegisterRoutes registers all remote-related routes
func (rr *RemoteRoutes) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/remotes", rr.handleListRemotes).Methods("GET")
	r.HandleFunc("/remotes/register", rr.handleRegisterRemote).Methods("POST")
	r.HandleFunc("/remotes/{remoteId}", rr.handleUnregisterRemote).Methods("DELETE")
	r.HandleFunc("/remotes/{remoteName}/refresh-sessions", rr.handleRefreshSessions).Methods("POST")
}

// handleListRemotes lists all registered remotes (HQ mode only)
func (rr *RemoteRoutes) handleListRemotes(w http.ResponseWriter, r *http.Request) {
	if !rr.isHQMode || rr.remoteRegistry == nil {
		http.Error(w, `{"error":"Not running in HQ mode"}`, http.StatusNotFound)
		return
	}

	remotes := rr.remoteRegistry.GetRemotes()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(remotes); err != nil {
		log.Printf("Failed to encode remotes: %v", err)
	}
}

// handleRegisterRemote registers a new remote server (HQ mode only)
func (rr *RemoteRoutes) handleRegisterRemote(w http.ResponseWriter, r *http.Request) {
	if !rr.isHQMode || rr.remoteRegistry == nil {
		http.Error(w, `{"error":"Not running in HQ mode"}`, http.StatusNotFound)
		return
	}

	var req services.RemoteServer
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.ID == "" || req.Name == "" || req.URL == "" || req.Token == "" {
		http.Error(w, `{"error":"Missing required fields: id, name, url, token"}`, http.StatusBadRequest)
		return
	}

	remote, err := rr.remoteRegistry.Register(req)
	if err != nil {
		if err.Error() == fmt.Sprintf("remote with ID %s already registered", req.ID) ||
			err.Error() == fmt.Sprintf("remote with name %s already registered", req.Name) {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusConflict)
			return
		}
		log.Printf("Failed to register remote: %v", err)
		http.Error(w, `{"error":"Failed to register remote"}`, http.StatusInternalServerError)
		return
	}

	log.Printf("Remote registered: %s (%s) from %s", req.Name, req.ID, req.URL)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"remote":  remote,
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

// handleUnregisterRemote removes a remote server (HQ mode only)
func (rr *RemoteRoutes) handleUnregisterRemote(w http.ResponseWriter, r *http.Request) {
	if !rr.isHQMode || rr.remoteRegistry == nil {
		http.Error(w, `{"error":"Not running in HQ mode"}`, http.StatusNotFound)
		return
	}

	vars := mux.Vars(r)
	remoteID := vars["remoteId"]

	success := rr.remoteRegistry.Unregister(remoteID)
	if !success {
		http.Error(w, `{"error":"Remote not found"}`, http.StatusNotFound)
		return
	}

	log.Printf("Remote unregistered: %s", remoteID)

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

// handleRefreshSessions refreshes session list for a remote (HQ mode only)
func (rr *RemoteRoutes) handleRefreshSessions(w http.ResponseWriter, r *http.Request) {
	if !rr.isHQMode || rr.remoteRegistry == nil {
		http.Error(w, `{"error":"Not running in HQ mode"}`, http.StatusNotFound)
		return
	}

	vars := mux.Vars(r)
	remoteName := vars["remoteName"]

	var req struct {
		Action    string `json:"action"`
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	// Find remote by name
	var remote *services.RemoteServer
	for _, r := range rr.remoteRegistry.GetRemotes() {
		if r.Name == remoteName {
			remote = r
			break
		}
	}

	if remote == nil {
		http.Error(w, `{"error":"Remote not found"}`, http.StatusNotFound)
		return
	}

	// Fetch latest sessions from the remote
	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	reqURL := remote.URL + "/api/sessions"
	httpReq, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		log.Printf("Failed to create request: %v", err)
		http.Error(w, `{"error":"Failed to refresh sessions"}`, http.StatusInternalServerError)
		return
	}

	httpReq.Header.Set("Authorization", "Bearer "+remote.Token)

	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("Failed to fetch sessions from remote %s: %v", remote.Name, err)
		http.Error(w, `{"error":"Failed to refresh sessions"}`, http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Failed to fetch sessions from remote %s: status %d", remote.Name, resp.StatusCode)
		http.Error(w, fmt.Sprintf(`{"error":"Failed to fetch sessions: %d"}`, resp.StatusCode), http.StatusInternalServerError)
		return
	}

	var sessions []struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		log.Printf("Failed to decode sessions response: %v", err)
		http.Error(w, `{"error":"Failed to refresh sessions"}`, http.StatusInternalServerError)
		return
	}

	sessionIDs := make([]string, len(sessions))
	for i, s := range sessions {
		sessionIDs[i] = s.ID
	}

	rr.remoteRegistry.UpdateRemoteSessions(remote.ID, sessionIDs)

	log.Printf("Updated sessions for remote %s: %d sessions (%s %s)", 
		remote.Name, len(sessionIDs), req.Action, req.SessionID)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"sessionCount": len(sessionIDs),
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}