import Foundation
import OSLog

/// Bun vibetunnel server implementation.
///
/// Manages the Bun-based vibetunnel server as a subprocess. This implementation
/// provides JavaScript/TypeScript-based terminal multiplexing by leveraging the Bun
/// runtime. It handles process lifecycle, log streaming, and error recovery.
@MainActor
final class BunServer {
    /// Callback when the server crashes unexpectedly
    var onCrash: ((Int32) -> Void)?

    // MARK: - Properties

    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var outputTask: Task<Void, Never>?
    private var errorTask: Task<Void, Never>?

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "BunServer")
    private let serverOutput = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "ServerOutput")

    var isRunning = false

    var port: String = ""

    var bindAddress: String = "127.0.0.1"

    // MARK: - Initialization

    init() {
        // No need for log streams anymore
    }

    // MARK: - Public Methods

    func start() async throws {
        guard !isRunning else {
            logger.warning("Bun server already running")
            return
        }

        guard !port.isEmpty else {
            let error = BunServerError.invalidPort
            logger.error("Port not configured")
            throw error
        }

        logger.info("Starting Bun vibetunnel server on port \(self.port)")

        // Get the vibetunnel binary path (the Bun executable)
        guard let binaryPath = Bundle.main.path(forResource: "vibetunnel", ofType: nil) else {
            let error = BunServerError.binaryNotFound
            logger.error("vibetunnel binary not found in bundle")
            throw error
        }

        logger.info("Using Bun executable at: \(binaryPath)")

        // Ensure binary is executable
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binaryPath)

        // Verify binary exists and is executable
        var isDirectory: ObjCBool = false
        let fileExists = FileManager.default.fileExists(atPath: binaryPath, isDirectory: &isDirectory)
        if fileExists && !isDirectory.boolValue {
            let attributes = try FileManager.default.attributesOfItem(atPath: binaryPath)
            if let permissions = attributes[.posixPermissions] as? NSNumber,
               let fileSize = attributes[.size] as? NSNumber {
                logger
                    .info(
                        "vibetunnel binary size: \(fileSize.intValue) bytes, permissions: \(String(permissions.intValue, radix: 8))"
                    )
            }
        } else if !fileExists {
            logger.error("vibetunnel binary NOT FOUND at: \(binaryPath)")
        }

        // Create the process using login shell
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")

        // Get the Resources directory path
        let resourcesPath = Bundle.main.resourcePath ?? Bundle.main.bundlePath

        // Set working directory to Resources/web directory where public folder is located
        let webPath = URL(fileURLWithPath: resourcesPath).appendingPathComponent("web").path
        process.currentDirectoryURL = URL(fileURLWithPath: webPath)
        logger.info("Working directory: \(webPath)")

        // Static files are always at Resources/web/public
        let staticPath = URL(fileURLWithPath: resourcesPath).appendingPathComponent("web/public").path

        // Verify the web directory exists
        if !FileManager.default.fileExists(atPath: staticPath) {
            logger.error("Web directory not found at expected location: \(staticPath)")
        }

        // Build the vibetunnel command with all arguments
        var vibetunnelArgs = "--port \(port)"

        // Add password flag if password protection is enabled
        if UserDefaults.standard.bool(forKey: "dashboardPasswordEnabled") && DashboardKeychain.shared.hasPassword() {
            logger.info("Password protection enabled, retrieving from keychain")
            if let password = DashboardKeychain.shared.getPassword() {
                // Escape the password for shell
                let escapedPassword = password.replacingOccurrences(of: "\"", with: "\\\"")
                    .replacingOccurrences(of: "$", with: "\\$")
                    .replacingOccurrences(of: "`", with: "\\`")
                    .replacingOccurrences(of: "\\", with: "\\\\")
                vibetunnelArgs += " --username admin --password \"\(escapedPassword)\""
            }
        }

        // Create wrapper to run vibetunnel
        let vibetunnelCommand = "exec \(binaryPath) \(vibetunnelArgs)"
        process.arguments = ["-l", "-c", vibetunnelCommand]

        logger.info("Executing command: /bin/zsh -l -c \"\(vibetunnelCommand)\"")
        logger.info("Working directory: \(resourcesPath)")

        // Set up environment - login shell will load the rest
        let environment = ProcessInfo.processInfo.environment
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
            try await process.runAsync()

            // Mark server as running
            isRunning = true

            logger.info("Bun server process started")

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

                logger.error("Server failed to start: \(errorDetails)")
                throw BunServerError.processFailedToStart
            }

            logger.info("Bun server process started successfully")

            // Monitor process termination
            Task {
                await monitorProcessTermination()
            }
        } catch {
            isRunning = false

            // Log more detailed error information
            let errorMessage: String
            if let bunError = error as? BunServerError {
                errorMessage = bunError.localizedDescription
            } else if let nsError = error as NSError? {
                errorMessage = "\(nsError.localizedDescription) (Code: \(nsError.code), Domain: \(nsError.domain))"
                if let underlyingError = nsError.userInfo[NSUnderlyingErrorKey] {
                    logger.error("Underlying error: \(String(describing: underlyingError))")
                }
            } else {
                errorMessage = String(describing: error)
            }

            logger.error("Failed to start Bun server: \(errorMessage)")
            throw error
        }
    }

    func stop() async {
        guard let process, isRunning else {
            logger.warning("Bun server not running")
            return
        }

        logger.info("Stopping Bun server")

        // Cancel output monitoring tasks
        outputTask?.cancel()
        errorTask?.cancel()

        // Terminate the process
        await process.terminateAsync()

        // Wait for process to terminate (with timeout)
        let terminated = await process.waitUntilExitWithTimeout(seconds: 5)

        if !terminated {
            // Force kill if termination timeout
            process.interrupt()
            logger.warning("Force killed Bun server after timeout")
        }

        // Clean up
        self.process = nil
        self.stdoutPipe = nil
        self.stderrPipe = nil
        self.outputTask = nil
        self.errorTask = nil
        isRunning = false

        logger.info("Bun server stopped")
    }

    func restart() async throws {
        logger.info("Restarting Bun server")
        await stop()
        try await start()
    }

    func checkHealth() async -> Bool {
        guard let process else { return false }
        return process.isRunning
    }

    func getStaticFilesPath() -> String? {
        guard let resourcesPath = Bundle.main.resourcePath else { return nil }
        return URL(fileURLWithPath: resourcesPath).appendingPathComponent("web/public").path
    }

    func cleanup() async {
        await stop()
    }

    // MARK: - Private Methods

    private func startOutputMonitoring() {
        // Capture pipes and port before starting detached tasks
        let stdoutPipe = self.stdoutPipe
        let stderrPipe = self.stderrPipe
        let currentPort = self.port

        // Monitor stdout on background thread
        outputTask = Task.detached { [weak self] in
            guard let self, let pipe = stdoutPipe else { return }

            let handle = pipe.fileHandleForReading
            self.logger.debug("Starting stdout monitoring for Bun server on port \(currentPort)")

            while !Task.isCancelled {
                autoreleasepool {
                    let data = handle.availableData
                    if !data.isEmpty, let output = String(data: data, encoding: .utf8) {
                        let lines = output.trimmingCharacters(in: .whitespacesAndNewlines)
                            .components(separatedBy: .newlines)
                        for line in lines where !line.isEmpty {
                            // Skip shell initialization messages
                            if line.contains("zsh:") || line.hasPrefix("Last login:") {
                                continue
                            }

                            // Log to OSLog with appropriate level
                            Task { @MainActor in
                                self.logServerOutput(line, isError: false)
                            }
                        }
                    }
                }
            }

            self.logger.debug("Stopped stdout monitoring for Bun server")
        }

        // Monitor stderr on background thread
        errorTask = Task.detached { [weak self] in
            guard let self, let pipe = stderrPipe else { return }

            let handle = pipe.fileHandleForReading
            self.logger.debug("Starting stderr monitoring for Bun server on port \(currentPort)")

            while !Task.isCancelled {
                autoreleasepool {
                    let data = handle.availableData
                    if !data.isEmpty, let output = String(data: data, encoding: .utf8) {
                        let lines = output.trimmingCharacters(in: .whitespacesAndNewlines)
                            .components(separatedBy: .newlines)
                        for line in lines where !line.isEmpty {
                            // Log stderr as errors/warnings
                            Task { @MainActor in
                                self.logServerOutput(line, isError: true)
                            }
                        }
                    }
                }
            }

            self.logger.debug("Stopped stderr monitoring for Bun server")
        }
    }

    private func logServerOutput(_ line: String, isError: Bool) {
        let lowercased = line.lowercased()

        if isError || lowercased.contains("error") || lowercased.contains("failed") || lowercased.contains("fatal") {
            serverOutput.error("\(line, privacy: .public)")
        } else if lowercased.contains("warn") || lowercased.contains("warning") {
            serverOutput.warning("\(line, privacy: .public)")
        } else if lowercased.contains("debug") || lowercased.contains("verbose") {
            serverOutput.debug("\(line, privacy: .public)")
        } else {
            serverOutput.info("\(line, privacy: .public)")
        }
    }

    private func withTimeoutOrNil<T: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @Sendable () async -> T
    )
        async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask {
                await operation()
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return nil
            }

            for await result in group {
                group.cancelAll()
                return result
            }

            return nil
        }
    }

    private func monitorProcessTermination() async {
        guard let process else { return }

        // Wait for process exit
        await process.waitUntilExitAsync()

        let exitCode = process.terminationStatus

        if self.isRunning {
            // Unexpected termination
            self.logger.error("Bun server terminated unexpectedly with exit code: \(exitCode)")
            self.isRunning = false

            // Clean up process reference
            self.process = nil

            // Notify about the crash
            if let onCrash = self.onCrash {
                self.logger.info("Notifying ServerManager about server crash")
                onCrash(exitCode)
            }
        } else {
            // Normal termination
            self.logger.info("Bun server terminated normally with exit code: \(exitCode)")
        }
    }

    // MARK: - Utilities
}

// MARK: - Errors

enum BunServerError: LocalizedError {
    case binaryNotFound
    case processFailedToStart
    case invalidPort

    var errorDescription: String? {
        switch self {
        case .binaryNotFound:
            "The vibetunnel binary was not found in the app bundle"
        case .processFailedToStart:
            "The server process failed to start"
        case .invalidPort:
            "Server port is not configured"
        }
    }
}

// MARK: - Process Extensions

extension Process {
    /// Run the process asynchronously
    func runAsync() async throws {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try self.run()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Wait for the process to exit asynchronously
    func waitUntilExitAsync() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                self.waitUntilExit()
                continuation.resume()
            }
        }
    }

    /// Terminate the process asynchronously
    func terminateAsync() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                if self.isRunning {
                    self.terminate()
                }
                continuation.resume()
            }
        }
    }

    /// Wait for exit with timeout
    func waitUntilExitWithTimeout(seconds: TimeInterval) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await self.waitUntilExitAsync()
                return true
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return false
            }

            for await result in group {
                group.cancelAll()
                return result
            }

            return false
        }
    }
}
