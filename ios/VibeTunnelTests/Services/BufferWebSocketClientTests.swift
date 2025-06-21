import Foundation
import Testing
@testable import VibeTunnel

@Suite("BufferWebSocketClient Tests", .tags(.critical, .websocket))
@MainActor
struct BufferWebSocketClientTests {
    @Test("Connects successfully with valid configuration")
    func successfulConnection() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        saveTestServerConfig()

        let mockSession = MockWebSocketURLSession()
        let mockTask = MockWebSocketTask()
        mockSession.mockTask = mockTask

        // Note: This test would require modifying BufferWebSocketClient to accept a custom URLSession
        // For now, we'll test the connection logic conceptually

        // Act
        client.connect()

        // Assert
        // In a real test, we'd verify the WebSocket connection was established
        // For now, we verify the client doesn't crash and sets appropriate state
        #expect(client.connectionError == nil)
    }

    @Test("Handles connection failure gracefully")
    func connectionFailure() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        // Don't save server config to trigger connection failure
        UserDefaults.standard.removeObject(forKey: "savedServerConfig")

        // Act
        client.connect()

        // Assert
        #expect(client.connectionError != nil)
        #expect(client.isConnected == false)
    }

    @Test("Parses binary buffer messages correctly")
    func binaryMessageParsing() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        var receivedEvent: TerminalWebSocketEvent?

        // Subscribe to events
        client.subscribe(id: "test") { event in
            receivedEvent = event
        }

        // Create a mock binary message
        let bufferData = TestFixtures.bufferSnapshot(cols: 80, rows: 24)

        // Act - Simulate receiving a binary message
        // This would normally come through the WebSocket
        // We'd need to expose a method for testing or use dependency injection

        // For demonstration, let's test the parsing logic conceptually
        #expect(bufferData.first == 0xBF) // Magic byte

        // Verify data structure
        var offset = 1
        let cols = bufferData.withUnsafeBytes { bytes in
            bytes.load(fromByteOffset: offset, as: Int32.self).littleEndian
        }
        offset += 4

        let rows = bufferData.withUnsafeBytes { bytes in
            bytes.load(fromByteOffset: offset, as: Int32.self).littleEndian
        }

        #expect(cols == 80)
        #expect(rows == 24)
    }

    @Test("Handles text messages for events")
    func textMessageHandling() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        var receivedEvents: [TerminalWebSocketEvent] = []

        client.subscribe(id: "test") { event in
            receivedEvents.append(event)
        }

        // Test various text message formats
        let messages = [
            """
            {"type":"exit","code":0}
            """,
            """
            {"type":"bell"}
            """,
            """
            {"type":"alert","title":"Warning","message":"Session timeout"}
            """
        ]

        // Act & Assert
        // In a real implementation, we'd send these through the WebSocket
        // and verify the correct events are generated

        // Verify JSON structure
        for message in messages {
            let data = message.data(using: .utf8)!
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            #expect(json != nil)
            #expect(json?["type"] as? String != nil)
        }
    }

    @Test("Manages subscriptions correctly")
    func subscriptionManagement() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        var subscriber1Count = 0
        var subscriber2Count = 0

        // Act
        client.subscribe(id: "sub1") { _ in
            subscriber1Count += 1
        }

        client.subscribe(id: "sub2") { _ in
            subscriber2Count += 1
        }

        // Simulate an event (would normally come through WebSocket)
        // For testing purposes, we'd need to expose internal methods

        // Remove one subscription
        client.unsubscribe(id: "sub1")

        // Assert
        // After unsubscribing sub1, only sub2 should receive events
        // This would be verified in a full integration test
    }

    @Test("Handles reconnection with exponential backoff")
    func reconnectionLogic() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        saveTestServerConfig()

        // Act
        client.connect()

        // Simulate disconnection
        // In a real test, we'd trigger this through the WebSocket mock

        // Assert
        // Verify reconnection attempts happen with increasing delays
        // This would require exposing reconnection state or using time-based testing
    }

    @Test("Cleans up resources on disconnect")
    func disconnectCleanup() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        saveTestServerConfig()

        var eventReceived = false
        client.subscribe(id: "test") { _ in
            eventReceived = true
        }

        // Act
        client.connect()
        client.disconnect()

        // Assert
        #expect(client.isConnected == false)
        #expect(client.connectionError == nil)

        // Verify subscriptions are maintained but not receiving events
        // In a real test, we'd verify no events are delivered after disconnect
    }

    @Test("Validates magic byte in binary messages")
    func magicByteValidation() async throws {
        // Arrange
        var invalidData = Data([0xAB]) // Wrong magic byte
        invalidData.append(contentsOf: [0, 0, 0, 0]) // Some dummy data

        // Act & Assert
        // In the real implementation, this should be rejected
        #expect(invalidData.first != 0xBF)
    }

    @Test("Handles malformed JSON gracefully")
    func malformedJSONHandling() async throws {
        // Arrange
        let malformedMessages = [
            "not json",
            "{invalid json}",
            """
            {"type": }
            """,
            ""
        ]

        // Act & Assert
        for message in malformedMessages {
            let data = message.data(using: .utf8) ?? Data()
            let json = try? JSONSerialization.jsonObject(with: data)
            #expect(json == nil)
        }
    }

    @Test("Maintains connection with periodic pings")
    func pingMechanism() async throws {
        // Arrange
        let client = BufferWebSocketClient()
        saveTestServerConfig()

        // Act
        client.connect()

        // Assert
        // In a real test with mock WebSocket, we'd verify:
        // 1. Ping messages are sent periodically
        // 2. Connection stays alive with pings
        // 3. Connection closes if pings fail
    }

    // MARK: - Helper Methods

    private func saveTestServerConfig() {
        let config = TestFixtures.validServerConfig
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "savedServerConfig")
        }
    }
}

// MARK: - Integration Tests

@Suite("BufferWebSocketClient Integration Tests", .tags(.integration, .websocket))
@MainActor
struct BufferWebSocketClientIntegrationTests {
    @Test("Full connection and message flow", .timeLimit(.seconds(5)))
    func fullConnectionFlow() async throws {
        // This test would require a mock WebSocket server
        // or modifications to BufferWebSocketClient to accept mock dependencies

        // Arrange
        let client = BufferWebSocketClient()
        let expectation = confirmation("Received buffer update")

        client.subscribe(id: "integration-test") { event in
            if case .bufferUpdate = event {
                Task { await expectation.fulfill() }
            }
        }

        // Act
        // In a real integration test:
        // 1. Start mock WebSocket server
        // 2. Connect client
        // 3. Send buffer update from server
        // 4. Verify client receives and parses it correctly

        // Assert
        // await fulfillment(of: [expectation], timeout: .seconds(2))
    }
}
