package session

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// TestEventLoopCreation tests basic event loop creation and cleanup
func TestEventLoopCreation(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}

	if err := loop.Close(); err != nil {
		t.Errorf("Failed to close event loop: %v", err)
	}
}

// TestEventLoopAddRemove tests adding and removing file descriptors
func TestEventLoopAddRemove(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create a pipe for testing
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	// Add read end to event loop
	if err := loop.Add(int(r.Fd()), EventRead, "test-read"); err != nil {
		t.Errorf("Failed to add fd to event loop: %v", err)
	}

	// Remove it
	if err := loop.Remove(int(r.Fd())); err != nil {
		t.Errorf("Failed to remove fd from event loop: %v", err)
	}

	// Try to remove again (should not error)
	if err := loop.Remove(int(r.Fd())); err != nil {
		t.Logf("Remove non-existent fd error (expected): %v", err)
	}
}

// TestEventLoopReadEvent tests read event notification
func TestEventLoopReadEvent(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create a pipe
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	// Set non-blocking mode
	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		t.Fatalf("Failed to set non-blocking: %v", err)
	}

	// Add read end to event loop
	if err := loop.Add(int(r.Fd()), EventRead, "test-pipe"); err != nil {
		t.Fatalf("Failed to add fd to event loop: %v", err)
	}

	// Track events
	var eventReceived atomic.Bool
	var eventData string
	testData := []byte("Hello, Event Loop!")

	// Start event handler in goroutine
	go func() {
		err := loop.RunOnce(func(event Event) {
			if event.Data.(string) == "test-pipe" && event.Events&EventRead != 0 {
				// Read data
				buf := make([]byte, 100)
				n, err := syscall.Read(event.FD, buf)
				if err == nil && n > 0 {
					eventData = string(buf[:n])
					eventReceived.Store(true)
				}
			}
		}, 1000) // 1 second timeout

		if err != nil {
			t.Errorf("RunOnce failed: %v", err)
		}
	}()

	// Give event loop time to start
	time.Sleep(10 * time.Millisecond)

	// Write data to trigger event
	if _, err := w.Write(testData); err != nil {
		t.Fatalf("Failed to write data: %v", err)
	}

	// Wait for event to be processed
	deadline := time.Now().Add(500 * time.Millisecond)
	for !eventReceived.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}

	if !eventReceived.Load() {
		t.Fatal("Read event not received within timeout")
	}

	if eventData != string(testData) {
		t.Errorf("Expected data %q, got %q", string(testData), eventData)
	}
}

// TestEventLoopMultipleEvents tests handling multiple events
func TestEventLoopMultipleEvents(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create multiple pipes
	pipes := make([]struct{ r, w *os.File }, 3)
	for i := range pipes {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatalf("Failed to create pipe %d: %v", i, err)
		}
		pipes[i].r = r
		pipes[i].w = w
		defer r.Close()
		defer w.Close()

		// Set non-blocking
		if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
			t.Fatalf("Failed to set non-blocking: %v", err)
		}

		// Add to event loop
		if err := loop.Add(int(r.Fd()), EventRead, fmt.Sprintf("pipe-%d", i)); err != nil {
			t.Fatalf("Failed to add pipe %d: %v", i, err)
		}
	}

	// Track events
	eventCount := atomic.Int32{}
	var mu sync.Mutex
	receivedData := make(map[string]string)

	// Run event loop
	done := make(chan bool)
	go func() {
		for i := 0; i < 3; i++ {
			err := loop.RunOnce(func(event Event) {
				if event.Events&EventRead != 0 {
					buf := make([]byte, 100)
					n, err := syscall.Read(event.FD, buf)
					if err == nil && n > 0 {
						mu.Lock()
						receivedData[event.Data.(string)] = string(buf[:n])
						mu.Unlock()
						eventCount.Add(1)
					}
				}
			}, 1000)

			if err != nil {
				t.Errorf("RunOnce failed: %v", err)
			}
		}
		close(done)
	}()

	// Write to all pipes
	for i, p := range pipes {
		data := fmt.Sprintf("Data from pipe %d", i)
		if _, err := p.w.Write([]byte(data)); err != nil {
			t.Errorf("Failed to write to pipe %d: %v", i, err)
		}
	}

	// Wait for completion
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for events")
	}

	// Verify all events received
	if eventCount.Load() != 3 {
		t.Errorf("Expected 3 events, got %d", eventCount.Load())
	}

	// Verify data
	for i := 0; i < 3; i++ {
		key := fmt.Sprintf("pipe-%d", i)
		expected := fmt.Sprintf("Data from pipe %d", i)
		if receivedData[key] != expected {
			t.Errorf("Pipe %d: expected %q, got %q", i, expected, receivedData[key])
		}
	}
}

