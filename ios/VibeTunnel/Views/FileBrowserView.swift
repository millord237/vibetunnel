import Observation
import QuickLook
import SwiftUI

/// File browser for navigating the server's file system.
///
/// Provides a hierarchical view of directories and files with
/// navigation, selection, and directory creation capabilities.
struct FileBrowserView: View {
    @State private var viewModel = FileBrowserViewModel()
    @Environment(\.dismiss)
    private var dismiss
    @State private var showingFileEditor = false
    @State private var showingNewFileAlert = false
    @State private var newFileName = ""
    @State private var selectedFile: FileEntry?
    @State private var showingDeleteAlert = false
    @StateObject private var quickLookManager = QuickLookManager.shared
    @State private var showingQuickLook = false

    let onSelect: (String) -> Void
    let initialPath: String
    let mode: FileBrowserMode

    enum FileBrowserMode {
        case selectDirectory
        case browseFiles
    }

    init(initialPath: String = "~", mode: FileBrowserMode = .selectDirectory, onSelect: @escaping (String) -> Void) {
        self.initialPath = initialPath
        self.mode = mode
        self.onSelect = onSelect
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Color.black.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Navigation header
                    HStack(spacing: 16) {
                        // Back button
                        if viewModel.canGoUp {
                            Button {
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                viewModel.navigateToParent()
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "chevron.left")
                                        .font(.system(size: 14, weight: .semibold))
                                    Text("Back")
                                        .font(.custom("SF Mono", size: 14))
                                }
                                .foregroundColor(Theme.Colors.terminalAccent)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(Theme.Colors.terminalAccent.opacity(0.1))
                                )
                            }
                            .buttonStyle(TerminalButtonStyle())
                        }

                        // Current path display
                        HStack(spacing: 8) {
                            Image(systemName: "folder.fill")
                                .foregroundColor(Theme.Colors.terminalAccent)
                                .font(.system(size: 16))

                            Text(viewModel.displayPath)
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalGray)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            
                            // Git branch indicator
                            if let gitStatus = viewModel.gitStatus, gitStatus.isGitRepo, let branch = gitStatus.branch {
                                Text("📍 \(branch)")
                                    .font(.custom("SF Mono", size: 12))
                                    .foregroundColor(Theme.Colors.terminalGray.opacity(0.8))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(Theme.Colors.terminalDarkGray)
                    
                    // Filter toolbar
                    HStack(spacing: 12) {
                        // Git filter toggle
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            viewModel.gitFilter = viewModel.gitFilter == .all ? .changed : .all
                            viewModel.loadDirectory(path: viewModel.currentPath)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.branch")
                                    .font(.system(size: 12))
                                Text(viewModel.gitFilter == .changed ? "Git Changes" : "All Files")
                                    .font(.custom("SF Mono", size: 12))
                            }
                            .foregroundColor(viewModel.gitFilter == .changed ? Theme.Colors.terminalGreen : Theme.Colors.terminalGray)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(viewModel.gitFilter == .changed ? Theme.Colors.terminalGreen.opacity(0.2) : Theme.Colors.terminalGray.opacity(0.1))
                            )
                        }
                        .buttonStyle(TerminalButtonStyle())
                        
                        // Hidden files toggle
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            viewModel.showHidden.toggle()
                            viewModel.loadDirectory(path: viewModel.currentPath)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: viewModel.showHidden ? "eye" : "eye.slash")
                                    .font(.system(size: 12))
                                Text("Hidden")
                                    .font(.custom("SF Mono", size: 12))
                            }
                            .foregroundColor(viewModel.showHidden ? Theme.Colors.terminalAccent : Theme.Colors.terminalGray)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(viewModel.showHidden ? Theme.Colors.terminalAccent.opacity(0.2) : Theme.Colors.terminalGray.opacity(0.1))
                            )
                        }
                        .buttonStyle(TerminalButtonStyle())
                        
                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Theme.Colors.terminalDarkGray.opacity(0.5))

                    // File list
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            // Directories first, then files
                            ForEach(viewModel.sortedEntries) { entry in
                                FileBrowserRow(
                                    name: entry.name,
                                    isDirectory: entry.isDir,
                                    size: entry.isDir ? nil : entry.formattedSize,
                                    modifiedTime: entry.formattedDate,
                                    gitStatus: entry.gitStatus
                                ) {
                                    if entry.isDir {
                                        viewModel.navigate(to: entry.path)
                                    } else if mode == .browseFiles {
                                        // Preview file with Quick Look
                                        selectedFile = entry
                                        Task {
                                            await viewModel.previewFile(entry)
                                        }
                                    }
                                }
                                .transition(.opacity)
                                // Context menu disabled - file operations not implemented in backend
                                // .contextMenu {
                                //    if mode == .browseFiles && !entry.isDir {
                                //        Button(action: {
                                //            selectedFile = entry
                                //            showingFileEditor = true
                                //        }) {
                                //            Label("Edit", systemImage: "pencil")
                                //        }
                                //
                                //        Button(role: .destructive, action: {
                                //            selectedFile = entry
                                //            showingDeleteAlert = true
                                //        }) {
                                //            Label("Delete", systemImage: "trash")
                                //        }
                                //    }
                                // }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .overlay(alignment: .center) {
                        if viewModel.isLoading {
                            VStack(spacing: 16) {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                    .scaleEffect(1.2)

                                Text("Loading...")
                                    .font(.custom("SF Mono", size: 14))
                                    .foregroundColor(Theme.Colors.terminalGray)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color.black.opacity(0.8))
                        }
                    }

                    // Bottom toolbar
                    HStack(spacing: 20) {
                        // Cancel button
                        Button(action: { dismiss() }, label: {
                            Text("cancel")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalGray)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Theme.Colors.terminalGray.opacity(0.3), lineWidth: 1)
                                )
                                .contentShape(Rectangle())
                        })
                        .buttonStyle(TerminalButtonStyle())

                        Spacer()

                        // Create folder button
                        Button(action: { viewModel.showCreateFolder = true }, label: {
                            Label("new folder", systemImage: "folder.badge.plus")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalAccent)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Theme.Colors.terminalAccent.opacity(0.5), lineWidth: 1)
                                )
                                .contentShape(Rectangle())
                        })
                        .buttonStyle(TerminalButtonStyle())

                        // Create file button (disabled - not implemented in backend)
                        // Uncomment when file operations are implemented
                        // if mode == .browseFiles {
                        //    Button(action: { showingNewFileAlert = true }, label: {
                        //        Label("new file", systemImage: "doc.badge.plus")
                        //            .font(.custom("SF Mono", size: 14))
                        //            .foregroundColor(Theme.Colors.terminalAccent)
                        //            .padding(.horizontal, 16)
                        //            .padding(.vertical, 10)
                        //            .background(
                        //                RoundedRectangle(cornerRadius: 8)
                        //                    .stroke(Theme.Colors.terminalAccent.opacity(0.5), lineWidth: 1)
                        //            )
                        //            .contentShape(Rectangle())
                        //    })
                        //    .buttonStyle(TerminalButtonStyle())
                        // }

                        // Select button (only in selectDirectory mode)
                        if mode == .selectDirectory {
                            Button(action: {
                                onSelect(viewModel.currentPath)
                                dismiss()
                            }, label: {
                                Text("select")
                                    .font(.custom("SF Mono", size: 14))
                                    .foregroundColor(.black)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Theme.Colors.terminalAccent)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Theme.Colors.terminalAccent.opacity(0.3))
                                            .blur(radius: 10)
                                    )
                                    .contentShape(Rectangle())
                            })
                            .buttonStyle(TerminalButtonStyle())
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(Theme.Colors.terminalDarkGray)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .alert("Create Folder", isPresented: $viewModel.showCreateFolder) {
                TextField("Folder name", text: $viewModel.newFolderName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button("Cancel", role: .cancel) {
                    viewModel.newFolderName = ""
                }

                Button("Create") {
                    viewModel.createFolder()
                }
                .disabled(viewModel.newFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Enter a name for the new folder")
            }
            .alert("Error", isPresented: $viewModel.showError, presenting: viewModel.errorMessage) { _ in
                Button("OK") {}
            } message: { error in
                Text(error)
            }
            .alert("Create File", isPresented: $showingNewFileAlert) {
                TextField("File name", text: $newFileName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button("Cancel", role: .cancel) {
                    newFileName = ""
                }

                Button("Create") {
                    let path = viewModel.currentPath + "/" + newFileName
                    selectedFile = FileEntry(
                        name: newFileName,
                        path: path,
                        isDir: false,
                        size: 0,
                        mode: "0644",
                        modTime: Date()
                    )
                    showingFileEditor = true
                    newFileName = ""
                }
                .disabled(newFileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Enter a name for the new file")
            }
            .alert("Delete File", isPresented: $showingDeleteAlert, presenting: selectedFile) { file in
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task {
                        await viewModel.deleteFile(path: file.path)
                    }
                }
            } message: { file in
                Text("Are you sure you want to delete '\(file.name)'? This action cannot be undone.")
            }
            .sheet(isPresented: $showingFileEditor) {
                if let file = selectedFile {
                    FileEditorView(
                        path: file.path,
                        isNewFile: !viewModel.entries.contains { $0.path == file.path }
                    )
                    .onDisappear {
                        // Reload directory to show any new files
                        viewModel.loadDirectory(path: viewModel.currentPath)
                    }
                }
            }
            .fullScreenCover(isPresented: $quickLookManager.isPresenting) {
                QuickLookWrapper(quickLookManager: quickLookManager)
                    .ignoresSafeArea()
            }
            .overlay {
                if quickLookManager.isDownloading {
                    ZStack {
                        Color.black.opacity(0.8)
                            .ignoresSafeArea()

                        VStack(spacing: 20) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                .scaleEffect(1.5)

                            Text("Downloading file...")
                                .font(.custom("SF Mono", size: 16))
                                .foregroundColor(Theme.Colors.terminalWhite)

                            if quickLookManager.downloadProgress > 0 {
                                ProgressView(value: quickLookManager.downloadProgress)
                                    .progressViewStyle(LinearProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                    .frame(width: 200)
                            }
                        }
                        .padding(40)
                        .background(Theme.Colors.terminalDarkGray)
                        .cornerRadius(12)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            viewModel.loadDirectory(path: initialPath)
        }
    }
}

/// Row component for displaying file or directory information.
///
/// Shows file/directory icon, name, size, and modification time
/// with appropriate styling for directories and parent navigation.
struct FileBrowserRow: View {
    let name: String
    let isDirectory: Bool
    let isParent: Bool
    let size: String?
    let modifiedTime: String?
    let gitStatus: GitFileStatus?
    let onTap: () -> Void

    init(
        name: String,
        isDirectory: Bool,
        isParent: Bool = false,
        size: String? = nil,
        modifiedTime: String? = nil,
        gitStatus: GitFileStatus? = nil,
        onTap: @escaping () -> Void
    ) {
        self.name = name
        self.isDirectory = isDirectory
        self.isParent = isParent
        self.size = size
        self.modifiedTime = modifiedTime
        self.gitStatus = gitStatus
        self.onTap = onTap
    }

    var iconName: String {
        if isDirectory {
            return "folder.fill"
        }
        
        // Get file extension
        let ext = name.split(separator: ".").last?.lowercased() ?? ""
        
        switch ext {
        case "js", "jsx", "ts", "tsx", "mjs", "cjs":
            return "doc.text.fill"
        case "json", "yaml", "yml", "toml":
            return "doc.text.fill"
        case "md", "markdown", "txt", "log":
            return "doc.plaintext.fill"
        case "html", "htm", "xml":
            return "globe"
        case "css", "scss", "sass", "less":
            return "paintbrush.fill"
        case "png", "jpg", "jpeg", "gif", "svg", "ico", "webp":
            return "photo.fill"
        case "pdf":
            return "doc.richtext.fill"
        case "zip", "tar", "gz", "bz2", "xz", "7z", "rar":
            return "archivebox.fill"
        case "mp4", "mov", "avi", "mkv", "webm":
            return "play.rectangle.fill"
        case "mp3", "wav", "flac", "aac", "ogg":
            return "music.note"
        case "sh", "bash", "zsh", "fish":
            return "terminal.fill"
        case "py", "pyc", "pyo":
            return "doc.text.fill"
        case "swift":
            return "swift"
        case "c", "cpp", "cc", "h", "hpp":
            return "chevron.left.forwardslash.chevron.right"
        case "go":
            return "doc.text.fill"
        case "rs":
            return "doc.text.fill"
        case "java", "class", "jar":
            return "cup.and.saucer.fill"
        default:
            return "doc.fill"
        }
    }
    
    var iconColor: Color {
        if isDirectory {
            return Theme.Colors.terminalAccent
        }
        
        let ext = name.split(separator: ".").last?.lowercased() ?? ""
        
        switch ext {
        case "js", "jsx", "mjs", "cjs":
            return .yellow
        case "ts", "tsx":
            return Color(red: 0.0, green: 0.48, blue: 0.78) // TypeScript blue
        case "json":
            return .orange
        case "html", "htm":
            return .orange
        case "css", "scss", "sass", "less":
            return Color(red: 0.21, green: 0.46, blue: 0.74) // CSS blue
        case "md", "markdown":
            return .gray
        case "png", "jpg", "jpeg", "gif", "svg", "ico", "webp":
            return .green
        case "swift":
            return .orange
        case "py":
            return Color(red: 0.22, green: 0.49, blue: 0.72) // Python blue
        case "go":
            return Color(red: 0.0, green: 0.68, blue: 0.85) // Go cyan
        case "rs":
            return .orange
        case "sh", "bash", "zsh", "fish":
            return .green
        default:
            return Theme.Colors.terminalGray.opacity(0.6)
        }
    }
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Icon
                Image(systemName: iconName)
                    .foregroundColor(iconColor)
                    .font(.system(size: 16))
                    .frame(width: 24)

                // Name
                Text(name)
                    .font(.custom("SF Mono", size: 14))
                    .foregroundColor(isParent ? Theme.Colors
                        .terminalAccent : (isDirectory ? Theme.Colors.terminalWhite : Theme.Colors.terminalGray)
                    )
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                // Git status indicator
                if let gitStatus = gitStatus, gitStatus != .unchanged {
                    GitStatusBadge(status: gitStatus)
                        .padding(.trailing, 8)
                }

                // Details
                if !isParent {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let size {
                            Text(size)
                                .font(.custom("SF Mono", size: 11))
                                .foregroundColor(Theme.Colors.terminalGray.opacity(0.6))
                        }

                        if let modifiedTime {
                            Text(modifiedTime)
                                .font(.custom("SF Mono", size: 11))
                                .foregroundColor(Theme.Colors.terminalGray.opacity(0.5))
                        }
                    }
                }

                // Chevron for directories
                if isDirectory && !isParent {
                    Image(systemName: "chevron.right")
                        .foregroundColor(Theme.Colors.terminalGray.opacity(0.4))
                        .font(.system(size: 12, weight: .medium))
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainButtonStyle())
        .background(
            Theme.Colors.terminalGray.opacity(0.05)
                .opacity(isDirectory ? 1 : 0)
        )
        .contextMenu {
            if !isParent {
                Button {
                    UIPasteboard.general.string = name
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("Copy Name", systemImage: "doc.on.doc")
                }
                
                Button {
                    UIPasteboard.general.string = isDirectory ? "\(name)/" : name
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("Copy Path", systemImage: "doc.on.doc.fill")
                }
            }
        }
    }
}

/// Button style with terminal-themed press effects.
///
/// Provides subtle scale and opacity animations on press
/// for a responsive terminal-like interaction feel.
struct TerminalButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// View model for file browser navigation and operations.
@MainActor
@Observable
class FileBrowserViewModel {
    var currentPath = "~"
    var entries: [FileEntry] = []
    var isLoading = false
    var showCreateFolder = false
    var newFolderName = ""
    var showError = false
    var errorMessage: String?
    var gitStatus: GitStatus?
    var showHidden = false
    var gitFilter: GitFilterOption = .all
    
    enum GitFilterOption: String {
        case all = "all"
        case changed = "changed"
    }

    private let apiClient = APIClient.shared

    var sortedEntries: [FileEntry] {
        entries.sorted { entry1, entry2 in
            // Directories come first
            if entry1.isDir != entry2.isDir {
                return entry1.isDir
            }
            // Then sort by name
            return entry1.name.localizedCaseInsensitiveCompare(entry2.name) == .orderedAscending
        }
    }

    var canGoUp: Bool {
        currentPath != "/" && currentPath != "~"
    }

    var displayPath: String {
        // Show a more user-friendly path
        if currentPath == "/" {
            return "/"
        } else if currentPath.hasPrefix("/Users/") {
            // Extract username from path like /Users/username/...
            let components = currentPath.components(separatedBy: "/")
            if components.count > 2 {
                let username = components[2]
                let homePath = "/Users/\(username)"
                if currentPath == homePath || currentPath.hasPrefix(homePath + "/") {
                    return currentPath.replacingOccurrences(of: homePath, with: "~")
                }
            }
        }
        return currentPath
    }

    func loadDirectory(path: String) {
        Task {
            await loadDirectoryAsync(path: path)
        }
    }

    @MainActor
    private func loadDirectoryAsync(path: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await apiClient.browseDirectory(
                path: path, 
                showHidden: showHidden, 
                gitFilter: gitFilter.rawValue
            )
            // Use the absolute path returned by the server
            currentPath = result.absolutePath
            gitStatus = result.gitStatus
            withAnimation(.easeInOut(duration: 0.2)) {
                entries = result.files
            }
        } catch {
            // Failed to load directory: \(error)
            errorMessage = "Failed to load directory: \(error.localizedDescription)"
            showError = true
        }
    }

    func navigate(to path: String) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        loadDirectory(path: path)
    }

    func navigateToParent() {
        let parentPath = URL(fileURLWithPath: currentPath).deletingLastPathComponent().path
        navigate(to: parentPath)
    }

    func createFolder() {
        let folderName = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !folderName.isEmpty else { return }

        Task {
            await createFolderAsync(name: folderName)
        }
    }

    @MainActor
    private func createFolderAsync(name: String) async {
        do {
            let fullPath = currentPath + "/" + name
            try await apiClient.createDirectory(path: fullPath)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            newFolderName = ""
            // Reload directory to show new folder
            await loadDirectoryAsync(path: currentPath)
        } catch {
            // Failed to create folder: \(error)
            errorMessage = "Failed to create folder: \(error.localizedDescription)"
            showError = true
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    func deleteFile(path: String) async {
        // File deletion is not yet implemented in the backend
        errorMessage = "File deletion is not available in the current server version"
        showError = true
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    func previewFile(_ file: FileEntry) async {
        do {
            try await QuickLookManager.shared.previewFile(file, apiClient: apiClient)
        } catch {
            await MainActor.run {
                errorMessage = "Failed to preview file: \(error.localizedDescription)"
                showError = true
            }
        }
    }
}

/// Git status badge component for displaying file status
struct GitStatusBadge: View {
    let status: GitFileStatus
    
    var label: String {
        switch status {
        case .modified: return "M"
        case .added: return "A"
        case .deleted: return "D"
        case .untracked: return "?"
        case .unchanged: return ""
        }
    }
    
    var color: Color {
        switch status {
        case .modified: return .yellow
        case .added: return .green
        case .deleted: return .red
        case .untracked: return .gray
        case .unchanged: return .clear
        }
    }
    
    var body: some View {
        if status != .unchanged {
            Text(label)
                .font(.custom("SF Mono", size: 10))
                .fontWeight(.bold)
                .foregroundColor(color)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(color.opacity(0.2))
                .cornerRadius(4)
        }
    }
}

#Preview {
    FileBrowserView { _ in
        // Selected path
    }
}
