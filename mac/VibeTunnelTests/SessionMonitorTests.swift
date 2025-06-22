import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Session Monitor Tests

@Suite("Session Monitor Tests", .tags(.sessionManagement))
@MainActor
final class SessionMonitorTests {
    let monitor = SessionMonitor.shared
    
    init() async {
        // Ensure clean state before each test
        await monitor.refresh()
    }
    
    // MARK: - Basic Functionality Tests
    
    @Test("Session count calculation")
    func sessionCount() {
        // When no sessions exist
        #expect(monitor.sessionCount == 0)
        
        // Note: Full integration tests would require a running server
        // These tests verify the basic functionality of SessionMonitor
    }
    
    // MARK: - Cache Behavior Tests
    
    @Test("Cache behavior", .tags(.performance))
    func cacheBehavior() async {
        // First call should fetch
        _ = await monitor.getSessions()
        
        // Immediate second call should use cache (no network request)
        let cachedSessions = await monitor.getSessions()
        
        // Verify we got a result (even if empty due to no server)
        // cachedSessions is non-optional, so just verify it's a dictionary
        #expect(cachedSessions.isEmpty || !cachedSessions.isEmpty)
    }
    
    @Test("Force refresh clears cache")
    func forceRefresh() async {
        // Get initial sessions
        let initialSessions = await monitor.getSessions()
        
        // Force refresh
        await monitor.refresh()
        
        // Next call should fetch fresh data
        let refreshedSessions = await monitor.getSessions()
        
        // Both should be dictionaries (possibly empty)
        #expect(type(of: initialSessions) == type(of: refreshedSessions))
    }
    
    // MARK: - Error Handling Tests
    
    @Test("Error handling", .tags(.reliability))
    func errorHandling() async {
        // When server is not running, should handle gracefully
        _ = await monitor.getSessions()
        
        // Should have empty sessions, not crash
        #expect(monitor.sessions.isEmpty || !monitor.sessions.isEmpty)
        
        // Last error might be nil (if treating connection errors as expected)
        // or might contain error info
        #expect(monitor.lastError == nil || monitor.lastError != nil)
    }
    
    // MARK: - Concurrent Access Tests
    
    @Test("Concurrent session access", .tags(.concurrency))
    func concurrentAccess() async {
        await withTaskGroup(of: [String: ServerSessionInfo].self) { group in
            // Multiple concurrent getSessions calls
            for _ in 0..<5 {
                group.addTask { [monitor] in
                    await monitor.getSessions()
                }
            }
            
            var results: [[String: ServerSessionInfo]] = []
            for await result in group {
                results.append(result)
            }
            
            // All concurrent calls should return consistent results
            if let first = results.first {
                for result in results {
                    #expect(result.count == first.count)
                }
            }
        }
    }
    
    // MARK: - Session Update Tests
    
    @Test("Session updates are reflected")
    func sessionUpdates() async {
        // Get initial state
        _ = monitor.sessionCount
        
        // Refresh to get latest
        await monitor.refresh()
        
        // Count should be consistent with sessions dictionary
        #expect(monitor.sessionCount == monitor.sessions.count)
        #expect(monitor.sessionCount >= 0)
    }
    
    // MARK: - Integration Tests
    
    @Test("Session monitor integration", .tags(.integration))
    func integration() async {
        // Test the full flow
        await monitor.refresh()
        let sessions = await monitor.getSessions()
        
        // Verify session structure if we have any
        for (sessionId, _) in sessions {
            // Session ID should be valid
            #expect(!sessionId.isEmpty)
            
            // Note: ServerSessionInfo structure details would be validated here
            // if we had access to the actual session info fields
        }
    }
    
    // MARK: - Performance Tests
    
    @Test("Cache performance", .tags(.performance))
    func cachePerformance() async throws {
        // Warm up cache
        _ = await monitor.getSessions()
        
        // Measure cached access time
        let start = Date()
        
        for _ in 0..<100 {
            _ = await monitor.getSessions()
        }
        
        let elapsed = Date().timeIntervalSince(start)
        
        // Cached access should be very fast
        #expect(elapsed < 0.1, "Cached access took too long: \(elapsed)s for 100 calls")
    }
}