import Foundation
import os.log
import SwiftUI

/// Service to fetch Tailscale Serve status from the server
@MainActor
@Observable
final class TailscaleServeStatusService {
    static let shared = TailscaleServeStatusService()

    var isRunning = false
    var lastError: String?
    var startTime: Date?
    var isLoading = false
    var isPermanentlyDisabled = false

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "TailscaleServeStatus")
    private var updateTimer: Timer?
    private var isCurrentlyFetching = false

    private init() {}

    /// Start polling for status updates
    func startMonitoring() {
        logger.debug("Starting Tailscale Serve status monitoring")

        // Initial fetch
        Task {
            await self.fetchStatus()
        }

        // Set up less aggressive periodic updates - only if not currently fetching and not permanently disabled
        updateTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, !self.isCurrentlyFetching, !self.isPermanentlyDisabled else {
                    return
                }
                await self.fetchStatus()
            }
        }
    }

    /// Stop polling for status updates
    func stopMonitoring() {
        logger.debug("Stopping Tailscale Serve status monitoring")
        updateTimer?.invalidate()
        updateTimer = nil
        isCurrentlyFetching = false
        isPermanentlyDisabled = false
    }

    /// Force an immediate status update (useful after server operations)
    func refreshStatusImmediately() async {
        logger.debug("Forcing immediate Tailscale Serve status refresh")
        await fetchStatus()
    }

    /// Fetch the current Tailscale Serve status
    @MainActor
    func fetchStatus() async {
        // Prevent concurrent fetches
        guard !isCurrentlyFetching else {
            logger.debug("Skipping fetch - already in progress")
            return
        }

        isCurrentlyFetching = true
        isLoading = true
        defer {
            isLoading = false
            isCurrentlyFetching = false
        }

        logger.info("🔄 [TAILSCALE STATUS] Starting status fetch at \(Date())")
        logger.debug("Fetching Tailscale Serve status...")

        // Get server port
        let port = UserDefaults.standard.string(forKey: AppConstants.UserDefaultsKeys.serverPort) ?? "4020"
        let urlString = "http://localhost:\(port)/api/sessions/tailscale/status"

        guard let url = URL(string: urlString) else {
            self.logger.error("Invalid URL for Tailscale status endpoint")
            return
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse else {
                self.logger.error("Invalid response type")
                self.isRunning = false
                self.lastError = "Invalid server response"
                return
            }

            guard httpResponse.statusCode == 200 else {
                self.logger.error("HTTP error: \(httpResponse.statusCode)")
                // If we get a non-200 response, there's an issue with the endpoint
                self.isRunning = false
                self.lastError = "Unable to check status (HTTP \(httpResponse.statusCode))"
                return
            }

            let decoder = JSONDecoder()
            // Use custom date decoder to handle ISO8601 with fractional seconds
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let dateString = try container.decode(String.self)

                // Create formatter inside the closure to avoid Sendable warning
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: dateString) {
                    return date
                }
                // Fallback to standard ISO8601 without fractional seconds
                formatter.formatOptions = [.withInternetDateTime]
                if let date = formatter.date(from: dateString) {
                    return date
                }
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Cannot decode date string \(dateString)")
            }

            let status = try decoder.decode(TailscaleServeStatus.self, from: data)

            logger.info("📊 [TAILSCALE STATUS] Response received:")
            logger.info("  - isRunning: \(status.isRunning)")
            logger.info("  - lastError: \(status.lastError ?? "none")")
            logger.info("  - isPermanentlyDisabled: \(status.isPermanentlyDisabled ?? false)")
            logger.info("  - Previous isPermanentlyDisabled: \(self.isPermanentlyDisabled)")

            // Check if this is a permanent failure (tailnet not configured)
            if let error = status.lastError {
                if error.contains("Serve is not enabled on your tailnet") ||
                    error.contains("Tailscale Serve feature not enabled") ||
                    error.contains("Tailscale Serve is disabled on your tailnet")
                {
                    isPermanentlyDisabled = true
                    logger.info("[TAILSCALE STATUS] Tailscale Serve not enabled on tailnet - using fallback mode")
                } else {
                    // Clear permanent disable if we get a different error
                    isPermanentlyDisabled = false
                    logger.info("⚠️ [TAILSCALE STATUS] Error but not permanent: \(error)")
                }
            } else if status.isRunning {
                // Clear permanent disable if it's now running
                isPermanentlyDisabled = false
                logger.info("✅ [TAILSCALE STATUS] Tailscale Serve is running")
            }

            // Update published properties
            let oldRunning = isRunning
            let oldError = lastError
            isRunning = status.isRunning
            lastError = status.lastError
            startTime = status.startTime

            logger.info("📝 [TAILSCALE STATUS] State changed:")
            logger.info("  - isRunning: \(oldRunning) -> \(self.isRunning)")
            logger.info("  - lastError: \(oldError ?? "none") -> \(self.lastError ?? "none")")
            logger.info("  - isPermanentlyDisabled: \(self.isPermanentlyDisabled)")

            logger
                .debug(
                    "Tailscale Serve status - Running: \(status.isRunning), Error: \(status.lastError ?? "none"), Permanently disabled: \(self.isPermanentlyDisabled)"
                )
        } catch {
            logger.error("Failed to fetch Tailscale Serve status: \(error.localizedDescription)")
            logger.error("Full error details: \(String(describing: error))")
            logger.error("Attempting to connect to: \(urlString)")

            // On error, assume not running
            isRunning = false
            // Provide specific error messages based on the error type
            lastError = self.parseStatusCheckError(error)
        }
    }

    /// Parse status check errors and return user-friendly messages
    private func parseStatusCheckError(_ error: Error) -> String {
        let errorDescription = error.localizedDescription.lowercased()

        if errorDescription.contains("couldn't connect") || errorDescription.contains("connection refused") {
            return "VibeTunnel server not responding"
        } else if errorDescription.contains("couldn't be read") {
            return "Connection to server lost"
        } else if errorDescription.contains("timed out") || errorDescription.contains("timeout") {
            return "Server response timeout"
        } else if errorDescription.contains("invalid") && errorDescription.contains("url") {
            return "Invalid server configuration"
        } else if errorDescription.contains("network") {
            return "Network connectivity issue"
        } else {
            // Fall back to a generic but helpful message
            return "Unable to check Tailscale Serve status"
        }
    }
}

/// Response model for Tailscale Serve status
struct TailscaleServeStatus: Codable {
    let isRunning: Bool
    let port: Int?
    let error: String?
    let lastError: String?
    let startTime: Date?
    let isPermanentlyDisabled: Bool?
}
