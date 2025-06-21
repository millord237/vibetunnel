import Foundation
import Observation
import OSLog
import SwiftUI

/// Manages the VibeTunnel server lifecycle.
///
/// `ServerManager` is the central coordinator for server lifecycle management in VibeTunnel.
/// It handles starting, stopping, and restarting the Go server, manages server configuration,
/// and provides logging capabilities.
@MainActor
@Observable
class ServerManager {
    @MainActor static let shared = ServerManager()
    
    private(set) var serverType: ServerType = .go
    private(set) var isSwitchingServer = false

    var port: String {
        get { UserDefaults.standard.string(forKey: "serverPort") ?? "4020" }
        set { UserDefaults.standard.set(newValue, forKey: "serverPort") }
    }

    var bindAddress: String {
        get {
            let mode = DashboardAccessMode(rawValue: UserDefaults.standard.string(forKey: "dashboardAccessMode") ?? ""
            ) ??
                .localhost
            return mode.bindAddress
        }
        set {
            // Find the mode that matches this bind address
            if let mode = DashboardAccessMode.allCases.first(where: { $0.bindAddress == newValue }) {
                UserDefaults.standard.set(mode.rawValue, forKey: "dashboardAccessMode")
            }
        }
    }

    private var cleanupOnStartup: Bool {
        get { UserDefaults.standard.bool(forKey: "cleanupOnStartup") }
        set { UserDefaults.standard.set(newValue, forKey: "cleanupOnStartup") }
    }

    private(set) var currentServer: VibeTunnelServer?
    private(set) var isRunning = false
    private(set) var isRestarting = false
    private(set) var lastError: Error?

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ServerManager")
    private var logContinuation: AsyncStream<ServerLogEntry>.Continuation?
    private var serverLogTask: Task<Void, Never>?
    private(set) var logStream: AsyncStream<ServerLogEntry>!

    private init() {
        // Load saved server type
        if let savedType = UserDefaults.standard.string(forKey: "serverType"),
           let type = ServerType(rawValue: savedType) {
            self.serverType = type
        }
        
        setupLogStream()

        // Skip observer setup and monitoring during tests
        let isRunningInTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestBundlePath"] != nil ||
            ProcessInfo.processInfo.environment["XCTestSessionIdentifier"] != nil ||
            ProcessInfo.processInfo.arguments.contains("-XCTest") ||
            NSClassFromString("XCTestCase") != nil

        if !isRunningInTests {
            setupObservers()
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        // Tasks will be cancelled when they are deallocated
    }

    private func setupLogStream() {
        logStream = AsyncStream { continuation in
            self.logContinuation = continuation
        }
    }

    private func setupObservers() {
        // Watch for server mode changes when the value actually changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(userDefaultsDidChange),
            name: UserDefaults.didChangeNotification,
            object: nil
        )
    }

    @objc
    private nonisolated func userDefaultsDidChange() {
        // Server mode is now fixed to Go, no need to handle changes
    }

