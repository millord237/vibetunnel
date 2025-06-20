package routes

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/vibetunnel/linux/pkg/ngrok"
)

// NgrokRoutes handles all ngrok-related HTTP endpoints
type NgrokRoutes struct {
	ngrokService *ngrok.Service
	port         int
}

// NewNgrokRoutes creates a new ngrok routes handler
func NewNgrokRoutes(ngrokService *ngrok.Service, port int) *NgrokRoutes {
	return &NgrokRoutes{
		ngrokService: ngrokService,
		port:         port,
	}
}

// RegisterRoutes registers all ngrok-related routes
func (nr *NgrokRoutes) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/ngrok/start", nr.handleNgrokStart).Methods("POST")
	r.HandleFunc("/ngrok/stop", nr.handleNgrokStop).Methods("POST")
	r.HandleFunc("/ngrok/status", nr.handleNgrokStatus).Methods("GET")
}

func (nr *NgrokRoutes) handleNgrokStart(w http.ResponseWriter, r *http.Request) {
	var req ngrok.StartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.AuthToken == "" {
		http.Error(w, "Auth token is required", http.StatusBadRequest)
		return
	}

	// Check if ngrok is already running
	if nr.ngrokService.IsRunning() {
		status := nr.ngrokService.GetStatus()
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Ngrok tunnel is already running",
			"tunnel":  status,
		}); err != nil {
			log.Printf("Failed to encode response: %v", err)
		}
		return
	}

	// Start the tunnel
	if err := nr.ngrokService.Start(req.AuthToken, nr.port); err != nil {
		log.Printf("[ERROR] Failed to start ngrok tunnel: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return immediate response - tunnel status will be updated asynchronously
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Ngrok tunnel is starting",
		"tunnel":  nr.ngrokService.GetStatus(),
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (nr *NgrokRoutes) handleNgrokStop(w http.ResponseWriter, r *http.Request) {
	if !nr.ngrokService.IsRunning() {
		http.Error(w, "Ngrok tunnel is not running", http.StatusBadRequest)
		return
	}

	if err := nr.ngrokService.Stop(); err != nil {
		log.Printf("[ERROR] Failed to stop ngrok tunnel: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Ngrok tunnel stopped",
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}

func (nr *NgrokRoutes) handleNgrokStatus(w http.ResponseWriter, r *http.Request) {
	status := nr.ngrokService.GetStatus()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"tunnel":  status,
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}
