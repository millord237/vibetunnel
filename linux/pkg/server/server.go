package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/vibetunnel/linux/pkg/api"
	"github.com/vibetunnel/linux/pkg/session"
)

// Server represents the VibeTunnel HTTP server
type Server struct {
	app        *App
	httpServer *http.Server
}

// NewServer creates a new VibeTunnel server
func NewServer(manager *session.Manager, staticPath, password string, port int) *Server {
	config := &Config{
		SessionManager: manager,
		StaticPath:     staticPath,
		Password:       password,
		Port:           port,
	}

	app := NewApp(config)

	return &Server{
		app: app,
	}
}

// SetNoSpawn configures whether terminal spawning is allowed
func (s *Server) SetNoSpawn(noSpawn bool) {
	s.app.terminalManager.SetNoSpawn(noSpawn)
}

// SetDoNotAllowColumnSet configures whether terminal resizing is allowed
func (s *Server) SetDoNotAllowColumnSet(doNotAllowColumnSet bool) {
	s.app.terminalManager.SetDoNotAllowColumnSet(doNotAllowColumnSet)
}

// Start starts the HTTP server
func (s *Server) Start(addr string) error {
	s.httpServer = &http.Server{
		Addr:    addr,
		Handler: s.app.Handler(),
	}

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\nShutting down server...")

		// Mark all running sessions as exited
		if sessions, err := s.app.sessionManager.ListSessions(); err == nil {
			for _, session := range sessions {
				if session.Status == "running" || session.Status == "starting" {
					if sess, err := s.app.sessionManager.GetSession(session.ID); err == nil {
						if err := sess.UpdateStatus(); err != nil {
							log.Printf("Failed to update session status: %v", err)
						}
					}
				}
			}
		}

		// Stop services
		s.app.Stop()

		// Shutdown HTTP server
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.httpServer.Shutdown(ctx); err != nil {
			log.Printf("Failed to shutdown server: %v", err)
		}
	}()

	return s.httpServer.ListenAndServe()
}

// StartNgrok starts the ngrok tunnel
func (s *Server) StartNgrok(authToken string) error {
	return s.app.GetNgrokService().Start(authToken, s.app.config.Port)
}

// StopNgrok stops the ngrok tunnel
func (s *Server) StopNgrok() error {
	return s.app.GetNgrokService().Stop()
}

// GetNgrokStatus returns the current ngrok status
func (s *Server) GetNgrokStatus() interface{} {
	return s.app.GetNgrokService().GetStatus()
}

// NewTLSServer creates a TLS-enabled server wrapper
func NewTLSServer(server *Server, config *api.TLSConfig) *api.TLSServer {
	// Delegate to the existing TLS implementation
	legacyServer := &api.Server{}
	return api.NewTLSServer(legacyServer, config)
}
