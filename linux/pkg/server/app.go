package server

import (
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/gorilla/mux"
	"github.com/vibetunnel/linux/pkg/api"
	"github.com/vibetunnel/linux/pkg/ngrok"
	"github.com/vibetunnel/linux/pkg/server/middleware"
	"github.com/vibetunnel/linux/pkg/server/routes"
	"github.com/vibetunnel/linux/pkg/server/services"
	"github.com/vibetunnel/linux/pkg/session"
)

// App represents the main server application
type App struct {
	router           *mux.Router
	sessionManager   *session.Manager
	terminalManager  *services.TerminalManager
	bufferAggregator *services.BufferAggregator
	authMiddleware   *middleware.AuthMiddleware
	ngrokService     *ngrok.Service
	remoteRegistry   *services.RemoteRegistry
	streamWatcher    *services.StreamWatcher
	config           *Config
}

// Config represents server configuration
type Config struct {
	SessionManager      *session.Manager
	StaticPath          string
	BasicAuthUsername   string
	BasicAuthPassword   string
	Port                int
	NoSpawn             bool
	DoNotAllowColumnSet bool
	IsHQMode            bool
	HQClient            *services.HQClient
	BearerToken         string // Token for HQ to authenticate with this remote
}

// NewApp creates a new server application
func NewApp(config *Config) *App {
	authConfig := middleware.AuthConfig{
		BasicAuthUsername: config.BasicAuthUsername,
		BasicAuthPassword: config.BasicAuthPassword,
		IsHQMode:          config.IsHQMode,
		BearerToken:       config.BearerToken,
	}

	app := &App{
		router:         mux.NewRouter(),
		sessionManager: config.SessionManager,
		ngrokService:   ngrok.NewService(),
		config:         config,
		authMiddleware: middleware.NewAuthMiddleware(authConfig),
		streamWatcher:  services.NewStreamWatcher(),
	}

	// Initialize remote registry if in HQ mode
	if config.IsHQMode {
		app.remoteRegistry = services.NewRemoteRegistry()
	}

	// Initialize services
	app.terminalManager = services.NewTerminalManager(config.SessionManager)
	app.terminalManager.SetNoSpawn(config.NoSpawn)
	app.terminalManager.SetDoNotAllowColumnSet(config.DoNotAllowColumnSet)

	// Initialize buffer aggregator with remote registry
	app.bufferAggregator = services.NewBufferAggregator(&services.BufferAggregatorConfig{
		TerminalManager: app.terminalManager,
		RemoteRegistry:  app.remoteRegistry,
		IsHQMode:        config.IsHQMode,
	})

	// Configure routes
	app.configureRoutes()

	return app
}

// configureRoutes sets up all application routes
func (app *App) configureRoutes() {
	// Health check (no auth needed)
	app.router.HandleFunc("/api/health", app.handleHealth).Methods("GET")

	// API routes with authentication middleware
	apiRouter := app.router.PathPrefix("/api").Subrouter()
	apiRouter.Use(app.authMiddleware.Authenticate)

	// Session routes with HQ mode support
	sessionRoutes := routes.NewSessionRoutes(&routes.SessionRoutesConfig{
		TerminalManager: app.terminalManager,
		SessionManager:  app.sessionManager,
		StreamWatcher:   app.streamWatcher,
		RemoteRegistry:  app.remoteRegistry,
		IsHQMode:        app.config.IsHQMode,
	})
	sessionRoutes.RegisterRoutes(apiRouter)

	// Filesystem routes
	filesystemRoutes := routes.NewFilesystemRoutes()
	filesystemRoutes.RegisterRoutes(apiRouter)

	// Ngrok routes
	ngrokRoutes := routes.NewNgrokRoutes(app.ngrokService, app.config.Port)
	ngrokRoutes.RegisterRoutes(apiRouter)

	// Remote routes (HQ mode only)
	if app.config.IsHQMode && app.remoteRegistry != nil {
		remoteRoutes := routes.NewRemoteRoutes(app.remoteRegistry, app.config.IsHQMode)
		remoteRoutes.RegisterRoutes(apiRouter)
	}

	// WebSocket endpoint for binary buffer streaming
	app.router.HandleFunc("/", app.handleWebSocket).Methods("GET").Headers("Upgrade", "websocket")

	// Static file serving
	if app.config.StaticPath != "" {
		app.router.PathPrefix("/").HandlerFunc(app.serveStaticWithIndex)
	}
}

// Handler returns the HTTP handler for the application
func (app *App) Handler() http.Handler {
	return app.router
}

// GetNgrokService returns the ngrok service for external control
func (app *App) GetNgrokService() *ngrok.Service {
	return app.ngrokService
}

// GetBufferAggregator returns the buffer aggregator service
func (app *App) GetBufferAggregator() *services.BufferAggregator {
	return app.bufferAggregator
}

// Stop gracefully stops the application
func (app *App) Stop() {
	app.bufferAggregator.Stop()
}

func (app *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	mode := "remote"
	if app.config.IsHQMode {
		mode = "hq"
	}
	
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok","timestamp":"%s","mode":"%s"}`, 
		time.Now().Format(time.RFC3339), mode)
}

func (app *App) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	app.bufferAggregator.HandleClientConnection(w, r)
}

func (app *App) serveStaticWithIndex(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Clean the path
	if path == "/" {
		path = "/index.html"
	}

	// Try to serve the file
	// fullPath := filepath.Join(app.config.StaticPath, filepath.Clean(path))

	// Check if it's a directory
	info, err := http.Dir(app.config.StaticPath).Open(path)
	if err == nil {
		defer info.Close()
		stat, _ := info.Stat()
		if stat != nil && stat.IsDir() {
			// Try to serve index.html from the directory
			indexPath := filepath.Join(path, "index.html")
			if index, err := http.Dir(app.config.StaticPath).Open(indexPath); err == nil {
				index.Close()
				http.ServeFile(w, r, filepath.Join(app.config.StaticPath, indexPath))
				return
			}
		}
	}

	// Serve the file or fall back to SPA index.html
	fileServer := http.FileServer(http.Dir(app.config.StaticPath))
	fileServer.ServeHTTP(w, r)
}
