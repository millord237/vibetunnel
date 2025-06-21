// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "VibeTunnelDependencies",
    platforms: [
        .iOS(.v18),
        .macOS(.v10_15)
    ],
    products: [
        .library(
            name: "VibeTunnelDependencies",
            targets: ["VibeTunnelDependencies"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", from: "1.2.0")
    ],
    targets: [
        .target(
            name: "VibeTunnelDependencies",
            dependencies: [
                .product(name: "SwiftTerm", package: "SwiftTerm")
            ]
        ),
        .testTarget(
            name: "VibeTunnelTests",
            dependencies: [],
            path: "VibeTunnelTests",
            sources: [
                "StandaloneTests.swift",
                "Utilities/TestTags.swift",
                "APIErrorTests.swift",
                "WebSocketReconnectionTests.swift",
                "AuthenticationTests.swift",
                "FileSystemTests.swift",
                "TerminalParsingTests.swift",
                "EdgeCaseTests.swift",
                "PerformanceTests.swift"
            ]
        )
    ]
)
