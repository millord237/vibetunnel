# iOS Web Parity Implementation Plan

This document outlines the missing features in the iOS app compared to the web frontend and the implementation plan to achieve full feature parity.

## Missing Features Analysis

### High Priority Features

1. **Terminal Width Selector** ❌
   - Web has: Width button showing current width (∞, 80, 100, 120, 132, 160, custom)
   - iOS has: Basic width adjustment in sheet, no quick selector
   - Need: Quick width selector button with common presets

2. **File Browser Path Insertion** ❌
   - Web has: Direct path insertion into terminal when selecting files
   - iOS has: Only copy to clipboard
   - Need: Insert path functionality with proper escaping for spaces

3. **Mobile Control Buttons** ❌ 
   - Web has: On-screen buttons for arrows, ESC, Tab, Enter, Ctrl
   - iOS has: Limited toolbar with some special keys
   - Need: Complete set of control buttons

4. **Full-Screen Text Input** ❌
   - Web has: Full-screen overlay for mobile text input
   - iOS has: Native keyboard only
   - Need: Optional full-screen input mode

5. **Ctrl+Key Overlay** ❌
   - Web has: Grid selector for Ctrl combinations
   - iOS has: No Ctrl+key selector
   - Need: Grid overlay for Ctrl sequences

### Medium Priority Features

6. **Font Size Controls** ⚠️
   - Web has: +/- buttons with reset, range 8-32px
   - iOS has: Slider in sheet, no quick controls
   - Need: Quick adjustment buttons in toolbar

7. **Session Snapshot Loading** ❌
   - Web has: Loads final snapshot for exited sessions
   - iOS has: No snapshot loading
   - Need: Implement snapshot API and display

8. **Keyboard Shortcuts** ⚠️
   - Web has: Cmd+O for file browser, various shortcuts
   - iOS has: Limited keyboard support
   - Need: Comprehensive keyboard shortcut support

9. **Enhanced File Browser** ⚠️
   - Web has: Syntax highlighting, image preview, diff viewer
   - iOS has: Basic preview, no diff integration
   - Need: Enhanced preview capabilities

### Low Priority Features

10. **Git Status in File Browser** ⚠️
    - Web has: Inline git status indicators
    - iOS has: Git status but less prominent
    - Need: Better git status visualization

11. **Swipe Gestures** ✅
    - Web has: Swipe from left edge to go back
    - iOS has: Native swipe back gesture
    - Status: Already implemented

## Implementation Order

### Phase 1: Core Terminal UX (High Priority)
1. Terminal Width Selector
2. Font Size Quick Controls
3. Mobile Control Buttons

### Phase 2: Enhanced Input (High Priority)
4. File Browser Path Insertion
5. Full-Screen Text Input
6. Ctrl+Key Overlay

### Phase 3: Session Management (Medium Priority)
7. Session Snapshot Loading
8. Keyboard Shortcuts
9. Enhanced File Preview

### Phase 4: Polish (Low Priority)
10. Improved Git Status Display
11. Additional gestures and animations

## Technical Considerations

### Width Management
- Store preferred widths in UserDefaults
- Common widths: [0 (∞), 80, 100, 120, 132, 160]
- Custom width input with validation (20-500)

### Mobile Input
- Full-screen UITextView for text input
- Send options: text only, text + enter
- Keyboard shortcuts for quick send

### File Path Handling
- Escape paths with spaces using quotes
- Support both absolute and relative paths
- Integration with terminal input system

### Performance
- Debounce resize operations
- Cache terminal dimensions
- Optimize control button layout for different screen sizes

## UI/UX Guidelines

### Visual Consistency
- Match web frontend's visual style where appropriate
- Use native iOS patterns for better platform integration
- Maintain terminal aesthetic with modern touches

### Accessibility
- VoiceOver support for all controls
- Dynamic Type support
- High contrast mode compatibility

### Responsive Design
- Adapt control layout for different device sizes
- Handle keyboard appearance/disappearance smoothly
- Support both portrait and landscape orientations

## Success Metrics

- [ ] All high-priority features implemented
- [ ] Feature parity with web frontend
- [ ] Native iOS advantages utilized
- [ ] Performance on par or better than web
- [ ] User feedback incorporated
- [ ] Comprehensive testing completed