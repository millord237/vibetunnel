import Foundation
import UserNotifications
import os.log

/// Manages native macOS notifications for VibeTunnel events.
///
/// Connects to the VibeTunnel server to receive real-time events like session starts,
/// command completions, and errors, then displays them as native macOS notifications.
@MainActor
final class NotificationService: NSObject {
    static let shared = NotificationService()
    
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "NotificationService")
    private var eventSource: EventSource?
    private let serverManager = ServerManager.shared
    private var isConnected = false
    private var recentlyNotifiedSessions = Set<String>()
    private var notificationCleanupTimer: Timer?
    
    /// Notification types that can be enabled/disabled
    struct NotificationPreferences {
        var sessionStart: Bool = true
        var sessionExit: Bool = true
        var commandCompletion: Bool = true
        var commandError: Bool = true
        var bell: Bool = true
        
        init() {
            // Load from UserDefaults
            let defaults = UserDefaults.standard
            self.sessionStart = defaults.bool(forKey: "notifications.sessionStart")
            self.sessionExit = defaults.bool(forKey: "notifications.sessionExit")
            self.commandCompletion = defaults.bool(forKey: "notifications.commandCompletion")
            self.commandError = defaults.bool(forKey: "notifications.commandError")
            self.bell = defaults.bool(forKey: "notifications.bell")
            
            // Set defaults if not set
            if !defaults.bool(forKey: "notifications.initialized") {
                defaults.set(true, forKey: "notifications.sessionStart")
                defaults.set(true, forKey: "notifications.sessionExit")
                defaults.set(true, forKey: "notifications.commandCompletion")
                defaults.set(true, forKey: "notifications.commandError")
                defaults.set(true, forKey: "notifications.bell")
                defaults.set(true, forKey: "notifications.initialized")
            }
        }
        
        func save() {
            let defaults = UserDefaults.standard
            defaults.set(sessionStart, forKey: "notifications.sessionStart")
            defaults.set(sessionExit, forKey: "notifications.sessionExit")
            defaults.set(commandCompletion, forKey: "notifications.commandCompletion")
            defaults.set(commandError, forKey: "notifications.commandError")
            defaults.set(bell, forKey: "notifications.bell")
        }
    }
    
    private var preferences = NotificationPreferences()
    
    private override init() {
        super.init()
        setupNotifications()
        
        // Load preferences from API on startup
        Task {
            await syncPreferencesFromAPI()
        }
    }
    
    /// Start monitoring server events
    func start() {
        guard serverManager.isRunning else {
            logger.debug("Server not running, skipping notification service start")
            return
        }
        
        connect()
    }
    
    /// Stop monitoring server events
    func stop() {
        disconnect()
    }
    
    /// Update notification preferences
    func updatePreferences(_ prefs: NotificationPreferences) {
        self.preferences = prefs
        prefs.save()
        
        // Sync to API
        Task {
            await syncPreferencesToAPI(prefs)
        }
    }
    
    // MARK: - Private Methods
    
    private func setupNotifications() {
        // Listen for server state changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(serverStateChanged),
            name: .serverStateChanged,
            object: nil
        )
    }
    
    @objc private func serverStateChanged(_ notification: Notification) {
        if serverManager.isRunning {
            // Delay connection to ensure server is ready
            Task {
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
                await MainActor.run {
                    if serverManager.isRunning {
                        connect()
                    }
                }
            }
        } else {
            disconnect()
        }
    }
    
    private func connect() {
        guard !isConnected else { return }
        
        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/events") else {
            logger.error("Invalid event stream URL")
            return
        }
        
        logger.info("Connecting to server event stream at \(url.absoluteString)")
        
        eventSource = EventSource(url: url)
        
        eventSource?.onOpen = { [weak self] in
            self?.logger.info("Event stream connected")
            self?.isConnected = true
        }
        
        eventSource?.onError = { [weak self] error in
            self?.logger.error("Event stream error: \(error?.localizedDescription ?? "Unknown")")
            self?.isConnected = false
        }
        
        eventSource?.onMessage = { [weak self] event in
            self?.handleServerEvent(event)
        }
        
        eventSource?.connect()
    }
    
    private func disconnect() {
        eventSource?.disconnect()
        eventSource = nil
        isConnected = false
        logger.info("Disconnected from event stream")
    }
    
    private func handleServerEvent(_ event: EventSource.Event) {
        guard let data = event.data else { return }
        
        do {
            guard let jsonData = data.data(using: .utf8),
                  let json = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                  let type = json["type"] as? String else {
                logger.error("Invalid event data format")
                return
            }
            
            logger.debug("Received event: \(type)")
            
            switch type {
            case "session-start":
                if preferences.sessionStart {
                    handleSessionStart(json)
                }
            case "session-exit":
                if preferences.sessionExit {
                    handleSessionExit(json)
                }
            case "command-finished":
                if preferences.commandCompletion {
                    handleCommandFinished(json)
                }
            case "command-error":
                if preferences.commandError {
                    handleCommandError(json)
                }
            case "bell":
                if preferences.bell {
                    handleBell(json)
                }
            default:
                logger.debug("Unhandled event type: \(type)")
            }
        } catch {
            logger.error("Failed to parse event: \(error)")
        }
    }
    
    private func handleSessionStart(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }
        
        // Check for duplicate notifications
        if let sessionId = data["sessionId"] as? String {
            if recentlyNotifiedSessions.contains(sessionId) {
                logger.debug("Skipping duplicate notification for session \(sessionId)")
                return
            }
            recentlyNotifiedSessions.insert(sessionId)
            
            // Schedule cleanup after 10 seconds
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 10_000_000_000) // 10 seconds
                self.recentlyNotifiedSessions.remove(sessionId)
            }
        }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Started"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "SESSION"
        
        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "session-start"]
            deliverNotification(content, identifier: "session-start-\(sessionId)")
        } else {
            deliverNotification(content, identifier: "session-start-\(UUID().uuidString)")
        }
    }
    
    private func handleSessionExit(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Session Ended"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "SESSION"
        
        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "session-exit"]
        }
        
        if let exitCode = data["exitCode"] as? Int, exitCode != 0 {
            content.subtitle = "Exit code: \(exitCode)"
        }
        
        deliverNotification(content, identifier: "session-exit-\(UUID().uuidString)")
    }
    
    private func handleCommandFinished(_ data: [String: Any]) {
        guard let command = data["command"] as? String else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Command Completed"
        content.body = command
        content.sound = .default
        content.categoryIdentifier = "COMMAND"
        
        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "command-finished"]
        }
        
        if let duration = data["duration"] as? Int {
            let seconds = duration / 1000
            if seconds > 60 {
                content.subtitle = "Duration: \(seconds / 60)m \(seconds % 60)s"
            } else {
                content.subtitle = "Duration: \(seconds)s"
            }
        }
        
        deliverNotification(content, identifier: "command-\(UUID().uuidString)")
    }
    
    private func handleCommandError(_ data: [String: Any]) {
        guard let command = data["command"] as? String else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Command Failed"
        content.body = command
        content.sound = .defaultCritical
        content.categoryIdentifier = "COMMAND"
        
        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "command-error"]
        }
        
        if let exitCode = data["exitCode"] as? Int {
            content.subtitle = "Exit code: \(exitCode)"
        }
        
        deliverNotification(content, identifier: "command-error-\(UUID().uuidString)")
    }
    
    private func handleBell(_ data: [String: Any]) {
        guard let sessionName = data["sessionName"] as? String else { return }
        
        let content = UNMutableNotificationContent()
        content.title = "Terminal Bell"
        content.body = sessionName
        content.sound = .default
        content.categoryIdentifier = "BELL"
        
        if let sessionId = data["sessionId"] as? String {
            content.userInfo = ["sessionId": sessionId, "type": "bell"]
        }
        
        if let processInfo = data["processInfo"] as? String {
            content.subtitle = processInfo
        }
        
        deliverNotification(content, identifier: "bell-\(UUID().uuidString)")
    }
    
    private func deliverNotification(_ content: UNMutableNotificationContent, identifier: String) {
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        
        Task {
            do {
                try await UNUserNotificationCenter.current().add(request)
                logger.debug("Delivered notification: \(content.title)")
            } catch {
                logger.error("Failed to deliver notification: \(error)")
            }
        }
    }
}

