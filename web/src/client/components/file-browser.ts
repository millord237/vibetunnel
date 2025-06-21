import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from './session-list.js';

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions?: string;
  isGitTracked?: boolean;
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged';
}

interface DirectoryListing {
  path: string;
  fullPath: string;
  gitStatus: GitStatus | null;
  files: FileInfo[];
}

interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

interface FilePreview {
  type: 'image' | 'text' | 'binary';
  content?: string;
  language?: string;
  url?: string;
  mimeType?: string;
  size: number;
  humanSize?: string;
}

interface FileDiff {
  path: string;
  diff: string;
  hasDiff: boolean;
}

@customElement('file-browser')
export class FileBrowser extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: String }) mode: 'browse' | 'select' = 'browse';
  @property({ type: Object }) session: Session | null = null;

  @state() private currentPath = '';
  @state() private files: FileInfo[] = [];
  @state() private loading = false;
  @state() private selectedFile: FileInfo | null = null;
  @state() private preview: FilePreview | null = null;
  @state() private diff: FileDiff | null = null;
  @state() private gitFilter: 'all' | 'changed' = 'all';
  @state() private showHidden = false;
  @state() private gitStatus: GitStatus | null = null;
  @state() private previewLoading = false;
  @state() private showDiff = false;

  private monacoEditor: any = null;
  private monacoContainer: HTMLElement | null = null;

  async connectedCallback() {
    super.connectedCallback();
    if (this.visible && this.session) {
      this.currentPath = this.session.workingDir || '.';
      await this.loadDirectory(this.currentPath);
    }
    document.addEventListener('keydown', this.handleKeyDown);
  }

  async updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    if (changedProperties.has('visible') || changedProperties.has('session')) {
      if (this.visible && this.session) {
        this.currentPath = this.session.workingDir || '.';
        await this.loadDirectory(this.currentPath);
      }
    }

    if (this.preview?.type === 'text' && this.monacoContainer && !this.monacoEditor) {
      this.initMonacoEditor();
    }
  }

  private async loadDirectory(dirPath: string) {
    this.loading = true;
    try {
      const params = new URLSearchParams({
        path: dirPath,
        showHidden: this.showHidden.toString(),
        gitFilter: this.gitFilter,
      });

      const url = `/api/fs/browse?${params}`;
      console.log(`[FileBrowser] Loading directory: ${dirPath}`);
      console.log(`[FileBrowser] Fetching URL: ${url}`);
      const response = await fetch(url);
      console.log(`[FileBrowser] Response status: ${response.status}`);

      if (response.ok) {
        const data: DirectoryListing = await response.json();
        console.log(`[FileBrowser] Received ${data.files?.length || 0} files`);
        this.currentPath = data.path;
        this.files = data.files || [];
        this.gitStatus = data.gitStatus;
      } else {
        const errorData = await response.text();
        console.error(`[FileBrowser] Failed to load directory: ${response.status}`, errorData);
      }
    } catch (error) {
      console.error('[FileBrowser] Error loading directory:', error);
    } finally {
      this.loading = false;
    }
  }

  private async loadPreview(file: FileInfo) {
    if (file.type === 'directory') return;

    this.previewLoading = true;
    this.selectedFile = file;
    this.showDiff = false;

    try {
      console.log('[FileBrowser] Loading preview for file:', file);
      console.log('[FileBrowser] File path:', file.path);

      const response = await fetch(`/api/fs/preview?path=${encodeURIComponent(file.path)}`);
      if (response.ok) {
        this.preview = await response.json();
        if (this.preview?.type === 'text') {
          // Update Monaco editor if it exists
          this.updateMonacoContent();
        }
      } else {
        console.error('[FileBrowser] Preview failed:', response.status, await response.text());
      }
    } catch (error) {
      console.error('Error loading preview:', error);
    } finally {
      this.previewLoading = false;
    }
  }

  private async loadDiff(file: FileInfo) {
    if (file.type === 'directory' || !file.gitStatus || file.gitStatus === 'unchanged') return;

    this.previewLoading = true;
    this.showDiff = true;

    try {
      const response = await fetch(`/api/fs/diff?path=${encodeURIComponent(file.path)}`);
      if (response.ok) {
        this.diff = await response.json();
      }
    } catch (error) {
      console.error('Error loading diff:', error);
    } finally {
      this.previewLoading = false;
    }
  }

  private initMonacoEditor() {
    if (!window.monaco || !this.monacoContainer) return;

    this.monacoEditor = window.monaco.editor.create(this.monacoContainer, {
      value: this.preview?.content || '',
      language: this.preview?.language || 'plaintext',
      theme: 'vs-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
  }

  private updateMonacoContent() {
    if (!this.monacoEditor || !this.preview) return;

    this.monacoEditor.setValue(this.preview.content || '');
    window.monaco.editor.setModelLanguage(
      this.monacoEditor.getModel(),
      this.preview.language || 'plaintext'
    );
  }

  private handleFileClick(file: FileInfo) {
    if (file.type === 'directory') {
      this.loadDirectory(file.path);
    } else {
      this.loadPreview(file);
    }
  }

  private async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      console.log('[FileBrowser] Copied to clipboard:', text);
    } catch (err) {
      console.error('[FileBrowser] Failed to copy to clipboard:', err);
    }
  }

  private insertPathIntoTerminal() {
    if (!this.selectedFile) return;

    // Dispatch event with the file path
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: {
          path: this.selectedFile.path,
          type: this.selectedFile.type,
        },
        bubbles: true,
        composed: true,
      })
    );

    // Close the file browser
    this.dispatchEvent(new CustomEvent('browser-cancel'));
  }

  private openInEditor() {
    if (!this.selectedFile || this.selectedFile.type !== 'file') return;

    // Dispatch event to open file in editor
    this.dispatchEvent(
      new CustomEvent('open-in-editor', {
        detail: {
          path: this.selectedFile.path,
        },
        bubbles: true,
        composed: true,
      })
    );

    // Close the file browser
    this.dispatchEvent(new CustomEvent('browser-cancel'));
  }

  private handleParentClick() {
    const parentPath = this.currentPath.split('/').slice(0, -1).join('/') || '.';
    this.loadDirectory(parentPath);
  }

  private toggleGitFilter() {
    this.gitFilter = this.gitFilter === 'all' ? 'changed' : 'all';
    this.loadDirectory(this.currentPath);
  }

  private toggleHidden() {
    this.showHidden = !this.showHidden;
    this.loadDirectory(this.currentPath);
  }

  private toggleDiff() {
    if (
      this.selectedFile &&
      this.selectedFile.gitStatus &&
      this.selectedFile.gitStatus !== 'unchanged'
    ) {
      if (this.showDiff) {
        this.loadPreview(this.selectedFile);
      } else {
        this.loadDiff(this.selectedFile);
      }
    }
  }

  private handleSelect() {
    if (this.mode === 'select' && this.currentPath) {
      this.dispatchEvent(
        new CustomEvent('directory-selected', {
          detail: this.currentPath,
        })
      );
    }
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('browser-cancel'));
  }

  private handleOverlayClick(e: Event) {
    if (e.target === e.currentTarget) {
      this.handleCancel();
    }
  }

  private renderFileIcon(file: FileInfo) {
    if (file.type === 'directory') {
      return '📁';
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      js: '📜',
      ts: '📘',
      jsx: '⚛️',
      tsx: '⚛️',
      json: '📋',
      md: '📝',
      txt: '📄',
      html: '🌐',
      css: '🎨',
      scss: '🎨',
      png: '🖼️',
      jpg: '🖼️',
      jpeg: '🖼️',
      gif: '🖼️',
      svg: '🖼️',
      pdf: '📑',
      zip: '📦',
      tar: '📦',
      gz: '📦',
    };

    return iconMap[ext || ''] || '📄';
  }

  private renderGitStatus(status?: FileInfo['gitStatus']) {
    if (!status || status === 'unchanged') return '';

    const labels: Record<string, string> = {
      modified: 'M',
      added: 'A',
      deleted: 'D',
      untracked: '?',
    };

    const colorClasses: Record<string, string> = {
      modified: 'bg-yellow-900/50 text-yellow-400',
      added: 'bg-green-900/50 text-green-400',
      deleted: 'bg-red-900/50 text-red-400',
      untracked: 'bg-gray-700 text-gray-400',
    };

    return html`
      <span class="text-xs px-1.5 py-0.5 rounded font-bold ${colorClasses[status]}">
        ${labels[status]}
      </span>
    `;
  }

  private renderPreview() {
    if (this.previewLoading) {
      return html`
        <div class="flex items-center justify-center h-full text-dark-text-muted">
          Loading preview...
        </div>
      `;
    }

    if (this.showDiff && this.diff) {
      return this.renderDiff();
    }

    if (!this.preview) {
      return html`
        <div class="flex flex-col items-center justify-center h-full text-dark-text-muted">
          <div class="text-4xl mb-4">📄</div>
          <div>Select a file to preview</div>
        </div>
      `;
    }

    switch (this.preview.type) {
      case 'image':
        return html`
          <div class="flex items-center justify-center p-4 h-full">
            <img
              src="${this.preview.url}"
              alt="${this.selectedFile?.name}"
              class="max-w-full max-h-full object-contain rounded"
            />
          </div>
        `;

      case 'text':
        return html`
          <div
            class="monaco-container h-full"
            @connected=${(e: Event) => {
              this.monacoContainer = e.target as HTMLElement;
              this.initMonacoEditor();
            }}
          ></div>
        `;

      case 'binary':
        return html`
          <div class="flex flex-col items-center justify-center h-full text-dark-text-muted">
            <div class="text-4xl mb-4">📦</div>
            <div class="text-lg mb-2">Binary File</div>
            <div class="text-sm">${this.preview.humanSize || this.preview.size + ' bytes'}</div>
            <div class="text-sm text-dark-text-muted mt-2">
              ${this.preview.mimeType || 'Unknown type'}
            </div>
          </div>
        `;
    }
  }

  private renderDiff() {
    if (!this.diff || !this.diff.diff) {
      return html`
        <div class="flex items-center justify-center h-full text-dark-text-muted">
          No changes in this file
        </div>
      `;
    }

    const lines = this.diff.diff.split('\n');
    return html`
      <div class="overflow-auto h-full p-4 font-mono text-xs">
        ${lines.map((line) => {
          let className = 'text-dark-text-muted';
          if (line.startsWith('+')) className = 'text-status-success bg-green-900/20';
          else if (line.startsWith('-')) className = 'text-status-error bg-red-900/20';
          else if (line.startsWith('@@')) className = 'text-accent-blue font-semibold';

          return html`<div class="whitespace-pre ${className}">${line}</div>`;
        })}
      </div>
    `;
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 bg-dark-bg/80 backdrop-blur z-50 flex items-center justify-center"
        @click=${this.handleOverlayClick}
      >
        <div
          class="w-11/12 h-5/6 max-w-7xl bg-dark-bg-secondary rounded-lg shadow-2xl flex flex-col overflow-hidden"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <!-- Header -->
          <div class="bg-dark-bg border-b border-dark-border p-4 flex items-center justify-between">
            <div class="flex items-center gap-4">
              <h2 class="text-lg font-semibold text-dark-text flex items-center gap-2">
                <span>📂</span>
                File Browser
              </h2>
              ${this.session
                ? html`
                    <span class="text-sm text-dark-text-muted font-mono">
                      Session: ${this.session.name || this.session.id}
                    </span>
                  `
                : ''}
            </div>
            <button
              @click=${this.handleCancel}
              class="text-dark-text-muted hover:text-dark-text transition-colors"
              title="Close (Esc)"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                ></path>
              </svg>
            </button>
          </div>

          <!-- Toolbar -->
          <div class="bg-dark-bg border-b border-dark-border p-3 flex items-center justify-between">
            <div class="flex gap-2">
              <button
                class="btn-secondary text-xs px-3 py-1 ${this.gitFilter === 'changed'
                  ? 'bg-accent-green text-dark-bg'
                  : ''}"
                @click=${this.toggleGitFilter}
                title="Show only Git changes"
              >
                Git Changes
              </button>
              <button
                class="btn-secondary text-xs px-3 py-1 ${this.showHidden
                  ? 'bg-accent-green text-dark-bg'
                  : ''}"
                @click=${this.toggleHidden}
                title="Show hidden files"
              >
                Hidden Files
              </button>
            </div>
            <div class="flex items-center gap-4">
              ${this.gitStatus
                ? html`
                    <span class="text-xs text-dark-text-muted"> 📍 ${this.gitStatus.branch} </span>
                  `
                : ''}
              <span class="text-xs text-dark-text-muted font-mono"> ${this.currentPath} </span>
            </div>
          </div>

          <!-- Main content -->
          <div class="flex-1 flex overflow-hidden">
            <!-- File list -->
            <div
              class="w-1/3 min-w-[300px] bg-dark-bg-secondary border-r border-dark-border overflow-y-auto"
            >
              ${this.loading
                ? html`
                    <div class="flex items-center justify-center h-full text-dark-text-muted">
                      Loading...
                    </div>
                  `
                : html`
                    ${this.currentPath !== '.' && this.currentPath !== '/'
                      ? html`
                          <div
                            class="p-3 hover:bg-dark-bg-lighter cursor-pointer transition-colors flex items-center gap-2 border-b border-dark-border"
                            @click=${this.handleParentClick}
                          >
                            <span>⬆️</span>
                            <span class="text-dark-text-muted">..</span>
                          </div>
                        `
                      : ''}
                    ${this.files.map(
                      (file) => html`
                        <div
                          class="p-3 hover:bg-dark-bg-lighter cursor-pointer transition-colors flex items-center gap-2 
                            ${this.selectedFile?.path === file.path
                            ? 'bg-dark-bg-lighter border-l-2 border-accent-green'
                            : ''}"
                          @click=${() => this.handleFileClick(file)}
                        >
                          <span class="flex-shrink-0">${this.renderFileIcon(file)}</span>
                          <span
                            class="flex-1 truncate text-sm ${file.type === 'directory'
                              ? 'text-accent-blue'
                              : 'text-dark-text'}"
                            >${file.name}</span
                          >
                          ${this.renderGitStatus(file.gitStatus)}
                        </div>
                      `
                    )}
                  `}
            </div>

            <!-- Preview pane -->
            <div class="flex-1 bg-dark-bg flex flex-col overflow-hidden">
              ${this.selectedFile
                ? html`
                    <div
                      class="bg-dark-bg-secondary border-b border-dark-border p-3 flex items-center justify-between"
                    >
                      <div class="flex items-center gap-2">
                        <span>${this.renderFileIcon(this.selectedFile)}</span>
                        <span class="font-mono text-sm">${this.selectedFile.name}</span>
                        ${this.renderGitStatus(this.selectedFile.gitStatus)}
                      </div>
                      <div class="flex gap-2">
                        ${this.selectedFile.type === 'file'
                          ? html`
                              <button
                                class="btn-secondary text-xs px-3 py-1"
                                @click=${this.openInEditor}
                                title="Open in default editor"
                              >
                                Open in Editor
                              </button>
                              <button
                                class="btn-secondary text-xs px-3 py-1"
                                @click=${() =>
                                  this.selectedFile && this.copyToClipboard(this.selectedFile.path)}
                                title="Copy path to clipboard (⌘C)"
                              >
                                Copy Path
                              </button>
                              <button
                                class="btn-primary text-xs px-3 py-1"
                                @click=${this.insertPathIntoTerminal}
                                title="Insert path into terminal (Enter)"
                              >
                                Insert Path
                              </button>
                            `
                          : ''}
                        ${this.selectedFile.gitStatus && this.selectedFile.gitStatus !== 'unchanged'
                          ? html`
                              <button
                                class="btn-secondary text-xs px-3 py-1 ${this.showDiff
                                  ? 'bg-accent-green text-dark-bg'
                                  : ''}"
                                @click=${this.toggleDiff}
                              >
                                ${this.showDiff ? 'View File' : 'View Diff'}
                              </button>
                            `
                          : ''}
                      </div>
                    </div>
                  `
                : ''}
              <div class="flex-1 overflow-hidden">${this.renderPreview()}</div>
            </div>
          </div>

          ${this.mode === 'select'
            ? html`
                <div class="p-4 border-t border-dark-border flex gap-4">
                  <button class="btn-ghost font-mono flex-1" @click=${this.handleCancel}>
                    Cancel
                  </button>
                  <button class="btn-primary font-mono flex-1" @click=${this.handleSelect}>
                    Select Directory
                  </button>
                </div>
              `
            : ''}
        </div>
      </div>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.monacoEditor) {
      this.monacoEditor.dispose();
      this.monacoEditor = null;
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.visible) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.handleCancel();
    } else if (e.key === 'Enter' && this.selectedFile && this.selectedFile.type === 'file') {
      e.preventDefault();
      this.insertPathIntoTerminal();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c' && this.selectedFile) {
      e.preventDefault();
      this.copyToClipboard(this.selectedFile.path);
    }
  };
}
