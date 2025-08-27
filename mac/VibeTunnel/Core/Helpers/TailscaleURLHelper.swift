import Foundation

/// Helper for constructing Tailscale URLs based on configuration
enum TailscaleURLHelper {
    /// Constructs a Tailscale URL based on whether Tailscale Serve is enabled and running
    /// - Parameters:
    ///   - hostname: The Tailscale hostname
    ///   - port: The server port
    ///   - isTailscaleServeEnabled: Whether Tailscale Serve integration is enabled
    ///   - isTailscaleServeRunning: Whether Tailscale Serve is actually running (optional)
    /// - Returns: The appropriate URL for accessing via Tailscale
    static func constructURL(
        hostname: String,
        port: String,
        isTailscaleServeEnabled: Bool,
        isTailscaleServeRunning: Bool? = nil
    )
        -> URL?
    {
        // Use Serve URL only if it's both enabled AND actually running
        let useServeURL = isTailscaleServeEnabled && (isTailscaleServeRunning ?? true)

        if useServeURL {
            // When Tailscale Serve is working, use HTTPS without port
            return URL(string: "https://\(hostname)")
        } else {
            // When Tailscale Serve is disabled or not working, use HTTP with port
            return URL(string: "http://\(hostname):\(port)")
        }
    }

    /// Gets the display address for Tailscale based on configuration
    /// - Parameters:
    ///   - hostname: The Tailscale hostname
    ///   - port: The server port
    ///   - isTailscaleServeEnabled: Whether Tailscale Serve integration is enabled
    ///   - isTailscaleServeRunning: Whether Tailscale Serve is actually running (optional)
    /// - Returns: The display string for the Tailscale address
    static func displayAddress(
        hostname: String,
        port: String,
        isTailscaleServeEnabled: Bool,
        isTailscaleServeRunning: Bool? = nil
    )
        -> String
    {
        // Use clean URL only if Serve is both enabled AND actually running
        let useCleanURL = isTailscaleServeEnabled && (isTailscaleServeRunning ?? true)

        if useCleanURL {
            // When Tailscale Serve is working, show hostname only
            return hostname
        } else {
            // When Tailscale Serve is disabled or not working, show hostname:port
            return "\(hostname):\(port)"
        }
    }
}
