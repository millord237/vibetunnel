package routes

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
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

