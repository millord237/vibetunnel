use std::fmt;

/// Backend server errors
#[derive(Debug)]
pub enum BackendError {
    /// Server executable not found
    ExecutableNotFound(String),
    /// Failed to spawn process
    SpawnFailed(std::io::Error),
    /// Server crashed with exit code
    ServerCrashed(i32),
    /// Port already in use
    PortInUse(u16),
    /// Authentication failed
    AuthenticationFailed,
    /// Invalid configuration
    InvalidConfig(String),
    /// Timeout waiting for server to start
    StartupTimeout,
    /// Network error
    NetworkError(String),
    /// Generic error with message
    Other(String),
}

impl fmt::Display for BackendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BackendError::ExecutableNotFound(path) => {
                write!(f, "vibetunnel executable not found at: {}", path)
            }
            BackendError::SpawnFailed(err) => {
                write!(f, "Failed to spawn server process: {}", err)
            }
            BackendError::ServerCrashed(code) => {
                write!(f, "Server crashed with exit code: {}", code)
            }
            BackendError::PortInUse(port) => {
                write!(f, "Port {} is already in use", port)
            }
            BackendError::AuthenticationFailed => {
                write!(f, "Authentication failed")
            }
            BackendError::InvalidConfig(msg) => {
                write!(f, "Invalid configuration: {}", msg)
            }
            BackendError::StartupTimeout => {
                write!(f, "Server failed to start within timeout period")
            }
            BackendError::NetworkError(msg) => {
                write!(f, "Network error: {}", msg)
            }
            BackendError::Other(msg) => {
                write!(f, "{}", msg)
            }
        }
    }
}

impl std::error::Error for BackendError {}

impl From<std::io::Error> for BackendError {
    fn from(err: std::io::Error) -> Self {
        BackendError::SpawnFailed(err)
    }
}

/// Convert BackendError to a user-friendly error message
impl BackendError {
    pub fn user_message(&self) -> String {
        match self {
            BackendError::ExecutableNotFound(_) => {
                "The VibeTunnel server executable was not found. Please reinstall the application.".to_string()
            }
            BackendError::SpawnFailed(_) => {
                "Failed to start the server process. Please check your system permissions.".to_string()
            }
            BackendError::ServerCrashed(code) => {
                match code {
                    9 => "The server port is already in use. Please choose a different port in settings.".to_string(),
                    127 => "Server executable or dependencies are missing. Please reinstall the application.".to_string(),
                    _ => format!("The server crashed unexpectedly (code {}). Check the logs for details.", code)
                }
            }
            BackendError::PortInUse(port) => {
                format!("Port {} is already in use. Please choose a different port in settings.", port)
            }
            BackendError::AuthenticationFailed => {
                "Authentication failed. Please check your credentials.".to_string()
            }
            BackendError::InvalidConfig(msg) => {
                format!("Invalid configuration: {}", msg)
            }
            BackendError::StartupTimeout => {
                "The server took too long to start. Please try again.".to_string()
            }
            BackendError::NetworkError(_) => {
                "Network error occurred. Please check your connection.".to_string()
            }
            BackendError::Other(msg) => msg.clone(),
        }
    }
}