import SwiftUI

/// Floating action button to scroll terminal to bottom
struct ScrollToBottomButton: View {
    let isVisible: Bool
    let action: () -> Void
    @State private var isHovered = false
    @State private var isPressed = false

    var body: some View {
        Button(action: {
            HapticFeedback.impact(.light)
            action()
        }) {
            Text("↓")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(isHovered ? Theme.Colors.primaryAccent : Theme.Colors.terminalForeground)
                .frame(width: 48, height: 48)
                .background(
                    Circle()
                        .fill(isHovered ? Theme.Colors.cardBackground : Theme.Colors.cardBackground.opacity(0.8))
                        .overlay(
                            Circle()
                                .stroke(
                                    isHovered ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                                    lineWidth: isHovered ? 2 : 1
                                )
                        )
                )
                .shadow(
                    color: isHovered ? Theme.Colors.primaryAccent.opacity(0.3) : .black.opacity(0.3),
                    radius: isHovered ? 12 : 8,
                    x: 0,
                    y: isHovered ? 3 : 4
                )
                .scaleEffect(isPressed ? 0.95 : 1.0)
                .offset(y: isHovered && !isPressed ? -1 : 0)
        }
        .buttonStyle(PlainButtonStyle())
        .opacity(isVisible ? 1 : 0)
        .scaleEffect(isVisible ? 1 : 0.8)
        .animation(Theme.Animation.quick, value: isHovered)
        .animation(Theme.Animation.quick, value: isPressed)
        .animation(Theme.Animation.smooth, value: isVisible)
        .allowsHitTesting(isVisible)
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity) { pressing in
            isPressed = pressing
        } perform: {
            // Action handled by button
        }
        .onHover { hovering in
            isHovered = hovering
        }
    }
}

/// Extension to add scroll-to-bottom overlay modifier
extension View {
    func scrollToBottomOverlay(
        isVisible: Bool,
        action: @escaping () -> Void
    )
        -> some View {
        self.overlay(
            ScrollToBottomButton(
                isVisible: isVisible,
                action: action
            )
            .padding(.bottom, Theme.Spacing.large)
            .padding(.leading, Theme.Spacing.large),
            alignment: .bottomLeading
        )
    }
}

#Preview {
    ZStack {
        Theme.Colors.terminalBackground
            .ignoresSafeArea()

        ScrollToBottomButton(isVisible: true) {
            print("Scroll to bottom")
        }
    }
}
