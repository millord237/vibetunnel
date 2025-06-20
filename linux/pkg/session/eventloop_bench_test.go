package session

import (
	"fmt"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// BenchmarkEventLoopThroughput measures event processing throughput
func BenchmarkEventLoopThroughput(b *testing.B) {
	loop, err := NewEventLoop()
	if err != nil {
		b.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create pipe
	r, w, err := os.Pipe()
	if err != nil {
		b.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		b.Fatalf("Failed to set non-blocking: %v", err)
	}

	if err := loop.Add(int(r.Fd()), EventRead, "bench-pipe"); err != nil {
		b.Fatalf("Failed to add fd: %v", err)
	}

	// Prepare data
	data := make([]byte, 1024)
	for i := range data {
		data[i] = byte(i % 256)
	}

	eventsProcessed := atomic.Int64{}

	// Start event handler
	stopHandler := make(chan bool)
	go func() {
		buf := make([]byte, 4096)
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
								eventsProcessed.Add(1)
							}
							if err != nil {
								break
							}
						}
					}
				}, 1)
			}
		}
	}()

	b.ResetTimer()

	// Benchmark: write N messages
	for i := 0; i < b.N; i++ {
		if _, err := w.Write(data); err != nil {
			b.Fatalf("Write failed: %v", err)
		}
	}

	// Wait for all events to be processed
	deadline := time.Now().Add(5 * time.Second)
	for eventsProcessed.Load() < int64(b.N) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	b.StopTimer()
	close(stopHandler)

	if eventsProcessed.Load() < int64(b.N) {
		b.Errorf("Only processed %d/%d events", eventsProcessed.Load(), b.N)
	}

	b.ReportMetric(float64(eventsProcessed.Load())/b.Elapsed().Seconds(), "events/sec")
}

// BenchmarkEventLoopLatency measures event notification latency
func BenchmarkEventLoopLatency(b *testing.B) {
	loop, err := NewEventLoop()
	if err != nil {
		b.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create pipe
	r, w, err := os.Pipe()
	if err != nil {
		b.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		b.Fatalf("Failed to set non-blocking: %v", err)
	}

	if err := loop.Add(int(r.Fd()), EventRead, "latency-pipe"); err != nil {
		b.Fatalf("Failed to add fd: %v", err)
	}

	// Measure latency for each write
	latencies := make([]time.Duration, 0, b.N)
	var mu sync.Mutex

	// Start event handler
	eventReceived := make(chan time.Time, 1)
	stopHandler := make(chan bool)

	go func() {
		buf := make([]byte, 1)
		for {
			select {
			case <-stopHandler:
				return
			default:
				loop.RunOnce(func(event Event) {
					if event.Events&EventRead != 0 {
						receiveTime := time.Now()
						syscall.Read(event.FD, buf)
						select {
						case eventReceived <- receiveTime:
						default:
						}
					}
				}, 100)
			}
		}
	}()

	b.ResetTimer()

	// Benchmark: measure latency for each event
	for i := 0; i < b.N; i++ {
		sendTime := time.Now()

		if _, err := w.Write([]byte{1}); err != nil {
			b.Fatalf("Write failed: %v", err)
		}

		select {
		case receiveTime := <-eventReceived:
			latency := receiveTime.Sub(sendTime)
			mu.Lock()
			latencies = append(latencies, latency)
			mu.Unlock()
		case <-time.After(10 * time.Millisecond):
			b.Fatal("Event not received within timeout")
		}

		// Small delay between iterations
		time.Sleep(time.Millisecond)
	}

	b.StopTimer()
	close(stopHandler)

	// Calculate statistics
	var total time.Duration
	var min, max time.Duration

	for i, lat := range latencies {
		total += lat
		if i == 0 || lat < min {
			min = lat
		}
		if i == 0 || lat > max {
			max = lat
		}
	}

	avg := total / time.Duration(len(latencies))

	b.ReportMetric(float64(avg.Nanoseconds()), "ns/event")
	b.ReportMetric(float64(min.Nanoseconds()), "min-ns")
	b.ReportMetric(float64(max.Nanoseconds()), "max-ns")
}

// BenchmarkEventLoopScaling measures how performance scales with file descriptors
func BenchmarkEventLoopScaling(b *testing.B) {
	fdCounts := []int{1, 10, 50, 100, 500}

	for _, fdCount := range fdCounts {
		b.Run(fmt.Sprintf("fds-%d", fdCount), func(b *testing.B) {
			benchmarkEventLoopWithFDs(b, fdCount)
		})
	}
}

func benchmarkEventLoopWithFDs(b *testing.B, fdCount int) {
	loop, err := NewEventLoop()
	if err != nil {
		b.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	// Create pipes
	pipes := make([]struct{ r, w *os.File }, fdCount)
	for i := range pipes {
		r, w, err := os.Pipe()
		if err != nil {
			b.Fatalf("Failed to create pipe %d: %v", i, err)
		}
		pipes[i].r = r
		pipes[i].w = w
		defer r.Close()
		defer w.Close()

		if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
			b.Fatalf("Failed to set non-blocking: %v", err)
		}

		if err := loop.Add(int(r.Fd()), EventRead, i); err != nil {
			b.Fatalf("Failed to add fd %d: %v", i, err)
		}
	}

	eventsProcessed := atomic.Int64{}

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
						n, _ := syscall.Read(event.FD, buf)
						if n > 0 {
							eventsProcessed.Add(1)
						}
					}
				}, 1)
			}
		}
	}()

	b.ResetTimer()

	// Write to all pipes
	data := []byte("test")
	messagesPerPipe := b.N / fdCount
	if messagesPerPipe == 0 {
		messagesPerPipe = 1
	}

	var wg sync.WaitGroup
	for i, p := range pipes {
		wg.Add(1)
		go func(idx int, w *os.File) {
			defer wg.Done()
			for j := 0; j < messagesPerPipe; j++ {
				if _, err := w.Write(data); err != nil {
					b.Errorf("Write failed on pipe %d: %v", idx, err)
					return
				}
			}
		}(i, p.w)
	}

	wg.Wait()

	// Wait for processing
	expectedEvents := int64(fdCount * messagesPerPipe)
	deadline := time.Now().Add(5 * time.Second)
	for eventsProcessed.Load() < expectedEvents && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	b.StopTimer()
	close(stopHandler)

	b.ReportMetric(float64(eventsProcessed.Load())/b.Elapsed().Seconds(), "events/sec")
	b.ReportMetric(float64(eventsProcessed.Load())/float64(fdCount)/b.Elapsed().Seconds(), "events/sec/fd")
}

