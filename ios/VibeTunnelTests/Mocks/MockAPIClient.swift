import Foundation
@testable import VibeTunnel

/// Mock implementation of APIClientProtocol for testing
@MainActor
class MockAPIClient: APIClientProtocol {
    // Tracking properties
    var getSessionsCalled = false
    var getSessionCalled = false
    var getSessionId: String?
    var createSessionCalled = false
    var createSessionData: SessionCreateData?
    var killSessionCalled = false
    var killSessionId: String?
    var cleanupSessionCalled = false
    var cleanupSessionId: String?
    var cleanupAllExitedSessionsCalled = false
    var killAllSessionsCalled = false
    var sendInputCalled = false
    var sendInputSessionId: String?
    var sendInputText: String?
    var resizeTerminalCalled = false
    var resizeTerminalSessionId: String?
    var resizeTerminalCols: Int?
    var resizeTerminalRows: Int?
    var checkHealthCalled = false

    // Response configuration
    var sessionsResponse: Result<[Session], Error> = .success([])
    var sessionResponse: Result<Session, Error> = .success(TestFixtures.validSession)
    var createSessionResponse: Result<String, Error> = .success("mock-session-id")
    var killSessionResponse: Result<Void, Error> = .success(())
    var cleanupSessionResponse: Result<Void, Error> = .success(())
    var cleanupAllResponse: Result<[String], Error> = .success([])
    var killAllResponse: Result<Void, Error> = .success(())
    var sendInputResponse: Result<Void, Error> = .success(())
    var resizeResponse: Result<Void, Error> = .success(())
    var healthResponse: Result<Bool, Error> = .success(true)

    /// Delay configuration for testing async behavior
    var responseDelay: TimeInterval = 0

    func getSessions() async throws -> [Session] {
        getSessionsCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try sessionsResponse.get()
    }

    func getSession(_ sessionId: String) async throws -> Session {
        getSessionCalled = true
        getSessionId = sessionId
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try sessionResponse.get()
    }

    func createSession(_ data: SessionCreateData) async throws -> String {
        createSessionCalled = true
        createSessionData = data
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try createSessionResponse.get()
    }

    func killSession(_ sessionId: String) async throws {
        killSessionCalled = true
        killSessionId = sessionId
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try killSessionResponse.get()
    }

    func cleanupSession(_ sessionId: String) async throws {
        cleanupSessionCalled = true
        cleanupSessionId = sessionId
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try cleanupSessionResponse.get()
    }

    func cleanupAllExitedSessions() async throws -> [String] {
        cleanupAllExitedSessionsCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try cleanupAllResponse.get()
    }

    func killAllSessions() async throws {
        killAllSessionsCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try killAllResponse.get()
    }

    func sendInput(sessionId: String, text: String) async throws {
        sendInputCalled = true
        sendInputSessionId = sessionId
        sendInputText = text
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try sendInputResponse.get()
    }

    func resizeTerminal(sessionId: String, cols: Int, rows: Int) async throws {
        resizeTerminalCalled = true
        resizeTerminalSessionId = sessionId
        resizeTerminalCols = cols
        resizeTerminalRows = rows
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        try resizeResponse.get()
    }

    func checkHealth() async throws -> Bool {
        checkHealthCalled = true
        if responseDelay > 0 {
            try await Task.sleep(nanoseconds: UInt64(responseDelay * 1_000_000_000))
        }
        return try healthResponse.get()
    }

    /// Helper to reset all tracking properties
    func reset() {
        getSessionsCalled = false
        getSessionCalled = false
        getSessionId = nil
        createSessionCalled = false
        createSessionData = nil
        killSessionCalled = false
        killSessionId = nil
        cleanupSessionCalled = false
        cleanupSessionId = nil
        cleanupAllExitedSessionsCalled = false
        killAllSessionsCalled = false
        sendInputCalled = false
        sendInputSessionId = nil
        sendInputText = nil
        resizeTerminalCalled = false
        resizeTerminalSessionId = nil
        resizeTerminalCols = nil
        resizeTerminalRows = nil
        checkHealthCalled = false
    }
}
