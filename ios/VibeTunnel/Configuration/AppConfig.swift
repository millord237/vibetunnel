import Foundation

/// App configuration for VibeTunnel
struct AppConfig {
    /// Set the logging level for the app
    /// Change this to control verbosity of logs
    static func configureLogging() {
        #if DEBUG
        // In debug builds, you can change this to .verbose to see all logs
        Logger.globalLevel = .info  // Change to .verbose for detailed logging
        #else
        // In release builds, only show warnings and errors
        Logger.globalLevel = .warning
        #endif
    }
}