    /// Start the server with current configuration
    func start() async {
        // Check if we already have a running server
        if let existingServer = currentServer {
            logger.info("Server already running on port \(existingServer.port)")

            // Ensure our state is synced
            isRunning = true
            lastError = nil

            // Log for clarity
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Server already running on port \(self.port)"
            ))
            return
        }

        // Check for port conflicts before starting
        if let conflict = await PortConflictResolver.shared.detectConflict(on: Int(self.port) ?? 4_020) {
            logger.warning("Port \(self.port) is in use by \(conflict.process.name) (PID: \(conflict.process.pid))")

            // Handle based on conflict type
            switch conflict.suggestedAction {
            case .killOurInstance(let pid, let processName):
                logger.info("Attempting to kill conflicting process: \(processName) (PID: \(pid))")
                logContinuation?.yield(ServerLogEntry(
                    level: .warning,
                    message: "Port \(self.port) is used by another instance. Terminating conflicting process..."
                ))

                do {
                    try await PortConflictResolver.shared.resolveConflict(conflict)
                    logContinuation?.yield(ServerLogEntry(
                        level: .info,
                        message: "Conflicting process terminated successfully"
                    ))

                    // Wait a moment for port to be fully released
                    try await Task.sleep(for: .milliseconds(500))
                } catch {
                    logger.error("Failed to resolve port conflict: \(error)")
                    lastError = PortConflictError.failedToKillProcess(pid: pid)
                    logContinuation?.yield(ServerLogEntry(
                        level: .error,
                        message: "Failed to terminate conflicting process. Please try a different port."
                    ))
                    return
                }

            case .reportExternalApp(let appName):
                logger.error("Port \(self.port) is used by external app: \(appName)")
                lastError = PortConflictError.portInUseByApp(
                    appName: appName,
                    port: Int(self.port) ?? 4_020,
                    alternatives: conflict.alternativePorts
                )
                logContinuation?.yield(ServerLogEntry(
                    level: .error,
                    message: "Port \(self.port) is used by \(appName). Please choose a different port."
                ))
                return

            case .suggestAlternativePort:
                // This shouldn't happen in our case
                logger.warning("Port conflict requires alternative port")
            }
        }

        // Log that we're starting a server
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Starting server on port \(self.port)..."
        ))

        do {
            let server = createServer(type: serverType)
            server.port = port
            server.bindAddress = bindAddress

            // Subscribe to server logs
            serverLogTask = Task { [weak self] in
                for await entry in server.logStream {
                    self?.logContinuation?.yield(entry)
                }
            }

            try await server.start()

            currentServer = server
            isRunning = true
            lastError = nil

            logger.info("Started server on port \(self.port)")

            // Trigger cleanup of old sessions after server starts
            await triggerInitialCleanup()
        } catch {
            logger.error("Failed to start server: \(error.localizedDescription)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Failed to start server: \(error.localizedDescription)"
            ))
            lastError = error

            // Check if server is actually running despite the error
            if let server = currentServer, server.isRunning {
                logger.warning("Server reported as running despite startup error, syncing state")
                isRunning = true
            } else {
                isRunning = false
            }
        }
    }

    /// Stop the current server
    func stop() async {
        guard let server = currentServer else {
            logger.warning("No server running")
            return
        }

        logger.info("Stopping server")

        // Log that we're stopping the server
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Stopping server..."
        ))

        await server.stop()
        serverLogTask?.cancel()
        serverLogTask = nil
        currentServer = nil
        isRunning = false

        // Log that the server has stopped
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Server stopped"
        ))
    }

    /// Restart the current server
    func restart() async {
        // Set restarting flag to prevent UI from showing "stopped" state
        isRestarting = true
        defer { isRestarting = false }

        // Log that we're restarting
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Restarting server..."
        ))

        await stop()
        await start()
    }


    /// Trigger cleanup of exited sessions after server startup
    private func triggerInitialCleanup() async {
        // Check if cleanup on startup is enabled
        guard cleanupOnStartup else {
            logger.info("Cleanup on startup is disabled in settings")
            return
        }

        logger.info("Triggering initial cleanup of exited sessions")

        // Delay to ensure server is fully ready
        try? await Task.sleep(for: .milliseconds(10000))

        do {
            // Create URL for cleanup endpoint
            guard let url = URL(string: "http://localhost:\(self.port)/api/cleanup-exited") else {
                logger.warning("Failed to create cleanup URL")
                return
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 10

            // Make the cleanup request
            let (data, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                if httpResponse.statusCode == 200 {
                    // Try to parse the response
                    if let jsonData = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let cleanedCount = jsonData["cleaned_count"] as? Int
                    {
                        logger.info("Initial cleanup completed: cleaned \(cleanedCount) exited sessions")
                        logContinuation?.yield(ServerLogEntry(
                            level: .info,
                            message: "Cleaned up \(cleanedCount) exited sessions on startup"
                        ))
                    } else {
                        logger.info("Initial cleanup completed successfully")
                        logContinuation?.yield(ServerLogEntry(
                            level: .info,
                            message: "Cleaned up exited sessions on startup"
                        ))
                    }
                } else {
                    logger.warning("Initial cleanup returned status code: \(httpResponse.statusCode)")
                }
            }
        } catch {
            // Log the error but don't fail startup
            logger.warning("Failed to trigger initial cleanup: \(error.localizedDescription)")
            logContinuation?.yield(ServerLogEntry(
                level: .warning,
                message: "Could not clean up old sessions: \(error.localizedDescription)"
            ))
        }
    }

    /// Manually trigger a server restart (for UI button)
    func manualRestart() async {
        await restart()
    }

    /// Clear the authentication cache (e.g., when password is changed or cleared)
    func clearAuthCache() async {
        // Authentication cache clearing is no longer needed as external servers handle their own auth
        logger.info("Authentication cache clearing requested - handled by external server")
    }
    
    // MARK: - Server Type Management
    
    private func createServer(type: ServerType) -> VibeTunnelServer {
        switch type {
        case .go:
            return GoServer()
        case .node:
            return NodeServer()
        }
    }
    
    /// Switch to a different server type
    /// - Parameter newType: The server type to switch to
    /// - Returns: True if the switch was successful, false otherwise
    @discardableResult
    func switchServer(to newType: ServerType) async -> Bool {
        guard newType != serverType else {
            logger.info("Server type already set to \(newType.displayName)")
            return true
        }
        
        guard !isSwitchingServer else {
            logger.warning("Already switching servers")
            return false
        }
        
        isSwitchingServer = true
        defer { isSwitchingServer = false }
        
        logger.info("Switching server from \(self.serverType.displayName) to \(newType.displayName)")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Switching from \(self.serverType.displayName) to \(newType.displayName) server..."
        ))
        
        // Stop current server if running
        if isRunning {
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Stopping \(self.serverType.displayName) server..."
            ))
            await stop()
        }
        
        // Clean up current server
        if let server = currentServer {
            await server.cleanup()
            currentServer = nil
        }
        
        // Update server type
        self.serverType = newType
        UserDefaults.standard.set(newType.rawValue, forKey: "serverType")
        
        // Start new server type
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Starting \(newType.displayName) server..."
        ))
        
        await start()
        
        // Check if the new server started successfully
        if isRunning {
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Successfully switched to \(newType.displayName) server"
            ))
            return true
        } else {
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Failed to start \(newType.displayName) server"
            ))
            return false
        }
    }

}

// MARK: - Port Conflict Error Extension

extension PortConflictError {
    static func portInUseByApp(appName: String, port: Int, alternatives: [Int]) -> Error {
        NSError(
            domain: "sh.vibetunnel.vibetunnel.ServerManager",
            code: 1_001,
            userInfo: [
                NSLocalizedDescriptionKey: "Port \(port) is in use by \(appName)",
                NSLocalizedFailureReasonErrorKey: "The port is being used by another application",
                NSLocalizedRecoverySuggestionErrorKey: "Try one of these ports: \(alternatives.map(String.init).joined(separator: ", "))",
                "appName": appName,
                "port": port,
                "alternatives": alternatives
            ]
        )
    }
}
