package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/vibetunnel/linux/pkg/api"
	"github.com/vibetunnel/linux/pkg/server/services"
	"github.com/vibetunnel/linux/pkg/session"
)

// SessionRoutesConfig contains dependencies for session routes
type SessionRoutesConfig struct {
	TerminalManager *services.TerminalManager
	SessionManager  *session.Manager
	StreamWatcher   *services.StreamWatcher
	RemoteRegistry  *services.RemoteRegistry
	IsHQMode        bool
}

// SessionRoutes handles all session-related HTTP endpoints
type SessionRoutes struct {
	config *SessionRoutesConfig
}

// NewSessionRoutes creates a new session routes handler
func NewSessionRoutes(config *SessionRoutesConfig) *SessionRoutes {
	return &SessionRoutes{
		config: config,
	}
}

// RegisterRoutes registers all session-related routes
func (sr *SessionRoutes) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/sessions", sr.handleListSessions).Methods("GET")
	r.HandleFunc("/sessions", sr.handleCreateSession).Methods("POST")
	r.HandleFunc("/sessions/{id}", sr.handleGetSession).Methods("GET")
	r.HandleFunc("/sessions/{id}/stream", sr.handleStreamSession).Methods("GET")
	r.HandleFunc("/sessions/{id}/snapshot", sr.handleSnapshotSession).Methods("GET")
	r.HandleFunc("/sessions/{id}/input", sr.handleSendInput).Methods("POST")
	r.HandleFunc("/sessions/{id}", sr.handleKillSession).Methods("DELETE")
	r.HandleFunc("/sessions/{id}/cleanup", sr.handleCleanupSession).Methods("DELETE", "POST")
	r.HandleFunc("/sessions/{id}/resize", sr.handleResizeSession).Methods("POST")
	r.HandleFunc("/sessions/multistream", sr.handleMultistream).Methods("GET")
	r.HandleFunc("/cleanup-exited", sr.handleCleanupExited).Methods("POST")
}

// APISessionInfo represents session info in API format
type APISessionInfo struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Command      string            `json:"command"`
	WorkingDir   string            `json:"workingDir"`
	Pid          *int              `json:"pid,omitempty"`
	Status       string            `json:"status"`
	ExitCode     *int              `json:"exitCode,omitempty"`
	StartedAt    time.Time         `json:"startedAt"`
	Term         string            `json:"term"`
	Width        int               `json:"width"`
	Height       int               `json:"height"`
	Env          map[string]string `json:"env,omitempty"`
	LastModified time.Time         `json:"lastModified"`
}

