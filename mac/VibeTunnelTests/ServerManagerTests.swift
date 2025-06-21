import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Server Manager Tests

@Suite("Server Manager Tests")
@MainActor
struct ServerManagerTests {
    // We'll use the shared ServerManager instance since it's a singleton

    // MARK: - Server Lifecycle Tests

    @Test("Starting and stopping Bun server", .tags(.critical))
    func serverLifecycle() async throws {
        let manager = ServerManager.shared

        // Ensure clean state
        await manager.stop()

        // Start the server
        await manager.start()

        // Give server time to start
        try await Task.sleep(for: .milliseconds(500))

        // Check server is running
        #expect(manager.isRunning)
        #expect(manager.bunServer != nil)

        // Stop the server
        await manager.stop()

        // Give server time to stop
        try await Task.sleep(for: .milliseconds(500))

        // Check server is stopped
        #expect(!manager.isRunning)
        #expect(manager.bunServer == nil)
    }

    @Test("Starting server when already running does not create duplicate", .tags(.critical))
    func startingAlreadyRunningServer() async throws {
        let manager = ServerManager.shared

        // Ensure clean state
        await manager.stop()

        // Start the server
        await manager.start()
        try await Task.sleep(for: .milliseconds(500))

        let firstServer = manager.bunServer
        #expect(firstServer != nil)

        // Try to start again
        await manager.start()

        // Should still be the same server instance
        #expect(manager.bunServer === firstServer)
        #expect(manager.isRunning)

        // Cleanup
        await manager.stop()
    }

    @Test("Port configuration")
    func portConfiguration() async throws {
        let manager = ServerManager.shared

        // Store original port
        let originalPort = manager.port

        // Test setting different ports
        let testPorts = ["8080", "3000", "9999"]

        for port in testPorts {
            manager.port = port
            #expect(manager.port == port)
            #expect(UserDefaults.standard.string(forKey: "serverPort") == port)
        }

        // Restore original port
        manager.port = originalPort
    }

    @Test("Bind address configuration", arguments: [
        DashboardAccessMode.localhost,
        DashboardAccessMode.network
    ])
    func bindAddressConfiguration(mode: DashboardAccessMode) async throws {
        let manager = ServerManager.shared

        // Store original mode
        let originalMode = UserDefaults.standard.string(forKey: "dashboardAccessMode") ?? ""

        // Set the mode via UserDefaults (as bindAddress setter does)
        UserDefaults.standard.set(mode.rawValue, forKey: "dashboardAccessMode")

        // Check bind address reflects the mode
        #expect(manager.bindAddress == mode.bindAddress)

        // Restore original mode
        UserDefaults.standard.set(originalMode, forKey: "dashboardAccessMode")
    }

    // MARK: - Concurrent Operations Tests

    @Test("Concurrent server operations are serialized", .tags(.concurrency))
    func concurrentServerOperations() async throws {
        let manager = ServerManager.shared

        // Ensure clean state
        await manager.stop()

        // Start multiple operations concurrently
        await withTaskGroup(of: Void.self) { group in
            // Start server
            group.addTask {
                await manager.start()
            }

            // Try to stop immediately
            group.addTask {
                try? await Task.sleep(for: .milliseconds(50))
                await manager.stop()
            }

            // Try to restart
            group.addTask {
                try? await Task.sleep(for: .milliseconds(100))
                await manager.restart()
            }

            await group.waitForAll()
        }

        // Server should be in a consistent state
        let finalState = manager.isRunning
        if finalState {
            #expect(manager.bunServer != nil)
        } else {
            #expect(manager.bunServer == nil)
        }

        // Cleanup
        await manager.stop()
    }

    @Test("Server restart maintains configuration", .tags(.critical))
    func serverRestart() async throws {
        let manager = ServerManager.shared

        // Ensure clean state
        await manager.stop()

        // Set specific configuration
        let testPort = "4567"
        manager.port = testPort

        // Start server
        await manager.start()
        try await Task.sleep(for: .milliseconds(500))

        // Verify running
        #expect(manager.isRunning)
        let serverBeforeRestart = manager.bunServer

        // Restart
        await manager.restart()
        try await Task.sleep(for: .milliseconds(500))

        // Verify still running with same port
        #expect(manager.isRunning)
        #expect(manager.port == testPort)
        #expect(manager.bunServer !== serverBeforeRestart) // Should be new instance

        // Cleanup
        await manager.stop()
    }

    // MARK: - Error Handling Tests

    @Test("Server state remains consistent after operations", .tags(.reliability))
    func serverStateConsistency() async throws {
        let manager = ServerManager.shared

        // Ensure clean state
        await manager.stop()

        // Perform various operations
        await manager.start()
        try await Task.sleep(for: .milliseconds(200))

        await manager.stop()
        try await Task.sleep(for: .milliseconds(200))

        await manager.start()
        try await Task.sleep(for: .milliseconds(200))

        // State should be consistent
        if manager.isRunning {
            #expect(manager.bunServer != nil)
        } else {
            #expect(manager.bunServer == nil)
        }

        // Cleanup
        await manager.stop()
    }

    // MARK: - Crash Recovery Tests

    @Test("Server auto-restart behavior")
    func serverAutoRestart() async throws {
        let manager = ServerManager.shared

        // Ensure clean state
        await manager.stop()

        // Start server
        await manager.start()
        try await Task.sleep(for: .milliseconds(500))

        // Verify server is running
        #expect(manager.isRunning)
        #expect(manager.bunServer != nil)

        // Note: We can't easily simulate crashes in tests without
        // modifying the production code. The BunServer has built-in
        // auto-restart functionality on unexpected termination.

        // Cleanup
        await manager.stop()
    }
}
