//
//  BaseProcessServer.swift
//  VibeTunnel
//
//  Created by Claude on 2025-06-20.
//

import Foundation
import OSLog

/// Base class providing common functionality for process-based server implementations
@MainActor
class BaseProcessServer: VibeTunnelServer {
    // MARK: - Properties
    
    internal var process: Process?
    internal var stdoutPipe: Pipe?
    internal var stderrPipe: Pipe?
    internal var outputTask: Task<Void, Never>?
    internal var errorTask: Task<Void, Never>?
    
    internal let logger: Logger
    internal var logContinuation: AsyncStream<ServerLogEntry>.Continuation?
    
    var isRunning = false
    
    var port: String = "" {
        didSet {
            // If server is running and port changed, we need to restart
            if isRunning && oldValue != port {
                Task {
                    await stop()
                    try? await start()
                }
            }
        }
    }
    
    var bindAddress: String = "127.0.0.1"
    
    // Subclasses must override
    var serverType: ServerType {
        fatalError("Subclasses must implement serverType")
    }
    
    let logStream: AsyncStream<ServerLogEntry>
    
    // MARK: - Process Handler
    
    /// Actor to handle process operations on background thread
    internal actor ProcessHandler {
        private let queue = DispatchQueue(
            label: "sh.vibetunnel.vibetunnel.ProcessHandler",
            qos: .userInitiated
        )
        
        func runProcess(_ process: Process) async throws {
            try await withCheckedThrowingContinuation { continuation in
                queue.async {
                    do {
                        try process.run()
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
        
        func waitForExit(_ process: Process) async {
            await withCheckedContinuation { continuation in
                queue.async {
                    process.waitUntilExit()
                    continuation.resume()
                }
            }
        }
        
        func terminateProcess(_ process: Process) async {
            await withCheckedContinuation { continuation in
                queue.async {
                    process.terminate()
                    continuation.resume()
                }
            }
        }
    }
    
    internal let processHandler = ProcessHandler()
    
    // MARK: - Initialization
    
    init(loggerCategory: String) {
        self.logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: loggerCategory)
        
        var localContinuation: AsyncStream<ServerLogEntry>.Continuation?
        self.logStream = AsyncStream { continuation in
            localContinuation = continuation
        }
        self.logContinuation = localContinuation
    }
    
    // MARK: - VibeTunnelServer Protocol
    
    func start() async throws {
        fatalError("Subclasses must implement start()")
    }
    
    func stop() async {
        guard let process, isRunning else {
            logger.warning("\(self.serverType.displayName) server not running")
            return
        }
        
        logger.info("Stopping \(self.serverType.displayName) server")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "Shutting down \(self.serverType.displayName) server..."
        ))
        
        // Cancel output monitoring tasks
        outputTask?.cancel()
        errorTask?.cancel()
        
        // Terminate the process on background thread
        await processHandler.terminateProcess(process)
        
        // Wait for process to terminate (with timeout)
        let terminated: Void? = await withTimeoutOrNil(seconds: 5) { [self] in
            await self.processHandler.waitForExit(process)
        }
        
        if terminated == nil {
            // Force kill if termination timeout
            process.interrupt()
            logger.warning("Force killed \(self.serverType.displayName) server after timeout")
            logContinuation?.yield(ServerLogEntry(
                level: .warning,
                message: "Force killed server after timeout"
            ))
        }
        
        // Clean up
        self.process = nil
        self.stdoutPipe = nil
        self.stderrPipe = nil
        self.outputTask = nil
        self.errorTask = nil
        isRunning = false
        
        logger.info("\(self.serverType.displayName) server stopped")
        logContinuation?.yield(ServerLogEntry(
            level: .info,
            message: "\(self.serverType.displayName) server shutdown complete"
        ))
    }
    
    func checkHealth() async -> Bool {
        guard let process = process else { return false }
        return process.isRunning
    }
    
    func getStaticFilesPath() -> String? {
        fatalError("Subclasses must implement getStaticFilesPath()")
    }
    
    func cleanup() async {
        await stop()
        logContinuation?.finish()
    }
    
    // MARK: - Protected Methods for Subclasses
    
    internal func startOutputMonitoring() {
        // Capture pipes and port before starting detached tasks
        let stdoutPipe = self.stdoutPipe
        let stderrPipe = self.stderrPipe
        let currentPort = self.port
        let serverName = self.serverType.displayName
        
        // Monitor stdout on background thread
        outputTask = Task.detached { [weak self] in
            guard let self, let pipe = stdoutPipe else { return }
            
            let handle = pipe.fileHandleForReading
            self.logger.debug("Starting stdout monitoring for \(serverName) server on port \(currentPort)")
            
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
                            Task { @MainActor [weak self] in
                                guard let self else { return }
                                let level = self.detectLogLevel(from: line)
                                self.logContinuation?.yield(ServerLogEntry(
                                    level: level,
                                    message: line
                                ))
                            }
                        }
                    }
                }
            }
            
            self.logger.debug("Stopped stdout monitoring for \(serverName) server")
        }
        
        // Monitor stderr on background thread
        errorTask = Task.detached { [weak self] in
            guard let self, let pipe = stderrPipe else { return }
            
            let handle = pipe.fileHandleForReading
            self.logger.debug("Starting stderr monitoring for \(serverName) server on port \(currentPort)")
            
            while !Task.isCancelled {
                autoreleasepool {
                    let data = handle.availableData
                    if !data.isEmpty, let output = String(data: data, encoding: .utf8) {
                        let lines = output.trimmingCharacters(in: .whitespacesAndNewlines)
                            .components(separatedBy: .newlines)
                        for line in lines where !line.isEmpty {
                            Task { @MainActor [weak self] in
                                guard let self else { return }
                                let level = self.detectStderrLogLevel(from: line)
                                self.logContinuation?.yield(ServerLogEntry(
                                    level: level,
                                    message: line
                                ))
                            }
                        }
                    }
                }
            }
            
            self.logger.debug("Stopped stderr monitoring for \(serverName) server")
        }
    }
    
    internal func detectLogLevel(from line: String) -> ServerLogEntry.Level {
        let lowercased = line.lowercased()
        
        if lowercased.contains("error") || lowercased.contains("failed") || lowercased.contains("fatal") {
            return .error
        } else if lowercased.contains("warn") || lowercased.contains("warning") {
            return .warning
        } else if lowercased.contains("debug") || lowercased.contains("verbose") {
            return .debug
        } else {
            return .info
        }
    }
    
    internal func detectStderrLogLevel(from line: String) -> ServerLogEntry.Level {
        // By default, stderr is treated as warnings unless it's clearly an error
        let lowercased = line.lowercased()
        
        if lowercased.contains("error") || lowercased.contains("failed") || lowercased.contains("fatal") {
            return .error
        } else {
            return .warning
        }
    }
    
    internal func withTimeoutOrNil<T: Sendable>(seconds: TimeInterval, operation: @escaping @Sendable () async -> T) async -> T? {
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
}
