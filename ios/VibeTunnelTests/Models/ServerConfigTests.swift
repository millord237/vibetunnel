import Foundation
import Testing
@testable import VibeTunnel

@Suite("ServerConfig Tests", .tags(.models))
struct ServerConfigTests {
    @Test("Creates valid HTTP URL")
    func hTTPURLCreation() {
        // Arrange
        let config = ServerConfig(
            host: "localhost",
            port: 8_888,
            useSSL: false,
            username: nil,
            password: nil
        )

        // Act
        let url = config.baseURL

        // Assert
        #expect(url.absoluteString == "http://localhost:8888")
        #expect(url.scheme == "http")
        #expect(url.host == "localhost")
        #expect(url.port == 8_888)
    }

    @Test("Creates valid HTTPS URL")
    func hTTPSURLCreation() {
        // Arrange
        let config = ServerConfig(
            host: "example.com",
            port: 443,
            useSSL: true,
            username: "user",
            password: "pass"
        )

        // Act
        let url = config.baseURL

        // Assert
        #expect(url.absoluteString == "https://example.com:443")
        #expect(url.scheme == "https")
        #expect(url.host == "example.com")
        #expect(url.port == 443)
    }

    @Test("WebSocket URL uses correct scheme")
    func webSocketURL() {
        // HTTP -> WS
        let httpConfig = ServerConfig(
            host: "localhost",
            port: 8_888,
            useSSL: false
        )
        #expect(httpConfig.websocketURL.absoluteString == "ws://localhost:8888")
        #expect(httpConfig.websocketURL.scheme == "ws")

        // HTTPS -> WSS
        let httpsConfig = ServerConfig(
            host: "secure.example.com",
            port: 443,
            useSSL: true
        )
        #expect(httpsConfig.websocketURL.absoluteString == "wss://secure.example.com:443")
        #expect(httpsConfig.websocketURL.scheme == "wss")
    }

    @Test("Handles standard ports correctly")
    func standardPorts() {
        // HTTP standard port (80)
        let httpConfig = ServerConfig(
            host: "example.com",
            port: 80,
            useSSL: false
        )
        #expect(httpConfig.baseURL.absoluteString == "http://example.com:80")

        // HTTPS standard port (443)
        let httpsConfig = ServerConfig(
            host: "example.com",
            port: 443,
            useSSL: true
        )
        #expect(httpsConfig.baseURL.absoluteString == "https://example.com:443")
    }

    @Test("Encodes and decodes correctly")
    func codable() throws {
        // Arrange
        let originalConfig = ServerConfig(
            host: "test.local",
            port: 9_999,
            useSSL: true,
            username: "testuser",
            password: "testpass"
        )

        // Act
        let encoder = JSONEncoder()
        let data = try encoder.encode(originalConfig)

        let decoder = JSONDecoder()
        let decodedConfig = try decoder.decode(ServerConfig.self, from: data)

        // Assert
        #expect(decodedConfig.host == originalConfig.host)
        #expect(decodedConfig.port == originalConfig.port)
        #expect(decodedConfig.useSSL == originalConfig.useSSL)
        #expect(decodedConfig.username == originalConfig.username)
        #expect(decodedConfig.password == originalConfig.password)
    }

    @Test("Optional credentials encoding")
    func optionalCredentials() throws {
        // Config without credentials
        let configNoAuth = ServerConfig(
            host: "public.server",
            port: 8_080,
            useSSL: false
        )

        let data = try JSONEncoder().encode(configNoAuth)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(json?["username"] == nil)
        #expect(json?["password"] == nil)
    }

    @Test("Equality comparison")
    func equality() {
        let config1 = ServerConfig(
            host: "localhost",
            port: 8_888,
            useSSL: false
        )

        let config2 = ServerConfig(
            host: "localhost",
            port: 8_888,
            useSSL: false
        )

        let config3 = ServerConfig(
            host: "localhost",
            port: 9_999, // Different port
            useSSL: false
        )

        #expect(config1 == config2)
        #expect(config1 != config3)
    }

    @Test("Handles IPv6 addresses")
    func iPv6Address() {
        let config = ServerConfig(
            host: "::1",
            port: 8_888,
            useSSL: false
        )

        let url = config.baseURL
        #expect(url.absoluteString == "http://[::1]:8888")
        #expect(url.host == "::1")
    }

    @Test("Handles domain with subdomain")
    func subdomainHandling() {
        let config = ServerConfig(
            host: "api.staging.example.com",
            port: 443,
            useSSL: true
        )

        let url = config.baseURL
        #expect(url.absoluteString == "https://api.staging.example.com:443")
        #expect(url.host == "api.staging.example.com")
    }

    @Test("Display name formatting")
    func testDisplayName() {
        // Simple case
        let simpleConfig = ServerConfig(
            host: "localhost",
            port: 8_888,
            useSSL: false
        )
        #expect(simpleConfig.displayName == "localhost:8888")

        // With SSL
        let sslConfig = ServerConfig(
            host: "secure.example.com",
            port: 443,
            useSSL: true
        )
        #expect(sslConfig.displayName == "secure.example.com:443 (SSL)")

        // With authentication
        let authConfig = ServerConfig(
            host: "private.server",
            port: 8_080,
            useSSL: false,
            username: "admin",
            password: "secret"
        )
        #expect(authConfig.displayName == "private.server:8080 (authenticated)")

        // With both SSL and auth
        let fullConfig = ServerConfig(
            host: "secure.private",
            port: 443,
            useSSL: true,
            username: "admin",
            password: "secret"
        )
        #expect(fullConfig.displayName == "secure.private:443 (SSL, authenticated)")
    }

    @Test("JSON representation matches expected format")
    func jSONFormat() throws {
        // Arrange
        let config = ServerConfig(
            host: "test.server",
            port: 3_000,
            useSSL: true,
            username: "user",
            password: "pass"
        )

        // Act
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(config)
        let jsonString = String(data: data, encoding: .utf8)!

        // Assert
        #expect(jsonString.contains("\"host\":\"test.server\""))
        #expect(jsonString.contains("\"port\":3000"))
        #expect(jsonString.contains("\"useSSL\":true"))
        #expect(jsonString.contains("\"username\":\"user\""))
        #expect(jsonString.contains("\"password\":\"pass\""))
    }
}

// MARK: - Integration Tests

@Suite("ServerConfig Integration Tests", .tags(.models, .integration))
struct ServerConfigIntegrationTests {
    @Test("Round-trip through UserDefaults")
    func userDefaultsPersistence() throws {
        // Arrange
        let config = TestFixtures.sslServerConfig
        let key = "test_server_config"

        // Clear any existing value
        UserDefaults.standard.removeObject(forKey: key)

        // Act - Save
        let encoder = JSONEncoder()
        let data = try encoder.encode(config)
        UserDefaults.standard.set(data, forKey: key)

        // Act - Load
        guard let loadedData = UserDefaults.standard.data(forKey: key) else {
            Issue.record("Failed to load data from UserDefaults")
            return
        }

        let decoder = JSONDecoder()
        let loadedConfig = try decoder.decode(ServerConfig.self, from: loadedData)

        // Assert
        #expect(loadedConfig == config)

        // Cleanup
        UserDefaults.standard.removeObject(forKey: key)
    }
}
