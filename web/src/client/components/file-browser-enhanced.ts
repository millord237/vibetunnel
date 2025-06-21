import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

@customElement('file-browser-enhanced')
export class FileBrowserEnhanced extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
    }

    .modal-container {
      width: 90vw;
      height: 90vh;
      max-width: 1400px;
      max-height: 900px;
      background: #1e1e1e;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    .split-view {
      display: flex;
      height: 100%;
      gap: 1px;
      background: #2d2d30;
    }

    .file-list {
      flex: 1;
      min-width: 300px;
      background: #1e1e1e;
      overflow-y: auto;
      border-right: 1px solid #3e3e42;
    }

    .preview-pane {
      flex: 2;
      background: #1e1e1e;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .preview-header {
      padding: 8px 16px;
      background: #252526;
      border-bottom: 1px solid #3e3e42;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .preview-content {
      flex: 1;
      overflow: auto;
      position: relative;
    }

    .file-item {
      padding: 8px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.15s;
      border-left: 3px solid transparent;
      font-size: 13px;
    }

    .file-item:hover {
      background: #2a2a2a;
    }

    .file-item.selected {
      background: #094771;
      border-left-color: #007acc;
    }

    .file-icon {
      flex-shrink: 0;
      width: 16px;
      text-align: center;
    }

    .file-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .git-status {
      margin-left: auto;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 600;
    }

    .git-status.modified {
      background: #4b3c00;
      color: #ffd700;
    }

    .git-status.added {
      background: #0e3a0e;
      color: #73c991;
    }

    .git-status.deleted {
      background: #5a1d1d;
      color: #f48771;
    }

    .git-status.untracked {
      background: #373737;
      color: #909090;
    }

    .monaco-container {
      width: 100%;
      height: 100%;
    }

    .image-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #1e1e1e;
      height: 100%;
    }

    .image-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border: 1px solid #3e3e42;
      border-radius: 4px;
    }

    .binary-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #cccccc;
      text-align: center;
      padding: 20px;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      background: #252526;
      border-bottom: 1px solid #3e3e42;
      align-items: center;
    }

    .filter-button {
      padding: 4px 8px;
      background: #3e3e42;
      border: 1px solid #5a5a5a;
      color: #cccccc;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s;
    }

    .filter-button:hover {
      background: #4e4e52;
    }

    .filter-button.active {
      background: #007acc;
      border-color: #007acc;
    }

    .path-breadcrumb {
      padding: 8px 16px;
      background: #252526;
      border-bottom: 1px solid #3e3e42;
      font-size: 12px;
      color: #cccccc;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .close-button {
      background: none;
      border: none;
      color: #cccccc;
      font-size: 20px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .close-button:hover {
      background: #3e3e42;
      color: #ffffff;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #888;
      padding: 20px;
      text-align: center;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #888;
    }

    .diff-preview {
      padding: 16px;
      overflow: auto;
      height: 100%;
    }

    .diff-line {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
    }

    .diff-line.added {
      background: #0e3a0e;
      color: #73c991;
    }

    .diff-line.deleted {
      background: #5a1d1d;
      color: #f48771;
    }

    .diff-line.context {
      color: #cccccc;
    }

    .diff-line.header {
      color: #569cd6;
      font-weight: 600;
    }
  `;

  @property({ type: String }) currentPath = '.';
  @property({ type: Boolean }) visible = false;
  @property({ type: String }) mode: 'browse' | 'select' = 'browse';

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
    console.log(
      `[FileBrowser] Connected, visible: ${this.visible}, currentPath: ${this.currentPath}`
    );
    if (this.visible) {
      await this.loadDirectory(this.currentPath);
    }
    document.addEventListener('keydown', this.handleKeyDown);
  }

  async updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    if (changedProperties.has('visible')) {
      console.log(`[FileBrowser] Visibility changed to: ${this.visible}`);
      if (this.visible) {
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

      console.log(`[FileBrowser] Loading directory: ${dirPath}`);
      const response = await fetch(`/api/fs/browse?${params}`);
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
      const response = await fetch(`/api/fs/preview?path=${encodeURIComponent(file.path)}`);
      if (response.ok) {
        this.preview = await response.json();
        if (this.preview?.type === 'text') {
          // Update Monaco editor if it exists
          this.updateMonacoContent();
        }
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

    return html` <span class="git-status ${status}">${labels[status]}</span> `;
  }

  private renderPreview() {
    if (this.previewLoading) {
      return html`<div class="loading">Loading preview...</div>`;
    }

    if (this.showDiff && this.diff) {
      return this.renderDiff();
    }

    if (!this.preview) {
      return html`
        <div class="empty-state">
          <div style="font-size: 48px; margin-bottom: 16px;">📄</div>
          <div>Select a file to preview</div>
        </div>
      `;
    }

    switch (this.preview.type) {
      case 'image':
        return html`
          <div class="image-preview">
            <img src="${this.preview.url}" alt="${this.selectedFile?.name}" />
          </div>
        `;

      case 'text':
        return html`
          <div
            class="monaco-container"
            @connected=${(e: Event) => {
              this.monacoContainer = e.target as HTMLElement;
              this.initMonacoEditor();
            }}
          ></div>
        `;

      case 'binary':
        return html`
          <div class="binary-preview">
            <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
            <div style="font-size: 18px; margin-bottom: 8px;">Binary File</div>
            <div style="color: #888;">
              ${this.preview.humanSize || this.preview.size + ' bytes'}
            </div>
            <div style="color: #888; margin-top: 8px;">
              ${this.preview.mimeType || 'Unknown type'}
            </div>
          </div>
        `;
    }
  }

  private renderDiff() {
    if (!this.diff || !this.diff.diff) {
      return html`
        <div class="empty-state">
          <div>No changes in this file</div>
        </div>
      `;
    }

    const lines = this.diff.diff.split('\n');
    return html`
      <div class="diff-preview">
        ${lines.map((line) => {
          let className = 'diff-line context';
          if (line.startsWith('+')) className = 'diff-line added';
          else if (line.startsWith('-')) className = 'diff-line deleted';
          else if (line.startsWith('@@')) className = 'diff-line header';

          return html`<div class="${className}">${line}</div>`;
        })}
      </div>
    `;
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <div class="modal-overlay" @click=${this.handleOverlayClick}>
        <div class="modal-container" @click=${(e: Event) => e.stopPropagation()}>
          <div class="toolbar">
            <button
              class="filter-button ${this.gitFilter === 'changed' ? 'active' : ''}"
              @click=${this.toggleGitFilter}
              title="Show only Git changes"
            >
              Git Changes
            </button>
            <button
              class="filter-button ${this.showHidden ? 'active' : ''}"
              @click=${this.toggleHidden}
              title="Show hidden files"
            >
              Hidden Files
            </button>
            ${this.gitStatus
              ? html`
                  <div
                    style="margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; color: #888;"
                  >
                    <span>📍 ${this.gitStatus.branch}</span>
                  </div>
                `
              : ''}
          </div>

          <div class="path-breadcrumb">
            <span>📂 ${this.currentPath}</span>
            <button class="close-button" @click=${this.handleCancel} title="Close (Esc)">✕</button>
          </div>

          <div class="split-view" style="flex: 1;">
            <div class="file-list">
              ${this.loading
                ? html`<div class="loading">Loading...</div>`
                : html`
                    ${this.currentPath !== '.' && this.currentPath !== '/'
                      ? html`
                          <div class="file-item" @click=${this.handleParentClick}>
                            <span class="file-icon">⬆️</span>
                            <span class="file-name">..</span>
                          </div>
                        `
                      : ''}
                    ${this.files.map(
                      (file) => html`
                        <div
                          class="file-item ${this.selectedFile?.path === file.path
                            ? 'selected'
                            : ''}"
                          @click=${() => this.handleFileClick(file)}
                        >
                          <span class="file-icon">${this.renderFileIcon(file)}</span>
                          <span class="file-name">${file.name}</span>
                          ${this.renderGitStatus(file.gitStatus)}
                        </div>
                      `
                    )}
                  `}
            </div>

            <div class="preview-pane">
              ${this.selectedFile
                ? html`
                    <div class="preview-header">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${this.renderFileIcon(this.selectedFile)}</span>
                        <span>${this.selectedFile.name}</span>
                        ${this.renderGitStatus(this.selectedFile.gitStatus)}
                      </div>
                      ${this.selectedFile.gitStatus && this.selectedFile.gitStatus !== 'unchanged'
                        ? html`
                            <button
                              class="filter-button ${this.showDiff ? 'active' : ''}"
                              @click=${this.toggleDiff}
                            >
                              ${this.showDiff ? 'View File' : 'View Diff'}
                            </button>
                          `
                        : ''}
                    </div>
                  `
                : ''}
              <div class="preview-content">${this.renderPreview()}</div>
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
    if (e.key === 'Escape' && this.visible) {
      e.preventDefault();
      this.handleCancel();
    }
  };
}
