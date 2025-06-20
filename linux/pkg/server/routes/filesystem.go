package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	"github.com/vibetunnel/linux/pkg/api"
)

// FilesystemRoutes handles all filesystem-related HTTP endpoints
type FilesystemRoutes struct{}

// NewFilesystemRoutes creates a new filesystem routes handler
func NewFilesystemRoutes() *FilesystemRoutes {
	return &FilesystemRoutes{}
}

// RegisterRoutes registers all filesystem-related routes
func (fr *FilesystemRoutes) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/fs/browse", fr.handleBrowseFS).Methods("GET")
	r.HandleFunc("/fs/read", fr.handleReadFile).Methods("GET")
	r.HandleFunc("/fs/info", fr.handleFileInfo).Methods("GET")
	r.HandleFunc("/mkdir", fr.handleMkdir).Methods("POST")
}

func (fr *FilesystemRoutes) handleBrowseFS(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "~"
	}

	log.Printf("[DEBUG] Browse directory request for path: %s", path)

	// Expand ~ to home directory
	if path == "~" || strings.HasPrefix(path, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("[ERROR] Failed to get home directory: %v", err)
			http.Error(w, "Failed to get home directory", http.StatusInternalServerError)
			return
		}
		if path == "~" {
			path = homeDir
		} else {
			path = filepath.Join(homeDir, path[2:])
		}
	}

	// Ensure the path is absolute
	absPath, err := filepath.Abs(path)
	if err != nil {
		log.Printf("[ERROR] Failed to get absolute path for %s: %v", path, err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	entries, err := api.BrowseDirectory(absPath)
	if err != nil {
		log.Printf("[ERROR] Failed to browse directory %s: %v", absPath, err)
		http.Error(w, fmt.Sprintf("Failed to read directory: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[DEBUG] Found %d entries in %s", len(entries), absPath)

	// Create response in the format expected by the web client
	response := struct {
		AbsolutePath string        `json:"absolutePath"`
		Files        []api.FSEntry `json:"files"`
	}{
		AbsolutePath: absPath,
		Files:        entries,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("[ERROR] Failed to encode response: %v", err)
	}
}

func (fr *FilesystemRoutes) handleFileInfo(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path parameter is required", http.StatusBadRequest)
		return
	}

	fileInfo, err := api.GetFileInfo(path)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "File not found", http.StatusNotFound)
		} else if strings.Contains(err.Error(), "path traversal") {
			http.Error(w, "Invalid path", http.StatusBadRequest)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(fileInfo); err != nil {
		log.Printf("Failed to encode file info: %v", err)
	}
}

func (fr *FilesystemRoutes) handleReadFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path parameter is required", http.StatusBadRequest)
		return
	}

	file, fileInfo, err := api.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "File not found", http.StatusNotFound)
		} else if strings.Contains(err.Error(), "path traversal") {
			http.Error(w, "Invalid path", http.StatusBadRequest)
		} else if strings.Contains(err.Error(), "not readable") {
			http.Error(w, "File is not readable", http.StatusForbidden)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	defer file.Close()

	// Set appropriate headers
	w.Header().Set("Content-Type", fileInfo.MimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", fileInfo.Name))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size))

	// Add cache headers for static files
	if strings.HasPrefix(fileInfo.MimeType, "image/") || strings.HasPrefix(fileInfo.MimeType, "application/pdf") {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}

	// Support range requests for large files
	http.ServeContent(w, r, fileInfo.Name, fileInfo.ModTime, file.(io.ReadSeeker))
}

func (fr *FilesystemRoutes) handleMkdir(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Name string `json:"name,omitempty"` // Optional name field for web client
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[ERROR] Failed to decode mkdir request: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Support both formats:
	// 1. iOS format: { "path": "/full/path/to/new/folder" }
	// 2. Web format: { "path": "/parent/path", "name": "newfolder" }
	fullPath := req.Path
	if req.Name != "" {
		fullPath = filepath.Join(req.Path, req.Name)
	}

	if fullPath == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	log.Printf("[DEBUG] Create directory request for path: %s", fullPath)

	// Expand ~ to home directory
	if fullPath == "~" || strings.HasPrefix(fullPath, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("[ERROR] Failed to get home directory: %v", err)
			http.Error(w, "Failed to get home directory", http.StatusInternalServerError)
			return
		}
		if fullPath == "~" {
			fullPath = homeDir
		} else {
			fullPath = filepath.Join(homeDir, fullPath[2:])
		}
	}

	// Create directory with proper permissions
	if err := os.MkdirAll(fullPath, 0755); err != nil {
		log.Printf("[ERROR] Failed to create directory %s: %v", fullPath, err)
		http.Error(w, fmt.Sprintf("Failed to create directory: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[DEBUG] Successfully created directory: %s", fullPath)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"path":    fullPath,
	}); err != nil {
		log.Printf("Failed to encode response: %v", err)
	}
}
