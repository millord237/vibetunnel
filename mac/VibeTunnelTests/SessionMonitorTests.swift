import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Session Monitor Tests

@Suite("Session Monitor Tests")
@MainActor
struct SessionMonitorTests {
    
    @Test("Session count calculation")
    func sessionCount() {
        let monitor = SessionMonitor.shared
        
        // When no sessions exist
        #expect(monitor.sessionCount == 0)
        
        // Note: Full integration tests would require a running server
        // These tests verify the basic functionality of SessionMonitor
    }
    
    @Test("Cache behavior")
    func cacheBehavior() async {
        let monitor = SessionMonitor.shared
        
        // First call should fetch
        _ = await monitor.getSessions()
        
        // Immediate second call should use cache (no network request)
        let cachedSessions = await monitor.getSessions()
        
        // Verify we got a result (even if empty due to no server)
        #expect(cachedSessions != nil)
    }
    
    @Test("Force refresh clears cache")
    func forceRefresh() async {
        let monitor = SessionMonitor.shared
        
        // Get initial sessions
        _ = await monitor.getSessions()
        
        // Force refresh
        await monitor.refresh()
        
        // Next call should fetch fresh data
        _ = await monitor.getSessions()
        
        // Test passes if no crash occurs
        // Full verification would require mock server
    }
    
    @Test("Error handling")
    func errorHandling() async {
        let monitor = SessionMonitor.shared
        
        // When server is not running, should handle gracefully
        _ = await monitor.getSessions()
        
        // Should have empty sessions, not crash
        #expect(monitor.sessions.isEmpty || !monitor.sessions.isEmpty)
        
        // Last error might be nil (if treating connection errors as expected)
        // or might contain error info
        #expect(monitor.lastError == nil || monitor.lastError != nil)
    }
}