package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/vibetunnel/vibetunnel-server/pkg/config"
	"github.com/vibetunnel/vibetunnel-server/pkg/pty"
	"golang.org/x/term"
)

var (
	monitorOnly bool
)

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

var rootCmd = &cobra.Command{
	Use:   "fwd [flags] -- <command> [args...]",
	Short: "VibeTunnel Forward - spawn and forward PTY sessions",
	Long: `VibeTunnel Forward (fwd) spawns a PTY session and forwards it
using the VibeTunnel PTY infrastructure.

Examples:
  fwd -- bash -l
  fwd -- python3 -i
  fwd --monitor-only -- long-running-command
  fwd -- bash -c "echo hello"`,
	Args:                  cobra.MinimumNArgs(1),
	RunE:                  runForward,
	DisableFlagParsing:    false,
	DisableFlagsInUseLine: false,
}

func init() {
	rootCmd.Flags().BoolVar(&monitorOnly, "monitor-only", false, "Just create session and monitor, no interactive I/O")
}

func runForward(cmd *cobra.Command, args []string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get working directory: %v", err)
	}

	fmt.Printf("Starting command: %s\n", strings.Join(args, " "))
	fmt.Printf("Working directory: %s\n", cwd)

	// Initialize PTY manager
	cfg := config.DefaultConfig()
	cfg.ControlDir = filepath.Join(os.Getenv("HOME"), ".vibetunnel", "control")

	// Create control directory if it doesn't exist
	if err := os.MkdirAll(cfg.ControlDir, 0755); err != nil {
		return fmt.Errorf("failed to create control directory: %v", err)
	}

	ptyManager := pty.NewManager(cfg)

	// Create session
	sessionName := fmt.Sprintf("fwd_%s_%d", filepath.Base(args[0]), time.Now().Unix())
	fmt.Printf("Creating session: %s\n", sessionName)

	cols, rows := getTerminalSize()

	sessionInfo, err := ptyManager.CreateSession(args, pty.CreateSessionOptions{
		Name:       sessionName,
		WorkingDir: cwd,
		Term:       os.Getenv("TERM"),
		Cols:       cols,
		Rows:       rows,
	})
	if err != nil {
		return fmt.Errorf("failed to create session: %v", err)
	}

	fmt.Printf("Session created with ID: %s\n", sessionInfo.ID)
	fmt.Printf("PID: %d\n", sessionInfo.PID)
	fmt.Printf("Status: %s\n", sessionInfo.Status)

	// Get session details
	sessionDir := filepath.Join(cfg.ControlDir, sessionInfo.ID)
	stdinPath := filepath.Join(sessionDir, "stdin")
	streamPath := filepath.Join(sessionDir, "stream-out")
	controlPath := filepath.Join(sessionDir, "control")

	fmt.Printf("Stream output: %s\n", streamPath)
	fmt.Printf("Input pipe: %s\n", stdinPath)

	// Set up control pipe
	if err := setupControlPipe(controlPath, sessionInfo.ID, ptyManager); err != nil {
		log.Printf("Warning: Failed to set up control pipe: %v", err)
	}

	// Handle session based on mode
	if monitorOnly {
		fmt.Println("Monitor-only mode enabled\n")
		return monitorSession(sessionInfo.ID, ptyManager, streamPath)
	}

	// Interactive mode
	fmt.Println("Starting interactive session...\n")
	return runInteractiveSession(sessionInfo.ID, ptyManager, streamPath, stdinPath)
}

func getTerminalSize() (int, int) {
	cols := 80
	rows := 24

	if fd := int(os.Stdout.Fd()); term.IsTerminal(fd) {
		width, height, err := term.GetSize(fd)
		if err == nil {
			cols = width
			rows = height
		}
	}

	return cols, rows
}

func setupControlPipe(controlPath, sessionID string, ptyManager *pty.Manager) error {
	// Create control file
	if err := os.WriteFile(controlPath, []byte{}, 0644); err != nil {
		return err
	}

	// Update session info
	sessionInfoPath := filepath.Join(filepath.Dir(controlPath), "session.json")
	data, err := os.ReadFile(sessionInfoPath)
	if err != nil {
		return err
	}

	var sessionInfo map[string]interface{}
	if err := json.Unmarshal(data, &sessionInfo); err != nil {
		return err
	}

	sessionInfo["control"] = controlPath

	updatedData, err := json.MarshalIndent(sessionInfo, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(sessionInfoPath, updatedData, 0644)
}

func runInteractiveSession(sessionID string, ptyManager *pty.Manager, streamPath, stdinPath string) error {
	// Save terminal state if we're in a TTY
	var oldState *term.State
	if term.IsTerminal(int(os.Stdin.Fd())) {
		var err error
		oldState, err = term.MakeRaw(int(os.Stdin.Fd()))
		if err != nil {
			return fmt.Errorf("failed to set raw mode: %v", err)
		}
		defer term.Restore(int(os.Stdin.Fd()), oldState)
	}

	// Set up channels for coordination
	done := make(chan error, 1)

	// Forward stdin to PTY
	go func() {
		buffer := make([]byte, 1024)
		for {
			n, err := os.Stdin.Read(buffer)
			if err != nil {
				if err != io.EOF {
					done <- fmt.Errorf("stdin read error: %v", err)
				}
				return
			}
			if n > 0 {
				if err := ptyManager.SendInput(sessionID, string(buffer[:n])); err != nil {
					log.Printf("Failed to send input: %v", err)
				}
			}
		}
	}()

	// Monitor PTY output
	go func() {
		if err := streamOutput(streamPath); err != nil {
			done <- fmt.Errorf("output streaming error: %v", err)
			return
		}
		done <- nil
	}()

	// Monitor session status
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		for range ticker.C {
			session, err := ptyManager.GetSession(sessionID)
			if err != nil || session.Status != "running" {
				done <- nil
				return
			}
		}
	}()

	// Handle signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigChan:
		fmt.Printf("\n\nReceived %v, checking session status...\n", sig)
		session, err := ptyManager.GetSession(sessionID)
		if err == nil && session.Status == "running" {
			fmt.Println("Session is still running. Leaving it active.")
			fmt.Printf("Session ID: %s\n", sessionID)
			fmt.Println("You can reconnect to it later via the web interface.")
		}
		return nil
	case err := <-done:
		return err
	}
}

func monitorSession(sessionID string, ptyManager *pty.Manager, streamPath string) error {
	// Stream output
	go streamOutput(streamPath)

	// Monitor session status
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		session, err := ptyManager.GetSession(sessionID)
		if err != nil {
			return fmt.Errorf("failed to get session: %v", err)
		}

		if session.Status != "running" {
			fmt.Printf("\nSession exited with code %d\n", session.ExitCode)
			return nil
		}
	}

	return nil
}

func streamOutput(streamPath string) error {
	// Wait for stream file
	for i := 0; i < 50; i++ {
		if _, err := os.Stat(streamPath); err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	file, err := os.Open(streamPath)
	if err != nil {
		return err
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				// Check if file has more data
				time.Sleep(50 * time.Millisecond)
				continue
			}
			return err
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Parse asciinema format
		var record []interface{}
		if err := json.Unmarshal([]byte(line), &record); err == nil {
			if len(record) >= 3 && record[1] == "o" {
				// Output record: [timestamp, "o", text]
				if text, ok := record[2].(string); ok {
					os.Stdout.Write([]byte(text))
					os.Stdout.Sync()
				}
			}
		}
	}
}