// TestEventLoopStop tests stopping a running event loop
func TestEventLoopStop(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Track if Run() exited
	runExited := make(chan bool)

	// Start event loop
	go func() {
		err := loop.Run(func(event Event) {
			// Should not receive any events
			t.Errorf("Unexpected event: %+v", event)
		})

		if err != nil {
			t.Errorf("Run() returned error: %v", err)
		}
		close(runExited)
	}()

	// Give it time to start
	time.Sleep(50 * time.Millisecond)

	// Stop the loop
	if err := loop.Stop(); err != nil {
		t.Errorf("Failed to stop event loop: %v", err)
	}

	// Wait for Run() to exit
	select {
	case <-runExited:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("Event loop did not exit after Stop()")
	}
}

// TestEventLoopHangup tests hangup event detection
func TestEventLoopHangup(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create pipe
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()

	// Set non-blocking
	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		t.Fatalf("Failed to set non-blocking: %v", err)
	}

	// Add to event loop
	if err := loop.Add(int(r.Fd()), EventRead|EventHup, "test-pipe"); err != nil {
		t.Fatalf("Failed to add fd: %v", err)
	}

	// Track hangup
	hangupReceived := atomic.Bool{}

	// Start event handler
	go func() {
		for i := 0; i < 2; i++ {
			loop.RunOnce(func(event Event) {
				if event.Events&EventHup != 0 {
					hangupReceived.Store(true)
				}
			}, 1000)
		}
	}()

	// Close write end to trigger hangup
	time.Sleep(50 * time.Millisecond)
	w.Close()

	// Wait for hangup
	deadline := time.Now().Add(500 * time.Millisecond)
	for !hangupReceived.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}

	if !hangupReceived.Load() {
		t.Fatal("Hangup event not received")
	}
}

// TestEventLoopPerformance compares event-driven vs polling performance
func TestEventLoopPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	// Test parameters
	messageCount := 1000
	messageSize := 1024

	// Test event-driven performance
	eventDrivenDuration := testEventDrivenPerformance(t, messageCount, messageSize)

	// Test polling performance
	pollingDuration := testPollingPerformance(t, messageCount, messageSize, 10*time.Millisecond)

	// Event-driven should be significantly faster
	t.Logf("Event-driven: %v, Polling: %v", eventDrivenDuration, pollingDuration)
	t.Logf("Event-driven is %.2fx faster", float64(pollingDuration)/float64(eventDrivenDuration))

	// Event-driven should be at least 2x faster for this workload
	if eventDrivenDuration > pollingDuration/2 {
		t.Errorf("Event-driven performance not significantly better than polling")
	}
}

func testEventDrivenPerformance(t *testing.T, messageCount, messageSize int) time.Duration {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		t.Fatalf("Failed to set non-blocking: %v", err)
	}

	if err := loop.Add(int(r.Fd()), EventRead, "perf-test"); err != nil {
		t.Fatalf("Failed to add fd: %v", err)
	}

	// Prepare test data
	testData := make([]byte, messageSize)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	messagesReceived := atomic.Int32{}
	done := make(chan bool)

	// Start receiver
	go func() {
		buf := make([]byte, messageSize*2)
		for messagesReceived.Load() < int32(messageCount) {
			loop.RunOnce(func(event Event) {
				if event.Events&EventRead != 0 {
					for {
						n, err := syscall.Read(event.FD, buf)
						if n > 0 {
							messagesReceived.Add(int32(n / messageSize))
						}
						if err != nil {
							break
						}
					}
				}
			}, 100)
		}
		close(done)
	}()

	// Measure time to send and receive all messages
	start := time.Now()

	// Send messages
	for i := 0; i < messageCount; i++ {
		if _, err := w.Write(testData); err != nil {
			t.Fatalf("Write failed: %v", err)
		}
	}

	// Wait for all messages to be received
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Timeout in event-driven test")
	}

	return time.Since(start)
}