// MARK: - EventSource

/// Simple Server-Sent Events client
private final class EventSource: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private var session: URLSession?
    private var task: URLSessionDataTask?
    
    var onOpen: (() -> Void)?
    var onMessage: ((Event) -> Void)?
    var onError: ((Error?) -> Void)?
    
    struct Event {
        let id: String?
        let event: String?
        let data: String?
    }
    
    init(url: URL) {
        self.url = url
        super.init()
    }
    
    func connect() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = TimeInterval.infinity
        configuration.timeoutIntervalForResource = TimeInterval.infinity
        
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        
        task = session?.dataTask(with: request)
        task?.resume()
    }
    
    func disconnect() {
        task?.cancel()
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }
    
    // URLSessionDataDelegate
    
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
            DispatchQueue.main.async {
                self.onOpen?()
            }
            completionHandler(.allow)
        } else {
            completionHandler(.cancel)
            DispatchQueue.main.async {
                self.onError?(nil)
            }
        }
    }
    
    private var buffer = ""
    
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        
        // Process complete events
        let lines = buffer.components(separatedBy: "\n")
        buffer = lines.last ?? ""
        
        var currentEvent = Event(id: nil, event: nil, data: nil)
        var dataLines: [String] = []
        
        for line in lines.dropLast() {
            if line.isEmpty {
                // End of event
                if !dataLines.isEmpty {
                    let data = dataLines.joined(separator: "\n")
                    let event = Event(id: currentEvent.id, event: currentEvent.event, data: data)
                    DispatchQueue.main.async {
                        self.onMessage?(event)
                    }
                }
                currentEvent = Event(id: nil, event: nil, data: nil)
                dataLines = []
            } else if line.hasPrefix("id:") {
                currentEvent = Event(id: line.dropFirst(3).trimmingCharacters(in: .whitespaces), event: currentEvent.event, data: currentEvent.data)
            } else if line.hasPrefix("event:") {
                currentEvent = Event(id: currentEvent.id, event: line.dropFirst(6).trimmingCharacters(in: .whitespaces), data: currentEvent.data)
            } else if line.hasPrefix("data:") {
                dataLines.append(String(line.dropFirst(5).trimmingCharacters(in: .whitespaces)))
            }
        }
    }
    
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async {
            self.onError?(error)
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let serverStateChanged = Notification.Name("serverStateChanged")
}

