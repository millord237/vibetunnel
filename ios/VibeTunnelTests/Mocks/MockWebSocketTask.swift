import Foundation

/// Simple mock WebSocket session for testing
/// Note: This is a placeholder implementation since we can't easily mock URLSessionWebSocketTask
/// Real tests should use dependency injection or network stubbing libraries
class MockWebSocketSession {
    var mockTask: Any?
    var lastURL: URL?
    var lastRequest: URLRequest?
    
    func webSocketTask(with url: URL) -> Any {
        lastURL = url
        return NSObject() // Return a dummy object
    }
    
    func webSocketTask(with request: URLRequest) -> Any {
        lastRequest = request
        return NSObject() // Return a dummy object
    }
}

/// Placeholder for future WebSocket testing implementation
/// Currently, WebSocket tests are limited to conceptual testing
/// due to URLSessionWebSocketTask not being easily mockable
struct WebSocketTestHelper {
    static func createMockBinaryMessage(cols: Int32, rows: Int32) -> Data {
        var data = Data()
        
        // Magic byte
        data.append(0xBF)
        
        // Header (5 Int32 values in little endian)
        let viewportY: Int32 = 0
        let cursorX: Int32 = 0
        let cursorY: Int32 = 0
        
        data.append(contentsOf: withUnsafeBytes(of: cols.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: rows.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: viewportY.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: cursorX.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: cursorY.littleEndian) { Array($0) })
        
        return data
    }
}