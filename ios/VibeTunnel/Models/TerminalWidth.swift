import Foundation

/// Common terminal width presets
enum TerminalWidth: CaseIterable, Equatable {
    case unlimited
    case classic80
    case modern100
    case wide120
    case mainframe132
    case ultraWide160
    case custom(Int)
    
    var value: Int {
        switch self {
        case .unlimited: return 0
        case .classic80: return 80
        case .modern100: return 100
        case .wide120: return 120
        case .mainframe132: return 132
        case .ultraWide160: return 160
        case .custom(let width): return width
        }
    }
    
    var label: String {
        switch self {
        case .unlimited: return "∞"
        case .classic80: return "80"
        case .modern100: return "100"
        case .wide120: return "120"
        case .mainframe132: return "132"
        case .ultraWide160: return "160"
        case .custom(let width): return "\(width)"
        }
    }
    
    var description: String {
        switch self {
        case .unlimited: return "Unlimited"
        case .classic80: return "Classic terminal"
        case .modern100: return "Modern standard"
        case .wide120: return "Wide terminal"
        case .mainframe132: return "Mainframe width"
        case .ultraWide160: return "Ultra-wide"
        case .custom: return "Custom width"
        }
    }
    
    static var allCases: [TerminalWidth] {
        [.unlimited, .classic80, .modern100, .wide120, .mainframe132, .ultraWide160]
    }
    
    static func from(value: Int) -> TerminalWidth {
        switch value {
        case 0: return .unlimited
        case 80: return .classic80
        case 100: return .modern100
        case 120: return .wide120
        case 132: return .mainframe132
        case 160: return .ultraWide160
        default: return .custom(value)
        }
    }
    
    /// Check if this is a standard preset width
    var isPreset: Bool {
        switch self {
        case .custom: return false
        default: return true
        }
    }
}

/// Manager for terminal width preferences
@MainActor
class TerminalWidthManager {
    static let shared = TerminalWidthManager()
    
    private let defaultWidthKey = "defaultTerminalWidth"
    private let customWidthsKey = "customTerminalWidths"
    
    private init() {}
    
    /// Get the default terminal width
    var defaultWidth: Int {
        get {
            UserDefaults.standard.integer(forKey: defaultWidthKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: defaultWidthKey)
        }
    }
    
    /// Get saved custom widths
    var customWidths: [Int] {
        get {
            UserDefaults.standard.array(forKey: customWidthsKey) as? [Int] ?? []
        }
        set {
            UserDefaults.standard.set(newValue, forKey: customWidthsKey)
        }
    }
    
    /// Add a custom width to saved list
    func addCustomWidth(_ width: Int) {
        var widths = customWidths
        if !widths.contains(width) && width >= 20 && width <= 500 {
            widths.append(width)
            // Keep only last 5 custom widths
            if widths.count > 5 {
                widths.removeFirst()
            }
            customWidths = widths
        }
    }
    
    /// Get all available widths including custom ones
    func allWidths() -> [TerminalWidth] {
        var widths = TerminalWidth.allCases
        for customWidth in customWidths {
            if !TerminalWidth.allCases.contains(where: { $0.value == customWidth }) {
                widths.append(.custom(customWidth))
            }
        }
        return widths
    }
}