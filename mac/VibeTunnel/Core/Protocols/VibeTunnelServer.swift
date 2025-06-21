//
//  VibeTunnelServer.swift
//  VibeTunnel
//
//  Created by Claude on 2025-06-20.
//

import Foundation

/// Protocol defining the interface for VibeTunnel server implementations
@MainActor
protocol VibeTunnelServer: AnyObject {
    /// Indicates whether the server is currently running
    var isRunning: Bool { get }
    
    /// The port the server is configured to run on
    var port: String { get set }
    
    /// The bind address for the server (default: "127.0.0.1")
    var bindAddress: String { get set }
    
    /// Async stream of log entries from the server
    var logStream: AsyncStream<ServerLogEntry> { get }
    
    /// The type of server implementation
    var serverType: ServerType { get }
    
    /// Start the server
    /// - Throws: ServerError if the server fails to start
    func start() async throws
    
    /// Stop the server gracefully
    func stop() async
    
    /// Check if the server is healthy and responding
    /// - Returns: true if the server is healthy, false otherwise
    func checkHealth() async -> Bool
    
    /// Get the path to static web files
    /// - Returns: Path to the web directory or nil if not available
    func getStaticFilesPath() -> String?
    
    /// Clean up resources when the server is no longer needed
    func cleanup() async
}

/// Server type enumeration
enum ServerType: String, CaseIterable, Identifiable {
    case go = "go"
    case node = "node"
    
    var id: String { rawValue }
    
    var displayName: String {
        switch self {
        case .go: return "Go (Native)"
        case .node: return "Node.js"
        }
    }
    
    var description: String {
        switch self {
        case .go: return "Fast, native implementation with minimal resource usage"
        case .node: return "Original implementation with full feature compatibility"
        }
    }
}

/// Errors that can occur during server operations
enum ServerError: LocalizedError {
    case binaryNotFound(String)
    case startupFailed(String)
    case portInUse(Int)
    case invalidConfiguration(String)
    
    var errorDescription: String? {
        switch self {
        case .binaryNotFound(let binary):
            return "Server binary not found: \(binary)"
        case .startupFailed(let reason):
            return "Server failed to start: \(reason)"
        case .portInUse(let port):
            return "Port \(port) is already in use"
        case .invalidConfiguration(let reason):
            return "Invalid server configuration: \(reason)"
        }
    }
}