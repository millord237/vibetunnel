/**
 * File Browser Component
 *
 * Modal file browser for navigating the filesystem and selecting files/directories.
 * Supports Git status display, file preview with CodeMirror editor, and diff viewing.
 *
 * @fires insert-path - When inserting a file path into terminal (detail: { path: string, type: 'file' | 'directory' })
 * @fires directory-selected - When a directory is selected in 'select' mode (detail: string)
 * @fires browser-cancel - When the browser is cancelled or closed
 */
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { Session } from './session-list.js';
import { createLogger } from '../utils/logger.js';
import { EditorView, keymap, scrollPastEnd } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { html as htmlLang } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

const logger = createLogger('file-browser');

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
  @state() private currentFullPath = '';
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
  @state() private errorMessage = '';

  private editorView: EditorView | null = null;
  private editorContainerRef = createRef<HTMLDivElement>();
  private lastEditorContainer: HTMLDivElement | null = null;

  async connectedCallback() {
    super.connectedCallback();
    if (this.visible) {
      this.currentPath = this.session?.workingDir || '.';
      await this.loadDirectory(this.currentPath);
    }
    document.addEventListener('keydown', this.handleKeyDown);
  }

  async updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    if (changedProperties.has('visible') || changedProperties.has('session')) {
      if (this.visible) {
        this.currentPath = this.session?.workingDir || '.';
        await this.loadDirectory(this.currentPath);
      }
    }

    if (this.preview?.type === 'text' && this.editorContainerRef.value) {
      // Check if container has changed (DOM was re-rendered) or editor doesn't exist
      const containerChanged = this.lastEditorContainer !== this.editorContainerRef.value;

      if (!this.editorView || containerChanged) {
        // Dispose old editor if it exists
        if (this.editorView) {
          this.editorView.destroy();
          this.editorView = null;
        }

        this.lastEditorContainer = this.editorContainerRef.value;
        await this.initCodeMirrorEditor();
      } else if (this.editorView) {
        // Update content if CodeMirror editor already exists and container is the same
        this.updateEditorContent();
      }
    } else if (this.editorView && this.preview?.type !== 'text') {
      // Clean up CodeMirror editor if we're not showing text
      this.editorView.destroy();
      this.editorView = null;
      this.lastEditorContainer = null;
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
      logger.debug(`loading directory: ${dirPath}`);
      logger.debug(`fetching URL: ${url}`);
      const response = await fetch(url);
      logger.debug(`response status: ${response.status}`);

      if (response.ok) {
        const data: DirectoryListing = await response.json();
        logger.debug(`received ${data.files?.length || 0} files`);
        this.currentPath = data.path;
        this.currentFullPath = data.fullPath;
        this.files = data.files || [];
        this.gitStatus = data.gitStatus;
      } else {
        const errorData = await response.text();
        logger.error(`failed to load directory: ${response.status}`, new Error(errorData));
      }
    } catch (error) {
      logger.error('error loading directory:', error);
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
      logger.debug(`loading preview for file: ${file.name}`);
      logger.debug(`file path: ${file.path}`);

      const response = await fetch(`/api/fs/preview?path=${encodeURIComponent(file.path)}`);
      if (response.ok) {
        this.preview = await response.json();
        this.requestUpdate(); // Trigger re-render to initialize Monaco if needed
      } else {
        logger.error(`preview failed: ${response.status}`, new Error(await response.text()));
      }
    } catch (error) {
      logger.error('error loading preview:', error);
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
      logger.error('error loading diff:', error);
    } finally {
      this.previewLoading = false;
    }
  }

  private getLanguageExtension(language: string): Extension | null {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return javascript({ typescript: language === 'typescript' });
      case 'html':
        return htmlLang();
      case 'css':
        return css();
      case 'json':
        return json();
      case 'markdown':
        return markdown();
      case 'python':
        return python();
      default:
        return null;
    }
  }

  private async initCodeMirrorEditor() {
    if (!this.editorContainerRef.value) {
      return;
    }

    try {
      const extensions: Extension[] = [
        EditorView.theme({
          '&': {
            fontSize: '14px',
            height: '100%',
          },
          '.cm-focused': {
            outline: 'none',
          },
          '.cm-editor': {
            height: '100%',
          },
          '.cm-scroller': {
            fontFamily:
              'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
            overflow: 'auto',
          },
        }),
        EditorView.domEventHandlers({
          wheel: (event, view) => {
            const delta = event.deltaY;
            if (delta !== 0) {
              view.scrollDOM.scrollTop += delta;
              event.preventDefault();
              return true;
            }
            return false;
          },
        }),
        keymap.of(defaultKeymap),
        EditorState.readOnly.of(true),
        oneDark,
        scrollPastEnd(),
      ];

      const languageExt = this.getLanguageExtension(this.preview?.language || '');
      if (languageExt) {
        extensions.push(languageExt);
      }

      const state = EditorState.create({
        doc: this.preview?.content || '',
        extensions,
      });

      this.editorView = new EditorView({
        state,
        parent: this.editorContainerRef.value,
      });
    } catch (error) {
      console.error('[FileBrowser] Failed to load CodeMirror editor:', error);
    }
  }

  private updateEditorContent() {
    if (!this.editorView || !this.preview) return;

    const extensions: Extension[] = [
      EditorView.theme({
        '&': {
          fontSize: '14px',
          height: '100%',
        },
        '.cm-focused': {
          outline: 'none',
        },
        '.cm-editor': {
          height: '100%',
        },
        '.cm-scroller': {
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
          overflow: 'auto',
        },
      }),
      EditorView.domEventHandlers({
        wheel: (event, view) => {
          const delta = event.deltaY;
          if (delta !== 0) {
            view.scrollDOM.scrollTop += delta;
            event.preventDefault();
            return true;
          }
          return false;
        },
      }),
      keymap.of(defaultKeymap),
      EditorState.readOnly.of(true),
      oneDark,
      scrollPastEnd(),
    ];

    const languageExt = this.getLanguageExtension(this.preview.language || '');
    if (languageExt) {
      extensions.push(languageExt);
    }

    const newState = EditorState.create({
      doc: this.preview.content || '',
      extensions,
    });

    this.editorView.setState(newState);
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
      logger.debug(`copied to clipboard: ${text}`);
    } catch (err) {
      logger.error('failed to copy to clipboard:', err);
    }
  }

  private insertPathIntoTerminal() {
    if (!this.selectedFile) return;

    // Construct absolute path by joining the current directory's full path with the file name
    let absolutePath: string;
    if (this.currentFullPath && this.selectedFile.name) {
      // Join the directory path with the file name
      absolutePath = this.currentFullPath.endsWith('/')
        ? this.currentFullPath + this.selectedFile.name
        : this.currentFullPath + '/' + this.selectedFile.name;
    } else {
      // Fallback to relative path if absolute path construction fails
      absolutePath = this.selectedFile.path;
    }

    // Dispatch event with the absolute file path
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: {
          path: absolutePath,
          type: this.selectedFile.type,
        },
        bubbles: true,
        composed: true,
      })
    );

    // Close the file browser
    this.dispatchEvent(new CustomEvent('browser-cancel'));
  }

  private showErrorMessage(message: string) {
    this.errorMessage = message;
    // Clear error message after 5 seconds
    setTimeout(() => {
      this.errorMessage = '';
    }, 5000);
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
      return html`
        <svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      `;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();

    // JavaScript/TypeScript files
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
      return html`
        <svg class="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3a1 1 0 011 1v2a1 1 0 11-2 0V9h-.5a.5.5 0 000 1H10a1 1 0 110 2H8.5A2.5 2.5 0 016 9.5V8a1 1 0 011-1h3z"
          />
        </svg>
      `;
    }

    if (ext === 'ts' || ext === 'tsx') {
      return html`
        <svg class="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm6 3h4v1h-1v4a1 1 0 11-2 0V8h-1a1 1 0 110-2zM6 7h2v6H6V7z"
          />
        </svg>
      `;
    }

    if (ext === 'jsx') {
      return html`
        <svg class="w-5 h-5 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm2 6a2 2 0 114 0 2 2 0 01-4 0zm6-2a2 2 0 104 0 2 2 0 00-4 0z"
          />
        </svg>
      `;
    }

    // Web files
    if (ext === 'html' || ext === 'htm') {
      return html`
        <svg class="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm1 2h10v2H5V5zm0 4h10v2H5V9zm0 4h6v2H5v-2z"
          />
        </svg>
      `;
    }

    if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
      return html`
        <svg class="w-5 h-5 text-pink-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm4 6a2 2 0 100 4 2 2 0 000-4zm4-2a2 2 0 100 4 2 2 0 000-4z"
          />
        </svg>
      `;
    }

    // Config and data files
    if (ext === 'json' || ext === 'jsonc') {
      return html`
        <svg class="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
          />
        </svg>
      `;
    }

    if (ext === 'xml' || ext === 'yaml' || ext === 'yml') {
      return html`
        <svg class="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
          />
        </svg>
      `;
    }

    // Documentation
    if (ext === 'md' || ext === 'markdown') {
      return html`
        <svg class="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm2 0v8h12V6H4zm2 2h8v1H6V8zm0 2h8v1H6v-1zm0 2h6v1H6v-1z"
          />
        </svg>
      `;
    }

    if (ext === 'txt' || ext === 'text') {
      return html`
        <svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm0 2h12v10H4V5zm2 2v6h8V7H6zm2 1h4v1H8V8zm0 2h4v1H8v-1z"
          />
        </svg>
      `;
    }

    // Images
    if (
      ext === 'png' ||
      ext === 'jpg' ||
      ext === 'jpeg' ||
      ext === 'gif' ||
      ext === 'webp' ||
      ext === 'bmp'
    ) {
      return html`
        <svg class="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clip-rule="evenodd"
          />
        </svg>
      `;
    }

    if (ext === 'svg') {
      return html`
        <svg class="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm6 6L8 7l2 2 2-2-2 2 2 2-2-2-2 2 2-2z"
          />
        </svg>
      `;
    }

    // Archives
    if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === 'rar' || ext === '7z') {
      return html`
        <svg class="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
          />
        </svg>
      `;
    }

    // Documents
    if (ext === 'pdf') {
      return html`
        <svg class="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M4 18h12V6h-4V2H4v16zm8-14v4h4l-4-4zM6 10h8v1H6v-1zm0 2h8v1H6v-1zm0 2h6v1H6v-1z"
          />
        </svg>
      `;
    }

    // Executables and scripts
    if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || ext === 'fish') {
      return html`
        <svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path
            d="M3 4a1 1 0 000 2h11.586l-2.293 2.293a1 1 0 101.414 1.414L17.414 6H19a1 1 0 100-2H3zM3 11a1 1 0 100 2h3.586l-2.293 2.293a1 1 0 101.414 1.414L9.414 13H11a1 1 0 100-2H3z"
          />
        </svg>
      `;
    }

    // Default file icon
    return html`
      <svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
        <path
          fill-rule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clip-rule="evenodd"
        />
      </svg>
    `;
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
          <svg class="w-16 h-16 mb-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
              clip-rule="evenodd"
            />
          </svg>
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
            ${ref(this.editorContainerRef)}
            class="editor-container h-full w-full relative overflow-hidden"
          ></div>
        `;

      case 'binary':
        return html`
          <div class="flex flex-col items-center justify-center h-full text-dark-text-muted">
            <svg class="w-16 h-16 mb-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
              />
            </svg>
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
                <svg class="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
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
            ${this.errorMessage
              ? html`
                  <div
                    class="bg-red-500/20 border border-red-500 text-red-400 px-3 py-2 rounded-lg text-sm"
                  >
                    ${this.errorMessage}
                  </div>
                `
              : ''}
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
                    <span class="text-xs text-dark-text-muted flex items-center gap-1">
                      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fill-rule="evenodd"
                          d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z"
                          clip-rule="evenodd"
                        />
                      </svg>
                      ${this.gitStatus.branch}
                    </span>
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
                            <svg
                              class="w-5 h-5 text-gray-400"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fill-rule="evenodd"
                                d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                                clip-rule="evenodd"
                              />
                            </svg>
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
                                @click=${() =>
                                  this.selectedFile && this.copyToClipboard(this.selectedFile.path)}
                                title="Copy path to clipboard (⌘C)"
                              >
                                Copy Path
                              </button>
                              ${this.mode === 'browse'
                                ? html`
                                    <button
                                      class="btn-primary text-xs px-3 py-1"
                                      @click=${this.insertPathIntoTerminal}
                                      title="Insert path into terminal (Enter)"
                                    >
                                      Insert Path
                                    </button>
                                  `
                                : ''}
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
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
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
