import Foundation

/// Mock implementation of URLSessionWebSocketTask for testing
class MockWebSocketTask: URLSessionWebSocketTask {
    var isConnected = false
    var messageHandler: ((URLSessionWebSocketTask.Message) -> Void)?
    var closeHandler: ((URLSessionWebSocketTask.CloseCode, Data?) -> Void)?
    var sendMessageCalled = false
    var sentMessages: [URLSessionWebSocketTask.Message] = []
    var cancelCalled = false

    // Control test behavior
    var shouldFailConnection = false
    var connectionError: Error?
    var messageQueue: [URLSessionWebSocketTask.Message] = []

    override func resume() {
        if shouldFailConnection {
            closeHandler?(.abnormalClosure, nil)
        } else {
            isConnected = true
        }
    }

    override func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        cancelCalled = true
        isConnected = false
        closeHandler?(closeCode, reason)
    }

    override func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping (Error?) -> Void) {
        sendMessageCalled = true
        sentMessages.append(message)

        if let error = connectionError {
            completionHandler(error)
        } else {
            completionHandler(nil)
        }
    }

    override func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
        if let error = connectionError {
            completionHandler(.failure(error))
            return
        }

        if !messageQueue.isEmpty {
            let message = messageQueue.removeFirst()
            completionHandler(.success(message))
            messageHandler?(message)
        } else {
            // Simulate waiting for messages
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.1) { [weak self] in
                if let self, !self.messageQueue.isEmpty {
                    let message = self.messageQueue.removeFirst()
                    completionHandler(.success(message))
                    self.messageHandler?(message)
                } else {
                    // Keep the connection open
                    self?.receive(completionHandler: completionHandler)
                }
            }
        }
    }

    override func sendPing(pongReceiveHandler: @escaping (Error?) -> Void) {
        if let error = connectionError {
            pongReceiveHandler(error)
        } else {
            pongReceiveHandler(nil)
        }
    }

    /// Test helpers
    func simulateMessage(_ message: URLSessionWebSocketTask.Message) {
        messageQueue.append(message)
    }

    func simulateDisconnection(code: URLSessionWebSocketTask.CloseCode = .abnormalClosure) {
        isConnected = false
        closeHandler?(code, nil)
    }
}

/// Mock URLSession for creating mock WebSocket tasks
class MockWebSocketURLSession: URLSession {
    var mockTask: MockWebSocketTask?

    override func webSocketTask(with url: URL) -> URLSessionWebSocketTask {
        let task = MockWebSocketTask()
        mockTask = task
        return task
    }

    override func webSocketTask(with request: URLRequest) -> URLSessionWebSocketTask {
        let task = MockWebSocketTask()
        mockTask = task
        return task
    }
}