// MARK: - API Sync

extension NotificationService {
    /// Sync preferences from the API
    private func syncPreferencesFromAPI() async {
        guard serverManager.isRunning else { return }
        
        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/preferences/notifications") else {
            return
        }
        
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Bool] {
                // Map API preferences to our format
                var prefs = NotificationPreferences()
                prefs.sessionStart = json["sessionStart"] ?? true
                prefs.sessionExit = json["sessionExit"] ?? true
                prefs.commandCompletion = json["commandNotifications"] ?? true
                prefs.commandError = json["sessionError"] ?? true
                prefs.bell = json["systemAlerts"] ?? true
                
                // Update local preferences
                self.preferences = prefs
                prefs.save()
                
                logger.info("Synced notification preferences from API")
            }
        } catch {
            logger.debug("Failed to sync preferences from API: \(error)")
            // Not critical - we have local defaults
        }
    }
    
    /// Sync preferences to the API
    private func syncPreferencesToAPI(_ prefs: NotificationPreferences) async {
        guard serverManager.isRunning else { return }
        
        let port = serverManager.port
        guard let url = URL(string: "http://localhost:\(port)/api/preferences/notifications") else {
            return
        }
        
        // Map our preferences to API format
        let apiPrefs: [String: Any] = [
            "enabled": true, // Always true for native notifications
            "sessionStart": prefs.sessionStart,
            "sessionExit": prefs.sessionExit,
            "commandNotifications": prefs.commandCompletion,
            "sessionError": prefs.commandError,
            "systemAlerts": prefs.bell,
            "soundEnabled": true,
            "vibrationEnabled": false
        ]
        
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: apiPrefs)
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = jsonData
            
            let (_, _) = try await URLSession.shared.data(for: request)
            logger.info("Synced notification preferences to API")
        } catch {
            logger.error("Failed to sync preferences to API: \(error)")
            // Not critical - changes are saved locally
        }
    }
}