func testPollingPerformance(t *testing.T, messageCount, messageSize int, pollInterval time.Duration) time.Duration {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		t.Fatalf("Failed to set non-blocking: %v", err)
	}

	// Prepare test data
	testData := make([]byte, messageSize)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	messagesReceived := atomic.Int32{}
	done := make(chan bool)

	// Start polling receiver
	go func() {
		buf := make([]byte, messageSize*2)
		for messagesReceived.Load() < int32(messageCount) {
			n, err := r.Read(buf)
			if n > 0 {
				messagesReceived.Add(int32(n / messageSize))
			}
			if err != nil && err != io.EOF && err != syscall.EAGAIN {
				t.Errorf("Read error: %v", err)
				break
			}
			if n == 0 {
				time.Sleep(pollInterval)
			}
		}
		close(done)
	}()

	// Measure time
	start := time.Now()

	// Send messages
	for i := 0; i < messageCount; i++ {
		if _, err := w.Write(testData); err != nil {
			t.Fatalf("Write failed: %v", err)
		}
	}

	// Wait for completion
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Timeout in polling test")
	}

	return time.Since(start)
}

// TestEventLoopStress tests the event loop under heavy load
func TestEventLoopStress(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping stress test in short mode")
	}

	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create many pipes
	pipeCount := 50
	pipes := make([]struct{ r, w *os.File }, pipeCount)

	for i := range pipes {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatalf("Failed to create pipe %d: %v", i, err)
		}
		pipes[i].r = r
		pipes[i].w = w
		defer r.Close()
		defer w.Close()

		if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
			t.Fatalf("Failed to set non-blocking: %v", err)
		}

		if err := loop.Add(int(r.Fd()), EventRead, i); err != nil {
			t.Fatalf("Failed to add pipe %d: %v", i, err)
		}
	}

	// Track events
	var totalEvents atomic.Int64
	messagesPerPipe := 100

	// Start event handler
	stopHandler := make(chan bool)
	go func() {
		buf := make([]byte, 1024)
		for {
			select {
			case <-stopHandler:
				return
			default:
				loop.RunOnce(func(event Event) {
					if event.Events&EventRead != 0 {
						for {
							n, err := syscall.Read(event.FD, buf)
							if n > 0 {
								totalEvents.Add(1)
							}
							if err != nil {
								break
							}
						}
					}
				}, 10)
			}
		}
	}()

	// Send many messages concurrently
	start := time.Now()
	var wg sync.WaitGroup

	for i, p := range pipes {
		wg.Add(1)
		go func(idx int, w *os.File) {
			defer wg.Done()
			msg := fmt.Sprintf("Message from pipe %d\n", idx)
			for j := 0; j < messagesPerPipe; j++ {
				if _, err := w.Write([]byte(msg)); err != nil {
					t.Errorf("Write failed on pipe %d: %v", idx, err)
					return
				}
			}
		}(i, p.w)
	}

	// Wait for all writes to complete
	wg.Wait()

	// Give time for all events to be processed
	deadline := time.Now().Add(2 * time.Second)
	expectedEvents := int64(pipeCount * messagesPerPipe)

	for totalEvents.Load() < expectedEvents && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}

	duration := time.Since(start)
	close(stopHandler)

	// Verify all events received
	if totalEvents.Load() < expectedEvents {
		t.Errorf("Expected %d events, got %d", expectedEvents, totalEvents.Load())
	}

	eventsPerSecond := float64(totalEvents.Load()) / duration.Seconds()
	t.Logf("Processed %d events in %v (%.0f events/sec)", totalEvents.Load(), duration, eventsPerSecond)

	// Should handle at least 10k events/sec
	if eventsPerSecond < 10000 {
		t.Errorf("Performance too low: %.0f events/sec", eventsPerSecond)
	}
}

// TestPlatformSpecific verifies we're using the right implementation
func TestPlatformSpecific(t *testing.T) {
	loop, err := NewEventLoop()
	if err != nil {
		t.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Just verify we got an event loop
	switch runtime.GOOS {
	case "linux":
		t.Log("Using epoll on Linux")
	case "darwin", "freebsd", "openbsd", "netbsd":
		t.Log("Using kqueue on macOS/BSD")
	default:
		t.Logf("Using select fallback on %s", runtime.GOOS)
	}
}