func (sr *SessionRoutes) handleListSessions(w http.ResponseWriter, r *http.Request) {
	// Get local sessions
	sessions, err := sr.config.SessionManager.ListSessions()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("Found %d local sessions", len(sessions))

	// Convert to API format
	allSessions := make([]map[string]interface{}, 0, len(sessions))
	
	// Add local sessions
	for _, s := range sessions {
		sessionData := map[string]interface{}{
			"id":         s.ID,
			"name":       s.Name,
			"command":    s.Cmdline,
			"workingDir": s.Cwd,
			"status":     s.Status,
			"exitCode":   s.ExitCode,
			"startedAt":  s.StartedAt,
			"term":       s.Term,
			"width":      s.Width,
			"height":     s.Height,
			"env":        s.Env,
			"source":     "local",
		}
		
		if s.Pid > 0 {
			sessionData["pid"] = s.Pid
		}
		
		allSessions = append(allSessions, sessionData)
	}

	// Aggregate remote sessions if in HQ mode
	if sr.config.IsHQMode {
		remoteSessions := sr.aggregateRemoteSessions()
		allSessions = append(allSessions, remoteSessions...)
	}

	log.Printf("Returning %d total sessions", len(allSessions))

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(allSessions); err != nil {
		log.Printf("Failed to encode sessions response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

func (sr *SessionRoutes) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name          string   `json:"name"`
		Command       []string `json:"command"`
		WorkingDir    string   `json:"workingDir"`
		Cols          int      `json:"cols"`
		Rows          int      `json:"rows"`
		SpawnTerminal bool     `json:"spawn_terminal"`
		Term          string   `json:"term"`
		RemoteID      string   `json:"remoteId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body. Expected JSON with 'command' array and optional 'workingDir'", http.StatusBadRequest)
		return
	}

	if len(req.Command) == 0 {
		http.Error(w, "Command array is required", http.StatusBadRequest)
		return
	}

	// If remoteId is specified and we're in HQ mode, forward to remote
	if req.RemoteID != "" && sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		log.Printf("Forwarding session creation to remote %s", req.RemoteID)
		
		// Remove remoteId from request to avoid recursion
		forwardReq := map[string]interface{}{
			"command":       req.Command,
			"workingDir":    req.WorkingDir,
			"name":          req.Name,
			"cols":          req.Cols,
			"rows":          req.Rows,
			"spawn_terminal": req.SpawnTerminal,
			"term":          req.Term,
		}

		resp, err := sr.forwardToRemote(req.RemoteID, "POST", "/api/sessions", forwardReq)
		if err != nil {
			log.Printf("Failed to forward to remote: %v", err)
			http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
			return
		}
		defer resp.Body.Close()

		// Copy response status and body
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)

		// Track the session if created successfully
		if resp.StatusCode == http.StatusOK {
			var result map[string]interface{}
			if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
				if sessionID, ok := result["sessionId"].(string); ok {
					sr.config.RemoteRegistry.AddSessionToRemote(req.RemoteID, sessionID)
				}
			}
		}
		return
	}

	// Create local session
	config := services.SessionConfig{
		Name:          req.Name,
		Command:       req.Command,
		WorkingDir:    req.WorkingDir,
		Cols:          req.Cols,
		Rows:          req.Rows,
		SpawnTerminal: req.SpawnTerminal,
		Term:          req.Term,
	}

	sess, err := sr.config.TerminalManager.CreateSession(config)
	if err != nil {
		log.Printf("[ERROR] Failed to create session: %v", err)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		errorResponse := map[string]interface{}{
			"success": false,
			"error":   err.Error(),
			"details": fmt.Sprintf("Failed to create session with command '%s'", strings.Join(req.Command, " ")),
		}

		if sessionErr, ok := err.(*session.SessionError); ok {
			errorResponse["code"] = string(sessionErr.Code)
			if sessionErr.Code == session.ErrPTYCreationFailed {
				errorResponse["details"] = sessionErr.Message
			}
		}

		if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
			log.Printf("Failed to encode error response: %v", err)
		}
		return
	}

	log.Printf("Session created: %s", sess.ID)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"sessionId": sess.ID,
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (sr *SessionRoutes) handleGetSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	// Check if this is a remote session in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remote := sr.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			// Forward to remote server
			resp, err := sr.forwardToRemote(remote.ID, "GET", "/api/sessions/"+sessionID, nil)
			if err != nil {
				log.Printf("Failed to get session from remote %s: %v", remote.Name, err)
				http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
			return
		}
	}

	// Local session handling
	sess, err := sr.config.SessionManager.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	info := sess.GetInfo()
	if info == nil {
		http.Error(w, "Session info not available", http.StatusInternalServerError)
		return
	}

	if err := sess.UpdateStatus(); err != nil {
		log.Printf("Failed to update session status: %v", err)
	}

	rustInfo := session.RustSessionInfo{
		ID:        info.ID,
		Name:      info.Name,
		Cmdline:   info.Args,
		Cwd:       info.Cwd,
		Status:    info.Status,
		ExitCode:  info.ExitCode,
		Term:      info.Term,
		SpawnType: "pty",
		Cols:      &info.Width,
		Rows:      &info.Height,
		Env:       info.Env,
	}

	if info.Pid > 0 {
		rustInfo.Pid = &info.Pid
	}

	if !info.StartedAt.IsZero() {
		rustInfo.StartedAt = &info.StartedAt
	}

	response := map[string]interface{}{
		"id":         rustInfo.ID,
		"name":       rustInfo.Name,
		"command":    strings.Join(rustInfo.Cmdline, " "),
		"workingDir": rustInfo.Cwd,
		"pid":        rustInfo.Pid,
		"status":     rustInfo.Status,
		"exitCode":   rustInfo.ExitCode,
		"startedAt":  rustInfo.StartedAt,
		"term":       rustInfo.Term,
		"width":      rustInfo.Cols,
		"height":     rustInfo.Rows,
		"env":        rustInfo.Env,
	}

	if stat, err := os.Stat(sess.Path()); err == nil {
		response["lastModified"] = stat.ModTime()
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (sr *SessionRoutes) handleStreamSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	// Check if this is a remote session in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remote := sr.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			// Proxy SSE stream from remote server
			req, err := http.NewRequest("GET", remote.URL+"/api/sessions/"+sessionID+"/stream", nil)
			if err != nil {
				http.Error(w, "Failed to create request", http.StatusInternalServerError)
				return
			}
			req.Header.Set("Authorization", "Bearer "+remote.Token)
			req.Header.Set("Accept", "text/event-stream")

			client := &http.Client{}
			resp, err := client.Do(req)
			if err != nil {
				http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				w.WriteHeader(resp.StatusCode)
				io.Copy(w, resp.Body)
				return
			}

			// Set up SSE headers
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Connection", "keep-alive")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("X-Accel-Buffering", "no")

			// Proxy the stream
			io.Copy(w, resp.Body)
			return
		}
	}

	// Local session handling
	sess, err := sr.config.SessionManager.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Add client to stream watcher
	sr.config.StreamWatcher.AddClient(sessionID, sess.Path()+"/stream-out", w)

	// Clean up on disconnect
	r.Context().Done()
	go func() {
		<-r.Context().Done()
		sr.config.StreamWatcher.RemoveClient(sessionID, w)
	}()
}

func (sr *SessionRoutes) handleSnapshotSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sess, err := sr.config.SessionManager.GetSession(vars["id"])
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	snapshot, err := api.GetSessionSnapshot(sess)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(snapshot); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (sr *SessionRoutes) handleSendInput(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	// Check if this is a remote session in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remote := sr.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			// Forward input to remote server
			var req map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
				return
			}

			resp, err := sr.forwardToRemote(remote.ID, "POST", "/api/sessions/"+sessionID+"/input", req)
			if err != nil {
				log.Printf("Failed to send input to remote %s: %v", remote.Name, err)
				http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
			return
		}
	}

	// Local session handling
	sess, err := sr.config.SessionManager.GetSession(sessionID)
	if err != nil {
		log.Printf("[ERROR] handleSendInput: Session %s not found", vars["id"])
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	var req struct {
		Input string `json:"input"`
		Text  string `json:"text"`
		Type  string `json:"type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[ERROR] handleSendInput: Failed to decode request: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	input := req.Input
	if input == "" && req.Text != "" {
		input = req.Text
	}

	specialKeys := map[string]string{
		"arrow_up":    "\x1b[A",
		"arrow_down":  "\x1b[B",
		"arrow_right": "\x1b[C",
		"arrow_left":  "\x1b[D",
		"escape":      "\x1b",
		"enter":       "\r",
		"ctrl_enter":  "\r",
		"shift_enter": "\x1b\x0d",
	}

	if mappedKey, isSpecialKey := specialKeys[input]; isSpecialKey {
		err = sess.SendKey(mappedKey)
	} else {
		err = sess.SendText(input)
	}

	if err != nil {
		log.Printf("[ERROR] handleSendInput: Failed to send input: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (sr *SessionRoutes) handleKillSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	// Check if this is a remote session in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remote := sr.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			// Forward kill request to remote server
			resp, err := sr.forwardToRemote(remote.ID, "DELETE", "/api/sessions/"+sessionID, nil)
			if err != nil {
				log.Printf("Failed to kill session on remote %s: %v", remote.Name, err)
				http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)

			// Update registry if successful
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusGone {
				sr.config.RemoteRegistry.RemoveSessionFromRemote(sessionID)
				log.Printf("Remote session %s killed on %s", sessionID, remote.Name)
			}
			return
		}
	}

	// Local session handling
	sess, err := sr.config.SessionManager.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if err := sess.UpdateStatus(); err != nil {
		log.Printf("Failed to update session status: %v", err)
	}

	info := sess.GetInfo()
	if info != nil && info.Status == string(session.StatusExited) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Session already exited",
		}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
		return
	}

	if err := sess.Kill(); err != nil {
		log.Printf("[ERROR] Failed to kill session %s: %v", vars["id"], err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Session deleted successfully",
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (sr *SessionRoutes) handleCleanupSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	// Check if this is a remote session in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remote := sr.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			// Forward cleanup request to remote server
			resp, err := sr.forwardToRemote(remote.ID, "DELETE", "/api/sessions/"+sessionID+"/cleanup", nil)
			if err != nil {
				log.Printf("Failed to cleanup session on remote %s: %v", remote.Name, err)
				http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)

			// Update registry if successful
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
				sr.config.RemoteRegistry.RemoveSessionFromRemote(sessionID)
				log.Printf("Remote session %s cleaned up on %s", sessionID, remote.Name)
			}
			return
		}
	}

	// Local session handling
	if err := sr.config.SessionManager.RemoveSession(sessionID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (sr *SessionRoutes) handleCleanupExited(w http.ResponseWriter, r *http.Request) {
	// Clean up local sessions
	err := sr.config.SessionManager.RemoveExitedSessions()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	
	// TODO: Track how many sessions were cleaned
	localCleaned := []string{}

	log.Printf("Cleaned up %d local exited sessions", len(localCleaned))

	// Remove cleaned local sessions from remote registry if in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		for _, sessionID := range localCleaned {
			sr.config.RemoteRegistry.RemoveSessionFromRemote(sessionID)
		}
	}

	totalCleaned := len(localCleaned)
	var remoteResults []map[string]interface{}

	// If in HQ mode, clean up sessions on all remotes
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remotes := sr.config.RemoteRegistry.GetRemotes()

		// Clean up on each remote in parallel
		type cleanupResult struct {
			remoteName string
			cleaned    int
			error      string
		}

		resultChan := make(chan cleanupResult, len(remotes))

		for _, remote := range remotes {
			go func(r *services.RemoteServer) {
				resp, err := sr.forwardToRemote(r.ID, "POST", "/api/cleanup-exited", nil)
				if err != nil {
					log.Printf("Failed to cleanup sessions on remote %s: %v", r.Name, err)
					resultChan <- cleanupResult{remoteName: r.Name, cleaned: 0, error: err.Error()}
					return
				}
				defer resp.Body.Close()

				if resp.StatusCode == http.StatusOK {
					var result map[string]interface{}
					if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
						if cleanedSessions, ok := result["cleanedSessions"].([]interface{}); ok {
							// Remove cleaned remote sessions from registry
							for _, sid := range cleanedSessions {
								if sessionID, ok := sid.(string); ok {
									sr.config.RemoteRegistry.RemoveSessionFromRemote(sessionID)
								}
							}
							resultChan <- cleanupResult{remoteName: r.Name, cleaned: len(cleanedSessions), error: ""}
							return
						}
					}
				}
				resultChan <- cleanupResult{remoteName: r.Name, cleaned: 0, error: fmt.Sprintf("HTTP %d", resp.StatusCode)}
			}(remote)
		}

		// Collect results
		for i := 0; i < len(remotes); i++ {
			result := <-resultChan
			remoteResult := map[string]interface{}{
				"remoteName": result.remoteName,
				"cleaned":    result.cleaned,
			}
			if result.error != "" {
				remoteResult["error"] = result.error
			}
			remoteResults = append(remoteResults, remoteResult)
			totalCleaned += result.cleaned
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"message":       fmt.Sprintf("%d exited sessions cleaned up across all servers", totalCleaned),
		"localCleaned":  len(localCleaned),
		"remoteResults": remoteResults,
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (sr *SessionRoutes) handleMultistream(w http.ResponseWriter, r *http.Request) {
	sessionIDs := r.URL.Query()["session_id"]
	if len(sessionIDs) == 0 {
		http.Error(w, "No session IDs provided", http.StatusBadRequest)
		return
	}

	streamer := api.NewMultiSSEStreamer(w, sr.config.SessionManager, sessionIDs)
	streamer.Stream()
}

func (sr *SessionRoutes) handleResizeSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID := vars["id"]

	var req struct {
		Cols int `json:"cols"`
		Rows int `json:"rows"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Cols <= 0 || req.Rows <= 0 || req.Cols > 1000 || req.Rows > 1000 {
		http.Error(w, "Cols and rows must be between 1 and 1000", http.StatusBadRequest)
		return
	}

	log.Printf("Resizing session %s to %dx%d", sessionID, req.Cols, req.Rows)

	// Check if this is a remote session in HQ mode
	if sr.config.IsHQMode && sr.config.RemoteRegistry != nil {
		remote := sr.config.RemoteRegistry.GetRemoteBySessionID(sessionID)
		if remote != nil {
			// Forward resize to remote server
			resp, err := sr.forwardToRemote(remote.ID, "POST", "/api/sessions/"+sessionID+"/resize", req)
			if err != nil {
				log.Printf("Failed to resize session on remote %s: %v", remote.Name, err)
				http.Error(w, "Failed to reach remote server", http.StatusServiceUnavailable)
				return
			}
			defer resp.Body.Close()

			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
			return
		}
	}

	// Local session handling
	if err := sr.config.TerminalManager.ResizeSession(sessionID, req.Cols, req.Rows); err != nil {
		if strings.Contains(err.Error(), "disabled by server configuration") {
			log.Printf("[INFO] Resize blocked for session %s", vars["id"][:8])
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"message": err.Error(),
				"error":   "resize_disabled_by_server",
			}); err != nil {
				log.Printf("Failed to encode response: %v", err)
			}
			return
		}

		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Session resized successfully",
		"cols":    req.Cols,
		"rows":    req.Rows,
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

// aggregateRemoteSessions collects sessions from all remote servers
func (sr *SessionRoutes) aggregateRemoteSessions() []map[string]interface{} {
	if sr.config.RemoteRegistry == nil {
		return nil
	}

	remotes := sr.config.RemoteRegistry.GetRemotes()
	if len(remotes) == 0 {
		return nil
	}

	type remoteSessionResult struct {
		remoteID   string
		remoteName string
		sessions   []map[string]interface{}
		err        error
	}

	resultChan := make(chan remoteSessionResult, len(remotes))

	// Query each remote in parallel
	for _, remote := range remotes {
		go func(r *services.RemoteServer) {
			// Make request to remote server
			req, err := http.NewRequest("GET", r.URL+"/api/sessions", nil)
			if err != nil {
				resultChan <- remoteSessionResult{remoteID: r.ID, remoteName: r.Name, err: err}
				return
			}
			req.Header.Set("Authorization", "Bearer "+r.Token)

			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				resultChan <- remoteSessionResult{remoteID: r.ID, remoteName: r.Name, err: err}
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				resultChan <- remoteSessionResult{
					remoteID:   r.ID,
					remoteName: r.Name,
					err:        fmt.Errorf("remote returned status %d", resp.StatusCode),
				}
				return
			}

			var sessions []map[string]interface{}
			if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
				resultChan <- remoteSessionResult{remoteID: r.ID, remoteName: r.Name, err: err}
				return
			}

			// Add remote information to each session
			for i := range sessions {
				sessions[i]["source"] = "remote"
				sessions[i]["remoteId"] = r.ID
				sessions[i]["remoteName"] = r.Name
				sessions[i]["remoteURL"] = r.URL
			}

			resultChan <- remoteSessionResult{
				remoteID:   r.ID,
				remoteName: r.Name,
				sessions:   sessions,
			}
		}(remote)
	}

	// Collect results
	allRemoteSessions := []map[string]interface{}{}
	for i := 0; i < len(remotes); i++ {
		result := <-resultChan
		if result.err != nil {
			log.Printf("Failed to get sessions from remote %s: %v", result.remoteName, result.err)
			continue
		}
		allRemoteSessions = append(allRemoteSessions, result.sessions...)
	}

	return allRemoteSessions
}