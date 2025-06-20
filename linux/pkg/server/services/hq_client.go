package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// HQClient handles registration with an HQ server
type HQClient struct {
	hqURL      string
	remoteID   string
	remoteName string
	token      string
	hqUsername string
	hqPassword string
	remoteURL  string
}

// NewHQClient creates a new HQ client
func NewHQClient(hqURL, hqUsername, hqPassword, remoteName, remoteURL, bearerToken string) *HQClient {
	return &HQClient{
		hqURL:      hqURL,
		remoteID:   uuid.New().String(),
		remoteName: remoteName,
		token:      bearerToken,
		hqUsername: hqUsername,
		hqPassword: hqPassword,
		remoteURL:  remoteURL,
	}
}

// Register registers this server with the HQ
func (hc *HQClient) Register() error {
	payload := map[string]string{
		"id":    hc.remoteID,
		"name":  hc.remoteName,
		"url":   hc.remoteURL,
		"token": hc.token, // Token for HQ to authenticate with this remote
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal registration data: %w", err)
	}

	req, err := http.NewRequest("POST", hc.hqURL+"/api/remotes/register", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Add Basic Auth header
	auth := base64.StdEncoding.EncodeToString([]byte(hc.hqUsername + ":" + hc.hqPassword))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to register with HQ: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errorResp map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&errorResp); err == nil {
			return fmt.Errorf("registration failed: %s", errorResp["error"])
		}
		return fmt.Errorf("registration failed with status %d", resp.StatusCode)
	}

	log.Printf("Successfully registered with HQ at %s", hc.hqURL)
	return nil
}

// Unregister removes this server from the HQ
func (hc *HQClient) Unregister() error {
	req, err := http.NewRequest("DELETE", fmt.Sprintf("%s/api/remotes/%s", hc.hqURL, hc.remoteID), nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Add Basic Auth header
	auth := base64.StdEncoding.EncodeToString([]byte(hc.hqUsername + ":" + hc.hqPassword))
	req.Header.Set("Authorization", "Basic "+auth)

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to unregister from HQ: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("unregistration failed with status %d", resp.StatusCode)
	}

	return nil
}

// GetToken returns the bearer token for HQ authentication
func (hc *HQClient) GetToken() string {
	return hc.token
}

// GetRemoteID returns this remote's ID
func (hc *HQClient) GetRemoteID() string {
	return hc.remoteID
}

// NotifySessionChange notifies HQ about session changes
func (hc *HQClient) NotifySessionChange(action, sessionID string) error {
	payload := map[string]string{
		"action":    action,
		"sessionId": sessionID,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal session change data: %w", err)
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/remotes/%s/refresh-sessions", hc.hqURL, hc.remoteName), 
		bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Add Basic Auth header
	auth := base64.StdEncoding.EncodeToString([]byte(hc.hqUsername + ":" + hc.hqPassword))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to notify HQ: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("notification failed with status %d", resp.StatusCode)
	}

	return nil
}