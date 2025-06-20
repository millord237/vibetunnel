package routes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/vibetunnel/linux/pkg/server/services"
)

// forwardToRemote forwards a request to a remote server
func (sr *SessionRoutes) forwardToRemote(remoteID string, method, path string, body interface{}) (*http.Response, error) {
	remote := sr.config.RemoteRegistry.GetRemote(remoteID)
	if remote == nil {
		return nil, fmt.Errorf("remote not found")
	}

	var reqBody io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewBuffer(jsonData)
	}

	req, err := http.NewRequest(method, remote.URL+path, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+remote.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	return client.Do(req)
}

// aggregateRemoteSessions fetches sessions from all remote servers
func (sr *SessionRoutes) aggregateRemoteSessions() []map[string]interface{} {
	if !sr.config.IsHQMode || sr.config.RemoteRegistry == nil {
		return nil
	}

	remotes := sr.config.RemoteRegistry.GetRemotes()
	log.Printf("HQ Mode: Checking %d remote servers for sessions", len(remotes))

	// Channel to collect results
	type remoteResult struct {
		sessions []map[string]interface{}
		remoteID string
		remoteName string
		remoteURL string
	}
	
	resultChan := make(chan remoteResult, len(remotes))

	// Fetch sessions from each remote in parallel
	for _, remote := range remotes {
		go func(r *services.RemoteServer) {
			resp, err := sr.forwardToRemote(r.ID, "GET", "/api/sessions", nil)
			if err != nil {
				log.Printf("Failed to get sessions from remote %s: %v", r.Name, err)
				resultChan <- remoteResult{sessions: nil}
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				log.Printf("Failed to get sessions from remote %s: HTTP %d", r.Name, resp.StatusCode)
				resultChan <- remoteResult{sessions: nil}
				return
			}

			var remoteSessions []map[string]interface{}
			if err := json.NewDecoder(resp.Body).Decode(&remoteSessions); err != nil {
				log.Printf("Failed to decode sessions from remote %s: %v", r.Name, err)
				resultChan <- remoteResult{sessions: nil}
				return
			}

			log.Printf("Got %d sessions from remote %s", len(remoteSessions), r.Name)

			// Extract session IDs for tracking
			sessionIDs := make([]string, len(remoteSessions))
			for i, s := range remoteSessions {
				if id, ok := s["id"].(string); ok {
					sessionIDs[i] = id
				}
			}
			sr.config.RemoteRegistry.UpdateRemoteSessions(r.ID, sessionIDs)

			resultChan <- remoteResult{
				sessions:   remoteSessions,
				remoteID:   r.ID,
				remoteName: r.Name,
				remoteURL:  r.URL,
			}
		}(remote)
	}

	// Collect results
	var allRemoteSessions []map[string]interface{}
	for i := 0; i < len(remotes); i++ {
		result := <-resultChan
		if result.sessions != nil {
			// Add remote info to each session
			for _, session := range result.sessions {
				session["source"] = "remote"
				session["remoteId"] = result.remoteID
				session["remoteName"] = result.remoteName
				session["remoteUrl"] = result.remoteURL
			}
			allRemoteSessions = append(allRemoteSessions, result.sessions...)
		}
	}

	log.Printf("Total remote sessions: %d", len(allRemoteSessions))
	return allRemoteSessions
}