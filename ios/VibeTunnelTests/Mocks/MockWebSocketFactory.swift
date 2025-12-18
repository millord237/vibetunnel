import Foundation
@testable import VibeTunnel

/// Mock BufferWebSocketClient for testing
@MainActor
class MockBufferWebSocketClient: BufferWebSocketClient {
    var connectCalled = false
    var disconnectCalled = false
    var subscribeCalled = false
    var unsubscribeCalled = false
    var lastSubscribedSessionId: String?

    private var eventHandlers: [String: (TerminalWebSocketEvent) -> Void] = [:]

    override func connect() {
        self.connectCalled = true
        // Set the parent class isConnected property through public interface
        super.connect()
    }

    override func disconnect() {
        self.disconnectCalled = true
        self.eventHandlers.removeAll()
        super.disconnect()
    }

    override func subscribe(to sessionId: String, handler: @escaping (TerminalWebSocketEvent) -> Void) {
        self.subscribeCalled = true
        self.lastSubscribedSessionId = sessionId
        self.eventHandlers[sessionId] = handler
        super.subscribe(to: sessionId, handler: handler)
    }

    override func unsubscribe(from sessionId: String) {
        self.unsubscribeCalled = true
        self.eventHandlers.removeValue(forKey: sessionId)
        super.unsubscribe(from: sessionId)
    }

    /// Simulate receiving an event
    func simulateEvent(_ event: TerminalWebSocketEvent) {
        for handler in self.eventHandlers.values {
            handler(event)
        }
    }
}

/// Mock SSEClient for testing (composition pattern since SSEClient is final)
@MainActor
class MockSSEClient {
    var connectCalled = false
    var disconnectCalled = false
    var lastConnectHeaders: [String: String]?
    var isConnected = false

    func connect(headers: [String: String]? = nil) async {
        self.connectCalled = true
        self.lastConnectHeaders = headers
        self.isConnected = true
    }

    func disconnect() {
        self.disconnectCalled = true
        self.isConnected = false
    }
}
