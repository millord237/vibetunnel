import SwiftUI

/// Third page requesting AppleScript automation and accessibility permissions.
///
/// This view guides users through granting necessary permissions for VibeTunnel
/// to function properly. It handles both AppleScript permissions for terminal
/// automation and accessibility permissions for sending commands.
///
/// ## Topics
///
/// ### Overview
/// The permissions page includes:
/// - AppleScript permission request and status
/// - Accessibility permission request and status
/// - Terminal application selector
/// - Real-time permission status updates
///
/// ### Requirements
/// - ``SystemPermissionManager`` for all system permissions
/// - Terminal selection stored in UserDefaults
struct RequestPermissionsPageView: View {
    @State private var permissionManager = SystemPermissionManager.shared
    @State private var permissionUpdateTrigger = 0

    private var hasAppleScriptPermission: Bool {
        // This will cause a re-read whenever permissionUpdateTrigger changes
        _ = permissionUpdateTrigger
        return permissionManager.hasPermission(.appleScript)
    }
    
    private var hasAccessibilityPermission: Bool {
        // This will cause a re-read whenever permissionUpdateTrigger changes
        _ = permissionUpdateTrigger
        return permissionManager.hasPermission(.accessibility)
    }

    var body: some View {
        VStack(spacing: 30) {
            // App icon
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: 156, height: 156)
                .shadow(radius: 10)

            VStack(spacing: 16) {
                Text("Request Permissions")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "VibeTunnel needs AppleScript to start new terminal sessions\nand accessibility to send commands."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                // Permissions buttons
                VStack(spacing: 16) {
                    // Automation permission
                    if hasAppleScriptPermission {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Automation permission granted")
                                .foregroundColor(.secondary)
                        }
                        .font(.body)
                        .frame(maxWidth: 250)
                        .frame(height: 32)
                    } else {
                        Button("Grant Automation Permission") {
                            permissionManager.requestPermission(.appleScript)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)
                        .frame(width: 250, height: 32)
                    }

                    // Accessibility permission
                    if hasAccessibilityPermission {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Accessibility permission granted")
                                .foregroundColor(.secondary)
                        }
                        .font(.body)
                        .frame(maxWidth: 250)
                        .frame(height: 32)
                    } else {
                        Button("Grant Accessibility Permission") {
                            permissionManager.requestPermission(.accessibility)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.regular)
                        .frame(width: 250, height: 32)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .onReceive(Timer.publish(every: 1.0, on: .main, in: .common).autoconnect()) { _ in
            // Force a re-render to check permissions
            permissionUpdateTrigger += 1
        }
        .task {
            // Check all permissions
            await permissionManager.checkAllPermissions()
        }
    }
}

// MARK: - Preview

struct RequestPermissionsPageView_Previews: PreviewProvider {
    static var previews: some View {
        RequestPermissionsPageView()
            .frame(width: 640, height: 480)
            .background(Color(NSColor.windowBackgroundColor))
    }
}
