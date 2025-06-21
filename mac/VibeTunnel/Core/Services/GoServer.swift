import Foundation
import OSLog

/// Log entry from the server.
struct ServerLogEntry {
    /// Severity level of the log entry.
    enum Level {
        case debug
        case info
        case warning
        case error
    }

    let timestamp: Date
    let level: Level
    let message: String

    init(level: Level = .info, message: String) {
        self.timestamp = Date()
        self.level = level
        self.message = message
    }
}

/// Go vibetunnel server implementation.
///
/// Manages the external vibetunnel Go binary as a subprocess. This implementation
/// provides high-performance terminal multiplexing by leveraging the Go-based
/// vibetunnel server. It handles process lifecycle, log streaming, and error recovery.
@MainActor
final class GoServer: BaseProcessServer {
    override var serverType: ServerType { .go }

    init() {
        super.init(loggerCategory: "GoServer")
    }

    override func start() async throws {
        guard !isRunning else {
            logger.warning("Go server already running")
            return
        }

        guard !port.isEmpty else {
            let error = GoServerError.invalidPort
            logger.error("Port not configured")
            logContinuation?.yield(ServerLogEntry(level: .error, message: error.localizedDescription))
            throw error
        }

        logger.info("Starting Go vibetunnel server on port \(self.port)")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Initializing Go vibetunnel server..."
        ))

        // Get the vibetunnel binary path
        let binaryPath = Bundle.main.path(forResource: "vibetunnel", ofType: nil)

        // Check if Go was not available during build (indicated by .disabled file)
        let disabledPath = Bundle.main.path(forResource: "vibetunnel", ofType: "disabled")
        if disabledPath != nil {
            let error = GoServerError.goNotInstalled
            logger.error("Go was not available during build")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Go server is not available. Please install Go and rebuild the app to enable Go server support."
            ))
            throw error
        }

        guard let binaryPath else {
            let error = GoServerError.binaryNotFound
            logger.error("vibetunnel binary not found in bundle")
            logContinuation?.yield(ServerLogEntry(level: .error, message: error.localizedDescription))
            throw error
        }

        // Ensure binary is executable
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binaryPath)

        // Verify binary exists and is executable
        var isDirectory: ObjCBool = false
        let fileExists = FileManager.default.fileExists(atPath: binaryPath, isDirectory: &isDirectory)
        logger.info("vibetunnel binary exists: \(fileExists), is directory: \(isDirectory.boolValue)")

        if fileExists && !isDirectory.boolValue {
            let attributes = try FileManager.default.attributesOfItem(atPath: binaryPath)
            if let permissions = attributes[.posixPermissions] as? NSNumber {
                logger.info("vibetunnel binary permissions: \(String(permissions.intValue, radix: 8))")
            }
            if let fileSize = attributes[.size] as? NSNumber {
                logger.info("vibetunnel binary size: \(fileSize.intValue) bytes")
            }

            // Log binary architecture info
            logContinuation?.yield(ServerLogEntry(
                level: .debug,
                message: "Binary path: \(binaryPath)"
            ))
        } else if !fileExists {
            logger.error("vibetunnel binary NOT FOUND at: \(binaryPath)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Binary not found at: \(binaryPath)"
            ))
        }

        // Create the process using login shell
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")

        // Get the Resources directory path
        let resourcesPath = Bundle.main.resourcePath ?? Bundle.main.bundlePath

        // Set working directory to Resources directory
        process.currentDirectoryURL = URL(fileURLWithPath: resourcesPath)
        logger.info("Working directory: \(resourcesPath)")

        // Static files are always at Resources/web/public
        let staticPath = URL(fileURLWithPath: resourcesPath).appendingPathComponent("web/public").path

        // Verify the web directory exists
        if !FileManager.default.fileExists(atPath: staticPath) {
            logger.error("Web directory not found at expected location: \(staticPath)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Web directory not found at: \(staticPath)"
            ))
        }

        // Build command to run vibetunnel through login shell
        // Use bind address from ServerManager to control server accessibility
        let bindAddress = ServerManager.shared.bindAddress

        var vibetunnelCommand =
            "\"\(binaryPath)\" --static-path \"\(staticPath)\" --serve --bind \(bindAddress) --port \(port)"

        // Add password flag if password protection is enabled
        // Only check if password exists, don't retrieve it yet
        if UserDefaults.standard.bool(forKey: "dashboardPasswordEnabled") && DashboardKeychain.shared.hasPassword() {
            logger.info("Password protection enabled, retrieving from keychain")
            if let password = DashboardKeychain.shared.getPassword() {
                // Escape the password for shell
                let escapedPassword = password.replacingOccurrences(of: "\"", with: "\\\"")
                    .replacingOccurrences(of: "$", with: "\\$")
                    .replacingOccurrences(of: "`", with: "\\`")
                    .replacingOccurrences(of: "\\", with: "\\\\")
                vibetunnelCommand += " --password \"\(escapedPassword)\" --password-enabled"
            }
        }

        // Add cleanup on startup flag if enabled
        if UserDefaults.standard.bool(forKey: "cleanupOnStartup") {
            vibetunnelCommand += " --cleanup-startup"
        }

        process.arguments = ["-l", "-c", vibetunnelCommand]

        logger.info("Executing command: /bin/zsh -l -c \"\(vibetunnelCommand)\"")
        logger.info("Working directory: \(resourcesPath)")

        // Set up environment - login shell will load the rest
        var environment = ProcessInfo.processInfo.environment
        environment["RUST_LOG"] = "info" // Go server also respects RUST_LOG for compatibility
        process.environment = environment

        // Set up pipes for stdout and stderr
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        self.process = process
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe

        // Start monitoring output
        startOutputMonitoring()

        do {
            // Start the process (this just launches it and returns immediately)
            try await processHandler.runProcess(process)

            // Mark server as running
            isRunning = true

            logger.info("Go server process started")

            // Give the process a moment to start before checking for early failures
            try await Task.sleep(for: .milliseconds(100))

            // Check if process exited immediately (indicating failure)
            if !process.isRunning {
                isRunning = false
                let exitCode = process.terminationStatus
                logger.error("Process exited immediately with code: \(exitCode)")

                // Try to read any error output
                var errorDetails = "Exit code: \(exitCode)"
                if let stderrPipe = self.stderrPipe {
                    let errorData = stderrPipe.fileHandleForReading.availableData
                    if !errorData.isEmpty, let errorOutput = String(data: errorData, encoding: .utf8) {
                        errorDetails += "\nError: \(errorOutput.trimmingCharacters(in: .whitespacesAndNewlines))"
                    }
                }

                logContinuation?.yield(ServerLogEntry(
                    level: .error,
                    message: "Server failed to start: \(errorDetails)"
                ))

                throw GoServerError.processFailedToStart
            }

            logger.info("Go server process started successfully")
            logContinuation?.yield(ServerLogEntry(
                level: .info,
                message: "Go vibetunnel server is ready"
            ))

            // Monitor process termination
            Task {
                await monitorProcessTermination()
            }
        } catch {
            isRunning = false

            // Log more detailed error information
            let errorMessage: String
            if let goError = error as? GoServerError {
                errorMessage = goError.localizedDescription
            } else if let nsError = error as NSError? {
                errorMessage = "\(nsError.localizedDescription) (Code: \(nsError.code), Domain: \(nsError.domain))"
                if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] {
                    logger.error("Underlying error: \(String(describing: underlyingError))")
                }
            } else {
                errorMessage = String(describing: error)
            }

            logger.error("Failed to start Go server: \(errorMessage)")
            logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Failed to start Go server: \(errorMessage)"
            ))
            throw error
        }
    }

    func restart() async throws {
        logger.info("Restarting Go server")
        logContinuation?.yield(ServerLogEntry(level: .info, message: "Restarting server"))

        await stop()
        try await start()
    }
    
    override func getStaticFilesPath() -> String? {
        guard let resourcesPath = Bundle.main.resourcePath else { return nil }
        return URL(fileURLWithPath: resourcesPath).appendingPathComponent("web/public").path
    }

    // MARK: - Private Methods
    
    private func monitorProcessTermination() async {
        guard let process else { return }

        // Wait for process exit on background thread
        await processHandler.waitForExit(process)

        if self.isRunning {
            // Unexpected termination
            let exitCode = process.terminationStatus
            self.logger.error("Go server terminated unexpectedly with exit code: \(exitCode)")
            self.logContinuation?.yield(ServerLogEntry(
                level: .error,
                message: "Server terminated unexpectedly with exit code: \(exitCode)"
            ))

            self.isRunning = false

            // Auto-restart on unexpected termination
            Task {
                try? await Task.sleep(for: .seconds(2))
                if self.process == nil { // Only restart if not manually stopped
                    self.logger.info("Auto-restarting Go server after crash")
                    self.logContinuation?.yield(ServerLogEntry(
                        level: .info,
                        message: "Auto-restarting server after crash"
                    ))
                    try? await self.start()
                }
            }
        }
    }
}

// MARK: - Errors

enum GoServerError: LocalizedError {
    case binaryNotFound
    case processFailedToStart
    case invalidPort
    case goNotInstalled

    var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            "The vibetunnel binary was not found in the app bundle"
        case .processFailedToStart:
            "The server process failed to start"
        case .invalidPort:
            "Server port is not configured"
        case .goNotInstalled:
            "Go is not installed. Please install Go and rebuild the app to enable Go server support"
        }
    }
}
