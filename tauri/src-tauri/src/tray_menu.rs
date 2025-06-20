use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager};

pub struct TrayMenuManager;

impl TrayMenuManager {
    pub fn create_menu(app: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
        Self::create_menu_with_state(app, false, 4020, 0, None)
    }
    
    pub fn create_menu_with_state(
        app: &AppHandle, 
        server_running: bool, 
        port: u16, 
        session_count: usize,
        access_mode: Option<String>
    ) -> Result<Menu<tauri::Wry>, tauri::Error> {
        // Server status
        let status_text = if server_running {
            format!("Server running on port {}", port)
        } else {
            "Server stopped".to_string()
        };
        let server_status = MenuItemBuilder::new(&status_text)
            .id("server_status")
            .enabled(false)
            .build(app)?;
        
        // Network info (if in network mode)
        let network_info = if server_running && access_mode.as_deref() == Some("network") {
            if let Some(ip) = crate::network_utils::NetworkUtils::get_local_ip_address() {
                Some(MenuItemBuilder::new(&format!("Local IP: {}", ip))
                    .id("network_info")
                    .enabled(false)
                    .build(app)?)
            } else {
                None
            }
        } else {
            None
        };

        // Dashboard access
        let dashboard = MenuItemBuilder::new("Open Dashboard")
            .id("dashboard")
            .build(app)?;

        // Session info
        let session_text = match session_count {
            0 => "0 active sessions".to_string(),
            1 => "1 active session".to_string(),
            _ => format!("{} active sessions", session_count),
        };
        let sessions_info = MenuItemBuilder::new(&session_text)
            .id("sessions_info")
            .enabled(false)
            .build(app)?;

        // Help submenu
        let show_tutorial = MenuItemBuilder::new("Show Tutorial")
            .id("show_tutorial")
            .build(app)?;

        let website = MenuItemBuilder::new("Website").id("website").build(app)?;

        let report_issue = MenuItemBuilder::new("Report Issue")
            .id("report_issue")
            .build(app)?;

        let check_updates = MenuItemBuilder::new("Check for Updates...")
            .id("check_updates")
            .build(app)?;

        // Version info (disabled menu item) - read from Cargo.toml
        let version = env!("CARGO_PKG_VERSION");
        let version_text = format!("Version {}", version);
        let version_info = MenuItemBuilder::new(&version_text)
            .id("version_info")
            .enabled(false)
            .build(app)?;

        let about = MenuItemBuilder::new("About VibeTunnel")
            .id("about")
            .build(app)?;

        let help_menu = SubmenuBuilder::new(app, "Help")
            .item(&show_tutorial)
            .separator()
            .item(&website)
            .item(&report_issue)
            .separator()
            .item(&check_updates)
            .separator()
            .item(&version_info)
            .separator()
            .item(&about)
            .build()?;

        // Settings
        let settings = MenuItemBuilder::new("Settings...")
            .id("settings")
            .build(app)?;

        // Quit
        let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

        // Build the complete menu - matching Mac app exactly
        let mut menu_builder = MenuBuilder::new(app)
            .item(&server_status);
        
        // Add network info if available
        if let Some(network_item) = network_info {
            menu_builder = menu_builder.item(&network_item);
        }
        
        let menu = menu_builder
            .item(&dashboard)
            .separator()
            .item(&sessions_info)
            .separator()
            .item(&help_menu)
            .item(&settings)
            .separator()
            .item(&quit)
            .build()?;

        Ok(menu)
    }

    pub async fn update_server_status(app: &AppHandle, port: u16, running: bool) {
        if let Some(tray) = app.tray_by_id("main") {
            // Get current session count from state
            let state = app.state::<crate::state::AppState>();
            let session_count = state.terminal_manager.list_sessions().await.len();
            
            // Get access mode from settings
            let access_mode = if running {
                if let Ok(settings) = crate::settings::Settings::load() {
                    Some(settings.dashboard.access_mode)
                } else {
                    None
                }
            } else {
                None
            };
            
            // Rebuild menu with new state
            if let Ok(menu) = Self::create_menu_with_state(app, running, port, session_count, access_mode) {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    tracing::error!("Failed to update tray menu: {}", e);
                }
            }
        }
    }

    pub async fn update_session_count(app: &AppHandle, count: usize) {
        if let Some(tray) = app.tray_by_id("main") {
            // Get current server status from state
            let state = app.state::<crate::state::AppState>();
            let server_guard = state.http_server.read().await;
            let (running, port) = if let Some(server) = server_guard.as_ref() {
                (true, server.port())
            } else {
                (false, 4020)
            };
            drop(server_guard);
            
            // Get access mode from settings
            let access_mode = if running {
                if let Ok(settings) = crate::settings::Settings::load() {
                    Some(settings.dashboard.access_mode)
                } else {
                    None
                }
            } else {
                None
            };
            
            // Rebuild menu with new state
            if let Ok(menu) = Self::create_menu_with_state(app, running, port, count, access_mode) {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    tracing::error!("Failed to update tray menu: {}", e);
                }
            }
        }
    }

    pub async fn update_access_mode(_app: &AppHandle, mode: &str) {
        // Update checkmarks in access mode menu
        let _modes = vec![
            ("access_localhost", mode == "localhost"),
            ("access_network", mode == "network"),
            ("access_ngrok", mode == "ngrok"),
        ];

        // Note: In Tauri v2, we need to rebuild the menu to update checkmarks
        tracing::debug!("Access mode updated to: {}", mode);

        // TODO: Implement menu rebuilding for dynamic updates
    }
}
