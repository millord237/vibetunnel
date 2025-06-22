import Foundation
import Testing
@testable import VibeTunnel

@Suite("BufferWebSocketClient Tests", .tags(.critical, .websocket))
@MainActor
struct BufferWebSocketClientTests {
    @Test("Connects successfully with valid configuration")
    func successfulConnection() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        // Act
        client.connect()
        
        // Give it a moment to process
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        // Assert
        #expect(mockFactory.createdWebSockets.count == 1)
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        #expect(mockWebSocket?.isConnected == true)
        #expect(mockWebSocket?.lastConnectURL?.absoluteString.contains("/buffers") == true)
        #expect(client.isConnected == true)
        #expect(client.connectionError == nil)
    }
    
    @Test("Handles connection failure gracefully")
    func connectionFailure() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        // Configure mock to fail
        client.connect()
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        mockWebSocket?.shouldFailConnection = true
        mockWebSocket?.connectionError = WebSocketError.connectionFailed
        
        // Simulate connection failure
        mockWebSocket?.simulateError(WebSocketError.connectionFailed)
        
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert
        #expect(client.isConnected == false)
        #expect(client.connectionError != nil)
    }
    
    @Test("Parses binary buffer messages correctly")
    func binaryMessageParsing() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        var receivedEvent: TerminalWebSocketEvent?
        let sessionId = "test-session-123"
        
        // Subscribe to events
        client.subscribe(to: sessionId) { event in
            receivedEvent = event
        }
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        #expect(mockWebSocket?.isConnected == true)
        
        // Create a binary message with proper structure
        var messageData = Data()
        
        // Magic byte for buffer message
        messageData.append(0xBF)
        
        // Session ID length (4 bytes, little endian)
        let sessionIdData = sessionId.data(using: .utf8)!
        var sessionIdLength = UInt32(sessionIdData.count).littleEndian
        messageData.append(Data(bytes: &sessionIdLength, count: 4))
        
        // Session ID
        messageData.append(sessionIdData)
        
        // Buffer data with header
        messageData.append(TestFixtures.bufferSnapshot(cols: 80, rows: 24))
        
        // Act - Simulate receiving the message
        mockWebSocket?.simulateMessage(.data(messageData))
        
        // Wait for processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        // Assert
        #expect(receivedEvent != nil)
        if case .bufferUpdate(let snapshot) = receivedEvent {
            #expect(snapshot.cols == 80)
            #expect(snapshot.rows == 24)
        } else {
            Issue.record("Expected buffer update event")
        }
    }
    
    @Test("Handles text messages for events")
    func textMessageHandling() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        #expect(mockWebSocket?.isConnected == true)
        
        // Act - Simulate ping message
        mockWebSocket?.simulateMessage(.string("{\"type\":\"ping\"}"))
        
        // Wait for processing
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert - Check if pong was sent
        let sentMessages = mockWebSocket?.sentJSONMessages() ?? []
        #expect(sentMessages.contains { $0["type"] as? String == "pong" })
    }
    
    @Test("Subscribes to sessions correctly")
    func sessionSubscription() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        let sessionId = "test-session-456"
        var eventReceived = false
        
        // Act
        client.subscribe(to: sessionId) { _ in
            eventReceived = true
        }
        
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        
        // Assert - Check if subscribe message was sent
        let sentMessages = mockWebSocket?.sentJSONMessages() ?? []
        #expect(sentMessages.contains { msg in
            msg["type"] as? String == "subscribe" &&
            msg["sessionId"] as? String == sessionId
        })
    }
    
    @Test("Handles reconnection after disconnection")
    func reconnection() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let firstWebSocket = mockFactory.lastCreatedWebSocket
        #expect(client.isConnected == true)
        
        // Act - Simulate disconnection
        firstWebSocket?.simulateDisconnection()
        
        // Wait for reconnection attempt
        try await Task.sleep(nanoseconds: 2_000_000_000) // 2s
        
        // Assert
        #expect(mockFactory.createdWebSockets.count > 1)
        let secondWebSocket = mockFactory.lastCreatedWebSocket
        #expect(secondWebSocket !== firstWebSocket)
    }
    
    @Test("Sends ping messages periodically")
    func pingMessages() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        // Act
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        let initialPingCount = mockWebSocket?.pingCount ?? 0
        
        // Assert - Initial ping during connection
        #expect(initialPingCount > 0)
    }
    
    @Test("Unsubscribes from sessions correctly")
    func sessionUnsubscription() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        let sessionId = "test-session-789"
        
        // Subscribe first
        client.subscribe(to: sessionId) { _ in }
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        
        // Clear sent messages
        mockWebSocket?.sentMessages.removeAll()
        
        // Act - Unsubscribe
        client.unsubscribe(from: sessionId)
        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        
        // Assert
        let sentMessages = mockWebSocket?.sentJSONMessages() ?? []
        #expect(sentMessages.contains { msg in
            msg["type"] as? String == "unsubscribe" &&
            msg["sessionId"] as? String == sessionId
        })
    }
    
    @Test("Cleans up on disconnect")
    func cleanup() async throws {
        // Arrange
        let mockFactory = MockWebSocketFactory()
        let client = BufferWebSocketClient(webSocketFactory: mockFactory)
        saveTestServerConfig()
        
        // Subscribe to a session
        client.subscribe(to: "test-session") { _ in }
        
        // Connect
        client.connect()
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        
        let mockWebSocket = mockFactory.lastCreatedWebSocket
        #expect(client.isConnected == true)
        
        // Act
        client.disconnect()
        
        // Assert
        #expect(client.isConnected == false)
        #expect(mockWebSocket?.disconnectCalled == true)
        #expect(mockWebSocket?.lastDisconnectCode == .goingAway)
    }
}

// MARK: - Test Helpers

private func saveTestServerConfig() {
    let config = ServerConfig(
        host: "localhost",
        port: 8888,
        useSSL: false,
        username: nil,
        password: nil
    )
    
    if let data = try? JSONEncoder().encode(config) {
        UserDefaults.standard.set(data, forKey: "savedServerConfig")
    }
}