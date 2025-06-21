#!/bin/bash

# Run iOS tests for VibeTunnel
# This script handles the fact that tests are written for Swift Testing
# but the app uses an Xcode project

set -e

echo "Setting up test environment..."

# Create a temporary test project that includes our app code
TEMP_DIR=$(mktemp -d)
echo "Working in: $TEMP_DIR"

# Copy Package.swift to temp directory
cp Package.swift "$TEMP_DIR/"

# Create symbolic links to source code
ln -s "$(pwd)/VibeTunnel" "$TEMP_DIR/Sources"
ln -s "$(pwd)/VibeTunnelTests" "$TEMP_DIR/Tests"

# Update Package.swift to include app source as a target
cat > "$TEMP_DIR/Package.swift" << 'EOF'
// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "VibeTunnelTestRunner",
    platforms: [
        .iOS(.v18),
        .macOS(.v14)
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.2.0")
    ],
    targets: [
        .target(
            name: "VibeTunnel",
            dependencies: [
                .product(name: "SwiftTerm", package: "SwiftTerm")
            ],
            path: "Sources"
        ),
        .testTarget(
            name: "VibeTunnelTests",
            dependencies: ["VibeTunnel"],
            path: "Tests"
        )
    ]
)
EOF

echo "Running tests..."
cd "$TEMP_DIR"
swift test

# Clean up
cd - > /dev/null
rm -rf "$TEMP_DIR"

echo "Tests completed!"