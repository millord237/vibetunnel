import Foundation

/// Available terminal renderer implementations
enum TerminalRenderer: String, CaseIterable, Codable {
    case swiftTerm = "SwiftTerm"
    case xterm = "xterm.js"
    
    var displayName: String {
        switch self {
        case .swiftTerm:
            return "SwiftTerm (Native)"
        case .xterm:
            return "xterm.js (WebView)"
        }
    }
    
    var description: String {
        switch self {
        case .swiftTerm:
            return "Native Swift terminal emulator with best performance"
        case .xterm:
            return "JavaScript-based terminal, identical to web version"
        }
    }
    
    /// The currently selected renderer (persisted in UserDefaults)
    static var selected: TerminalRenderer {
        get {
            if let rawValue = UserDefaults.standard.string(forKey: "selectedTerminalRenderer"),
               let renderer = TerminalRenderer(rawValue: rawValue) {
                return renderer
            }
            return .swiftTerm // Default
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: "selectedTerminalRenderer")
        }
    }
}