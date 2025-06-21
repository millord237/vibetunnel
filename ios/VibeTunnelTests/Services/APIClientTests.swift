import Foundation
import Testing
@testable import VibeTunnel

@Suite("APIClient Tests", .tags(.critical, .networking))
struct APIClientTests {
    let baseURL = URL(string: "http://localhost:8888")!
    var mockSession: URLSession!

    init() {
        // Set up mock URLSession
        let configuration = URLSessionConfiguration.mockConfiguration
        mockSession = URLSession(configuration: configuration)
    }

    // MARK: - Session Management Tests

    @Test("Get sessions returns parsed sessions")
    func testGetSessions() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions")
            #expect(request.httpMethod == "GET")

            let data = TestFixtures.sessionsJSON.data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: data)
        }

        // Act
        let client = createTestClient()
        let sessions = try await client.getSessions()

        // Assert
        #expect(sessions.count == 2)
        #expect(sessions[0].id == "test-session-123")
        #expect(sessions[0].isRunning == true)
        #expect(sessions[1].id == "exited-session-456")
        #expect(sessions[1].isRunning == false)
    }

    @Test("Get sessions handles empty response")
    func getSessionsEmpty() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            let data = "[]".data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: data)
        }

        // Act
        let client = createTestClient()
        let sessions = try await client.getSessions()

        // Assert
        #expect(sessions.isEmpty)
    }

    @Test("Get sessions handles network error", .tags(.networking))
    func getSessionsNetworkError() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        // Act & Assert
        let client = createTestClient()
        await #expect(throws: APIError.self) {
            try await client.getSessions()
        } catch: { error in
            guard case .networkError = error else {
                Issue.record("Expected network error")
                return
            }
        }
    }

    @Test("Create session sends correct request")
    func testCreateSession() async throws {
        // Arrange
        let sessionData = SessionCreateData(
            command: "/bin/bash",
            workingDir: "/Users/test",
            name: "Test Session",
            cols: 80,
            rows: 24
        )

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")

            // Verify request body
            if let body = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            {
                #expect(json["command"] as? String == "/bin/bash")
                #expect(json["workingDir"] as? String == "/Users/test")
                #expect(json["name"] as? String == "Test Session")
                #expect(json["cols"] as? Int == 80)
                #expect(json["rows"] as? Int == 24)
            } else {
                Issue.record("Failed to parse request body")
            }

            let responseData = TestFixtures.createSessionJSON.data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: responseData)
        }

        // Act
        let client = createTestClient()
        let sessionId = try await client.createSession(sessionData)

        // Assert
        #expect(sessionId == "new-session-789")
    }

    @Test("Kill session sends DELETE request")
    func testKillSession() async throws {
        // Arrange
        let sessionId = "test-session-123"

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions/\(sessionId)")
            #expect(request.httpMethod == "DELETE")

            return MockURLProtocol.successResponse(for: request.url!, statusCode: 204)
        }

        // Act & Assert (should not throw)
        let client = createTestClient()
        try await client.killSession(sessionId)
    }

    @Test("Send input posts correct data")
    func testSendInput() async throws {
        // Arrange
        let sessionId = "test-session-123"
        let inputText = "ls -la\n"

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions/\(sessionId)/input")
            #expect(request.httpMethod == "POST")

            if let body = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            {
                #expect(json["data"] as? String == inputText)
            } else {
                Issue.record("Failed to parse input request body")
            }

            return MockURLProtocol.successResponse(for: request.url!, statusCode: 204)
        }

        // Act & Assert (should not throw)
        let client = createTestClient()
        try await client.sendInput(sessionId: sessionId, text: inputText)
    }

    @Test("Resize terminal sends correct dimensions")
    func testResizeTerminal() async throws {
        // Arrange
        let sessionId = "test-session-123"
        let cols = 120
        let rows = 40

        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/sessions/\(sessionId)/resize")
            #expect(request.httpMethod == "POST")

            if let body = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
            {
                #expect(json["cols"] as? Int == cols)
                #expect(json["rows"] as? Int == rows)
            } else {
                Issue.record("Failed to parse resize request body")
            }

            return MockURLProtocol.successResponse(for: request.url!, statusCode: 204)
        }

        // Act & Assert (should not throw)
        let client = createTestClient()
        try await client.resizeTerminal(sessionId: sessionId, cols: cols, rows: rows)
    }

    // MARK: - Error Handling Tests

    @Test("Handles 404 error correctly")
    func handle404Error() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            let errorData = TestFixtures.errorResponseJSON.data(using: .utf8)!
            return MockURLProtocol.errorResponse(
                for: request.url!,
                statusCode: 404,
                message: "Session not found"
            )
        }

        // Act & Assert
        let client = createTestClient()
        await #expect(throws: APIError.self) {
            try await client.getSession("nonexistent")
        } catch: { error in
            guard case .serverError(let code, let message) = error else {
                Issue.record("Expected server error")
                return
            }
            #expect(code == 404)
            #expect(message == "Session not found")
        }
    }

    @Test("Handles 401 unauthorized error")
    func handle401Error() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            MockURLProtocol.errorResponse(for: request.url!, statusCode: 401)
        }

        // Act & Assert
        let client = createTestClient()
        await #expect(throws: APIError.self) {
            try await client.getSessions()
        } catch: { error in
            guard case .serverError(let code, _) = error else {
                Issue.record("Expected server error")
                return
            }
            #expect(code == 401)
        }
    }

    @Test("Handles invalid JSON response")
    func handleInvalidJSON() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            let invalidData = "not json".data(using: .utf8)!
            return MockURLProtocol.successResponse(for: request.url!, data: invalidData)
        }

        // Act & Assert
        let client = createTestClient()
        await #expect(throws: APIError.self) {
            try await client.getSessions()
        } catch: { error in
            guard case .decodingError = error else {
                Issue.record("Expected decoding error")
                return
            }
        }
    }

    @Test("Handles connection timeout")
    func connectionTimeout() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { _ in
            throw URLError(.timedOut)
        }

        // Act & Assert
        let client = createTestClient()
        await #expect(throws: APIError.self) {
            try await client.getSessions()
        } catch: { error in
            guard case .networkError = error else {
                Issue.record("Expected network error")
                return
            }
        }
    }

    // MARK: - Health Check Tests

    @Test("Health check returns true for 200 response")
    func healthCheckSuccess() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.path == "/api/health")
            return MockURLProtocol.successResponse(for: request.url!)
        }

        // Act
        let client = createTestClient()
        let isHealthy = try await client.checkHealth()

        // Assert
        #expect(isHealthy == true)
    }

    @Test("Health check returns false for error response")
    func healthCheckFailure() async throws {
        // Arrange
        MockURLProtocol.requestHandler = { request in
            MockURLProtocol.errorResponse(for: request.url!, statusCode: 500)
        }

        // Act
        let client = createTestClient()
        let isHealthy = try await client.checkHealth()

        // Assert
        #expect(isHealthy == false)
    }

    // MARK: - Helper Methods

    private func createTestClient() -> APIClient {
        // Create a test client with our mock session
        // Note: This requires modifying APIClient to accept a custom URLSession
        // For now, we'll use the shared instance and rely on MockURLProtocol
        APIClient.shared
    }
}