// BenchmarkPollingComparison compares event-driven vs polling performance
func BenchmarkPollingComparison(b *testing.B) {
	b.Run("EventDriven", func(b *testing.B) {
		benchmarkWithEventLoop(b)
	})

	b.Run("Polling-1ms", func(b *testing.B) {
		benchmarkWithPolling(b, time.Millisecond)
	})

	b.Run("Polling-10ms", func(b *testing.B) {
		benchmarkWithPolling(b, 10*time.Millisecond)
	})

	b.Run("Polling-100ms", func(b *testing.B) {
		benchmarkWithPolling(b, 100*time.Millisecond)
	})
}

func benchmarkWithEventLoop(b *testing.B) {
	loop, err := NewEventLoop()
	if err != nil {
		b.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	r, w, err := os.Pipe()
	if err != nil {
		b.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		b.Fatalf("Failed to set non-blocking: %v", err)
	}

	if err := loop.Add(int(r.Fd()), EventRead, "bench"); err != nil {
		b.Fatalf("Failed to add fd: %v", err)
	}

	processed := atomic.Int64{}

	// Start handler
	stop := make(chan bool)
	go func() {
		buf := make([]byte, 1024)
		for {
			select {
			case <-stop:
				return
			default:
				loop.RunOnce(func(event Event) {
					if event.Events&EventRead != 0 {
						n, _ := syscall.Read(event.FD, buf)
						if n > 0 {
							processed.Add(int64(n))
						}
					}
				}, 10)
			}
		}
	}()

	data := make([]byte, 1024)
	b.ResetTimer()

	totalBytes := int64(0)
	for i := 0; i < b.N; i++ {
		n, err := w.Write(data)
		if err != nil {
			b.Fatalf("Write failed: %v", err)
		}
		totalBytes += int64(n)
	}

	// Wait for processing
	deadline := time.Now().Add(5 * time.Second)
	for processed.Load() < totalBytes && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	b.StopTimer()
	close(stop)

	b.SetBytes(totalBytes)
	b.ReportMetric(float64(processed.Load())/b.Elapsed().Seconds(), "bytes/sec")
}

func benchmarkWithPolling(b *testing.B, interval time.Duration) {
	r, w, err := os.Pipe()
	if err != nil {
		b.Fatalf("Failed to create pipe: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		b.Fatalf("Failed to set non-blocking: %v", err)
	}

	processed := atomic.Int64{}

	// Start polling reader
	stop := make(chan bool)
	go func() {
		buf := make([]byte, 1024)
		for {
			select {
			case <-stop:
				return
			default:
				n, err := r.Read(buf)
				if n > 0 {
					processed.Add(int64(n))
				}
				if err != nil && err != syscall.EAGAIN {
					return
				}
				if n == 0 {
					time.Sleep(interval)
				}
			}
		}
	}()

	data := make([]byte, 1024)
	b.ResetTimer()

	totalBytes := int64(0)
	for i := 0; i < b.N; i++ {
		n, err := w.Write(data)
		if err != nil {
			b.Fatalf("Write failed: %v", err)
		}
		totalBytes += int64(n)
	}

	// Wait for processing
	deadline := time.Now().Add(10 * time.Second)
	for processed.Load() < totalBytes && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}

	b.StopTimer()
	close(stop)

	b.SetBytes(totalBytes)
	b.ReportMetric(float64(processed.Load())/b.Elapsed().Seconds(), "bytes/sec")
}

// BenchmarkPlatformComparison compares platform-specific implementations
func BenchmarkPlatformComparison(b *testing.B) {
	loop, err := NewEventLoop()
	if err != nil {
		b.Fatalf("Failed to create event loop: %v", err)
	}
	defer loop.Close()

	implName := "unknown"
	switch runtime.GOOS {
	case "linux":
		implName = "epoll"
	case "darwin":
		implName = "kqueue"
	default:
		implName = "select"
	}

	b.Run(implName, func(b *testing.B) {
		benchmarkWithEventLoop(b)
	})

	b.Logf("Platform: %s, Implementation: %s", runtime.GOOS, implName)
}
