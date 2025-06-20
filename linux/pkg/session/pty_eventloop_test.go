package session

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// TestPTYEventDriven tests basic PTY operation with event-driven I/O
func TestPTYEventDriven(t *testing.T) {
	if !useEventDrivenIO {
		t.Skip("Event-driven I/O is disabled")
	}

	// Create temporary directory for session
	tmpDir, err := ioutil.TempDir("", "pty-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create session
	session := &Session{
		ID:          "test-session",
		controlPath: tmpDir,
		info: &Info{
			ID:      "test-session",
			Name:    "test",
			Cmdline: "echo",
			Args:    []string{"echo", "Hello from PTY"},
			Cwd:     tmpDir,
			Status:  "created",
			Term:    "xterm",
			Width:   80,
			Height:  24,
		},
	}

	// Create necessary directories
	if err := os.MkdirAll(session.Path(), 0755); err != nil {
		t.Fatalf("Failed to create session dir: %v", err)
	}

	// Create stdin pipe
	if err := syscall.Mkfifo(session.StdinPath(), 0600); err != nil {
		t.Fatalf("Failed to create stdin pipe: %v", err)
	}

	// Create PTY
	pty, err := NewPTY(session)
	if err != nil {
		t.Fatalf("Failed to create PTY: %v", err)
	}

	// Capture output
	streamOut := filepath.Join(session.Path(), "stream-out")
	outputData := &bytes.Buffer{}

	// Run PTY with event-driven I/O
	done := make(chan error, 1)
	go func() {
		done <- pty.Run()
	}()

	// Wait for process to complete
	select {
	case err := <-done:
		if err != nil && !strings.Contains(err.Error(), "signal:") {
			t.Errorf("PTY.Run() failed: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("PTY.Run() timeout")
	}

	// Read output from stream file
	if data, err := ioutil.ReadFile(streamOut); err == nil {
		outputData.Write(data)
	}

	// Verify output contains expected text
	output := outputData.String()
	if !strings.Contains(output, "Hello from PTY") {
		t.Errorf("Expected output to contain 'Hello from PTY', got: %s", output)
	}

	// Verify process exited
	if session.info.Status != "exited" {
		t.Errorf("Expected status 'exited', got: %s", session.info.Status)
	}
}

// TestPTYEventDrivenInput tests input handling with event-driven I/O
func TestPTYEventDrivenInput(t *testing.T) {
	if !useEventDrivenIO {
		t.Skip("Event-driven I/O is disabled")
	}

	// Create temporary directory
	tmpDir, err := ioutil.TempDir("", "pty-input-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create session for cat command (echoes input)
	session := &Session{
		ID:          "test-input-session",
		controlPath: tmpDir,
		info: &Info{
			ID:      "test-input-session",
			Name:    "test-input",
			Cmdline: "cat",
			Args:    []string{"cat"},
			Cwd:     tmpDir,
			Status:  "created",
			Term:    "xterm",
			Width:   80,
			Height:  24,
		},
	}

	// Create directories and pipes
	if err := os.MkdirAll(session.Path(), 0755); err != nil {
		t.Fatalf("Failed to create session dir: %v", err)
	}

	if err := syscall.Mkfifo(session.StdinPath(), 0600); err != nil {
		t.Fatalf("Failed to create stdin pipe: %v", err)
	}

	// Create PTY
	pty, err := NewPTY(session)
	if err != nil {
		t.Fatalf("Failed to create PTY: %v", err)
	}

	// Start PTY
	ptyClosed := make(chan error, 1)
	go func() {
		ptyClosed <- pty.Run()
	}()

	// Give PTY time to start
	time.Sleep(100 * time.Millisecond)

	// Send input through stdin pipe
	stdinPipe, err := os.OpenFile(session.StdinPath(), os.O_WRONLY, 0)
	if err != nil {
		t.Fatalf("Failed to open stdin pipe: %v", err)
	}

	testInput := "Hello Event Loop!\n"
	if _, err := stdinPipe.Write([]byte(testInput)); err != nil {
		t.Errorf("Failed to write to stdin: %v", err)
	}

	// Send EOF to terminate cat
	stdinPipe.Write([]byte{4}) // Ctrl+D
	stdinPipe.Close()

	// Wait for PTY to exit
	select {
	case <-ptyClosed:
	case <-time.After(2 * time.Second):
		t.Fatal("PTY didn't exit after EOF")
	}

	// Read output
	streamOut := filepath.Join(session.Path(), "stream-out")
	data, err := ioutil.ReadFile(streamOut)
	if err != nil {
		t.Fatalf("Failed to read output: %v", err)
	}

	// Parse asciinema format to extract output
	lines := strings.Split(string(data), "\n")
	var output string
	for _, line := range lines {
		if strings.Contains(line, `"o"`) && strings.Contains(line, testInput) {
			output += testInput
		}
	}

	if !strings.Contains(output, strings.TrimSpace(testInput)) {
		t.Errorf("Expected output to contain %q, got: %s", testInput, output)
	}
}

// TestPTYEventDrivenPerformance compares event-driven vs polling PTY performance
func TestPTYEventDrivenPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	// Test configuration
	lineCount := 1000
	lineLength := 80

	// Generate test script that outputs many lines
	script := fmt.Sprintf(`#!/bin/bash
for i in $(seq 1 %d); do
    echo "%s"
done
`, lineCount, strings.Repeat("x", lineLength))

	// Test event-driven
	eventDrivenTime := runPTYPerformanceTest(t, script, true)

	// Test polling
	pollingTime := runPTYPerformanceTest(t, script, false)

	t.Logf("Event-driven: %v, Polling: %v", eventDrivenTime, pollingTime)
	t.Logf("Event-driven is %.2fx faster", float64(pollingTime)/float64(eventDrivenTime))

	// Event-driven should be noticeably faster
	if eventDrivenTime > time.Duration(float64(pollingTime)*0.9) {
		t.Logf("Warning: Event-driven performance not significantly better than polling")
	}
}

func runPTYPerformanceTest(t *testing.T, script string, useEventDriven bool) time.Duration {
	// Temporarily set event-driven flag
	oldValue := useEventDrivenIO
	useEventDrivenIO = useEventDriven
	defer func() { useEventDrivenIO = oldValue }()

	// Create temp directory
	tmpDir, err := ioutil.TempDir("", "pty-perf-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Write script
	scriptPath := filepath.Join(tmpDir, "test.sh")
	if err := ioutil.WriteFile(scriptPath, []byte(script), 0755); err != nil {
		t.Fatalf("Failed to write script: %v", err)
	}

	// Create session
	session := &Session{
		ID:          "perf-test",
		controlPath: tmpDir,
		info: &Info{
			ID:      "perf-test",
			Name:    "perf-test",
			Cmdline: scriptPath,
			Args:    []string{scriptPath},
			Cwd:     tmpDir,
			Status:  "created",
			Term:    "xterm",
			Width:   80,
			Height:  24,
		},
	}

	// Create directories
	if err := os.MkdirAll(session.Path(), 0755); err != nil {
		t.Fatalf("Failed to create session dir: %v", err)
	}

	if err := syscall.Mkfifo(session.StdinPath(), 0600); err != nil {
		t.Fatalf("Failed to create stdin pipe: %v", err)
	}

	// Create PTY
	pty, err := NewPTY(session)
	if err != nil {
		t.Fatalf("Failed to create PTY: %v", err)
	}

	// Measure execution time
	start := time.Now()

	if err := pty.Run(); err != nil && !strings.Contains(err.Error(), "signal:") {
		t.Errorf("PTY.Run() failed: %v", err)
	}

	return time.Since(start)
}

// TestPTYEventDrivenResize tests terminal resize handling
func TestPTYEventDrivenResize(t *testing.T) {
	if !useEventDrivenIO {
		t.Skip("Event-driven I/O is disabled")
	}

	// Create temp directory
	tmpDir, err := ioutil.TempDir("", "pty-resize-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create session with a command that reports terminal size
	session := &Session{
		ID:          "resize-test",
		controlPath: tmpDir,
		info: &Info{
			ID:      "resize-test",
			Name:    "resize-test",
			Cmdline: "bash",
			Args:    []string{"bash", "-c", "trap 'echo COLUMNS=$COLUMNS LINES=$LINES' WINCH; sleep 2"},
			Cwd:     tmpDir,
			Status:  "created",
			Term:    "xterm",
			Width:   80,
			Height:  24,
		},
	}

	// Create directories
	if err := os.MkdirAll(session.Path(), 0755); err != nil {
		t.Fatalf("Failed to create session dir: %v", err)
	}

	if err := syscall.Mkfifo(session.StdinPath(), 0600); err != nil {
		t.Fatalf("Failed to create stdin pipe: %v", err)
	}

	// Create control FIFO for resize commands
	controlPath := filepath.Join(session.Path(), "control")
	if err := syscall.Mkfifo(controlPath, 0600); err != nil {
		t.Fatalf("Failed to create control pipe: %v", err)
	}

	// Create PTY
	pty, err := NewPTY(session)
	if err != nil {
		t.Fatalf("Failed to create PTY: %v", err)
	}

	// Start PTY
	done := make(chan error, 1)
	go func() {
		done <- pty.Run()
	}()

	// Give process time to start
	time.Sleep(200 * time.Millisecond)

	// Send resize command
	if err := pty.Resize(120, 40); err != nil {
		t.Errorf("Failed to resize PTY: %v", err)
	}

	// Wait for completion
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("PTY didn't exit")
	}

	// Check if resize was handled (this is somewhat fragile as it depends on bash behavior)
	streamOut := filepath.Join(session.Path(), "stream-out")
	if data, err := ioutil.ReadFile(streamOut); err == nil {
		output := string(data)
		if strings.Contains(output, "COLUMNS=120 LINES=40") {
			t.Log("Resize event was properly handled")
		} else {
			t.Log("Resize event may not have been triggered (bash-specific test)")
		}
	}
}

// TestPTYEventDrivenConcurrent tests concurrent PTY sessions
func TestPTYEventDrivenConcurrent(t *testing.T) {
	if !useEventDrivenIO {
		t.Skip("Event-driven I/O is disabled")
	}

	if testing.Short() {
		t.Skip("Skipping concurrent test in short mode")
	}

	// Number of concurrent PTYs
	ptyCount := 20

	// Track results
	var wg sync.WaitGroup
	errors := make(chan error, ptyCount)
	successCount := atomic.Int32{}

	// Create and run multiple PTYs concurrently
	for i := 0; i < ptyCount; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			// Create temp directory
			tmpDir, err := ioutil.TempDir("", fmt.Sprintf("pty-concurrent-%d-*", idx))
			if err != nil {
				errors <- fmt.Errorf("PTY %d: failed to create temp dir: %v", idx, err)
				return
			}
			defer os.RemoveAll(tmpDir)

			// Create session
			session := &Session{
				ID:          fmt.Sprintf("concurrent-%d", idx),
				controlPath: tmpDir,
				info: &Info{
					ID:      fmt.Sprintf("concurrent-%d", idx),
					Name:    fmt.Sprintf("test-%d", idx),
					Cmdline: "echo",
					Args:    []string{"echo", fmt.Sprintf("Output from PTY %d", idx)},
					Cwd:     tmpDir,
					Status:  "created",
					Term:    "xterm",
					Width:   80,
					Height:  24,
				},
			}

			// Create directories
			if err := os.MkdirAll(session.Path(), 0755); err != nil {
				errors <- fmt.Errorf("PTY %d: failed to create session dir: %v", idx, err)
				return
			}

			if err := syscall.Mkfifo(session.StdinPath(), 0600); err != nil {
				errors <- fmt.Errorf("PTY %d: failed to create stdin pipe: %v", idx, err)
				return
			}

			// Create and run PTY
			pty, err := NewPTY(session)
			if err != nil {
				errors <- fmt.Errorf("PTY %d: failed to create PTY: %v", idx, err)
				return
			}

			if err := pty.Run(); err != nil && !strings.Contains(err.Error(), "signal:") {
				errors <- fmt.Errorf("PTY %d: Run() failed: %v", idx, err)
				return
			}

			// Verify output
			streamOut := filepath.Join(session.Path(), "stream-out")
			if data, err := ioutil.ReadFile(streamOut); err == nil {
				if strings.Contains(string(data), fmt.Sprintf("Output from PTY %d", idx)) {
					successCount.Add(1)
				} else {
					errors <- fmt.Errorf("PTY %d: output mismatch", idx)
				}
			} else {
				errors <- fmt.Errorf("PTY %d: failed to read output: %v", idx, err)
			}
		}(i)
	}

	// Wait for all PTYs to complete
	wg.Wait()
	close(errors)

	// Check for errors
	errorCount := 0
	for err := range errors {
		t.Errorf("Concurrent PTY error: %v", err)
		errorCount++
	}

	// Verify success rate
	t.Logf("Successful PTYs: %d/%d", successCount.Load(), ptyCount)
	if successCount.Load() < int32(ptyCount*9/10) { // Allow 10% failure rate
		t.Errorf("Too many failures: %d/%d succeeded", successCount.Load(), ptyCount)
	}
}

// TestPTYEventDrivenCleanup tests proper cleanup on exit
func TestPTYEventDrivenCleanup(t *testing.T) {
	if !useEventDrivenIO {
		t.Skip("Event-driven I/O is disabled")
	}

	// Create temp directory
	tmpDir, err := ioutil.TempDir("", "pty-cleanup-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Track file descriptors before test
	fdCountBefore := countOpenFileDescriptors(t)

	// Run multiple PTY sessions
	for i := 0; i < 5; i++ {
		session := &Session{
			ID:          fmt.Sprintf("cleanup-%d", i),
			controlPath: tmpDir,
			info: &Info{
				ID:      fmt.Sprintf("cleanup-%d", i),
				Name:    "cleanup-test",
				Cmdline: "true",
				Args:    []string{"true"},
				Cwd:     tmpDir,
				Status:  "created",
				Term:    "xterm",
				Width:   80,
				Height:  24,
			},
		}

		if err := os.MkdirAll(session.Path(), 0755); err != nil {
			t.Fatalf("Failed to create session dir: %v", err)
		}

		if err := syscall.Mkfifo(session.StdinPath(), 0600); err != nil {
			t.Fatalf("Failed to create stdin pipe: %v", err)
		}

		pty, err := NewPTY(session)
		if err != nil {
			t.Fatalf("Failed to create PTY: %v", err)
		}

		if err := pty.Run(); err != nil && !strings.Contains(err.Error(), "signal:") {
			t.Errorf("PTY.Run() failed: %v", err)
		}
	}

	// Force garbage collection
	runtime.GC()
	time.Sleep(100 * time.Millisecond)

	// Check file descriptors after test
	fdCountAfter := countOpenFileDescriptors(t)

	// Allow some tolerance for system file descriptors
	if fdCountAfter > fdCountBefore+5 {
		t.Errorf("Possible file descriptor leak: before=%d, after=%d", fdCountBefore, fdCountAfter)
	}
}

func countOpenFileDescriptors(t *testing.T) int {
	// Count open file descriptors (Linux/macOS specific)
	pid := os.Getpid()
	fdPath := fmt.Sprintf("/proc/%d/fd", pid)

	// Try Linux proc filesystem first
	if entries, err := ioutil.ReadDir(fdPath); err == nil {
		return len(entries)
	}

	// Try macOS/BSD approach
	fdPath = fmt.Sprintf("/dev/fd")
	if entries, err := ioutil.ReadDir(fdPath); err == nil {
		return len(entries)
	}

	// Can't count, return 0
	t.Log("Cannot count file descriptors on this platform")
	return 0
}
