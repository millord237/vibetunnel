/**
 * Monaco Editor Component
 *
 * A Lit component that wraps Monaco Editor with support for:
 * - Normal code editing mode
 * - Diff mode with inline/side-by-side switching
 * - Automatic language detection
 * - Dark theme matching VibeTunnel's design
 *
 * @fires save - When save is triggered (Cmd/Ctrl+S) in edit mode (detail: { content: string })
 * @fires content-changed - When content changes in edit mode (detail: { content: string })
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { editor } from 'monaco-editor';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('monaco-editor');

// Import Monaco Editor types
declare global {
  interface Window {
    monaco: typeof import('monaco-editor');
  }
}

export interface MonacoEditorOptions {
  theme?: string;
  readOnly?: boolean;
  language?: string;
  automaticLayout?: boolean;
  minimap?: { enabled: boolean };
  fontSize?: number;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  scrollBeyondLastLine?: boolean;
  renderWhitespace?: 'all' | 'none' | 'boundary' | 'selection' | 'trailing';
}

@customElement('monaco-editor')
export class MonacoEditor extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
    }

    .editor-container {
      width: 100%;
      height: 100%;
      position: relative;
      background: #1e1e1e;
    }

    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #666;
      font-family:
        ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
    }

    .mode-toggle {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 10;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mode-toggle:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
    }
  `;

  @property({ type: String }) content = '';
  @property({ type: String }) originalContent = '';
  @property({ type: String }) modifiedContent = '';
  @property({ type: String }) language = '';
  @property({ type: String }) filename = '';
  @property({ type: Boolean }) readOnly = false;
  @property({ type: String }) mode: 'normal' | 'diff' = 'normal';
  @property({ type: Boolean }) showModeToggle = false;
  @property({ type: Object }) options: MonacoEditorOptions = {};

  @state() private isLoading = true;
  @state() private diffMode: 'inline' | 'sideBySide' = 'sideBySide';
  @state() private containerWidth = 0;

  private containerRef = createRef<HTMLDivElement>();
  private editor: editor.IStandaloneCodeEditor | editor.IStandaloneDiffEditor | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private monacoLoaded = false;

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.loadMonaco();
    this.setupResizeObserver();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.disposeEditor();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private async loadMonaco() {
    if (this.monacoLoaded || window.monaco) {
      this.monacoLoaded = true;
      this.isLoading = false;
      return;
    }

    try {
      logger.debug('Loading Monaco Editor...');
      // Monaco will be loaded via esbuild bundling
      // We'll need to configure the loader properly in the build process
      await this.waitForMonaco();
      this.monacoLoaded = true;
      this.isLoading = false;
      logger.debug('Monaco Editor loaded successfully');
    } catch (error) {
      logger.error('Failed to load Monaco Editor:', error);
      this.isLoading = false;
    }
  }

  private async waitForMonaco(timeout = 10000): Promise<void> {
    const startTime = Date.now();

    while (!window.monaco) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Monaco Editor failed to load within timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private setupResizeObserver() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.containerWidth = entry.contentRect.width;
        // Auto-switch diff mode based on width
        if (this.mode === 'diff' && this.editor) {
          const shouldBeInline = this.containerWidth < 768; // Mobile breakpoint
          const newMode = shouldBeInline ? 'inline' : 'sideBySide';
          if (newMode !== this.diffMode) {
            this.diffMode = newMode;
            this.recreateEditor();
          }
        }
        // Trigger Monaco's layout update
        if (this.editor) {
          this.editor.layout();
        }
      }
    });

    if (this.containerRef.value) {
      this.resizeObserver.observe(this.containerRef.value);
    }
  }

  async updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // Check if we need to create or recreate the editor
    const needsRecreate =
      changedProperties.has('mode') ||
      (changedProperties.has('content') && !this.editor) ||
      (changedProperties.has('originalContent') && this.mode === 'diff') ||
      (changedProperties.has('modifiedContent') && this.mode === 'diff');

    if (needsRecreate && !this.isLoading && this.containerRef.value) {
      await this.recreateEditor();
    } else if (this.editor && !this.isLoading) {
      // Update existing editor
      if (changedProperties.has('content') && this.mode === 'normal') {
        this.updateContent();
      }
      if (changedProperties.has('language') || changedProperties.has('filename')) {
        this.updateLanguage();
      }
      if (changedProperties.has('readOnly')) {
        this.updateReadOnly();
      }
    }
  }

  private async recreateEditor() {
    this.disposeEditor();
    await this.createEditor();
  }

  private async createEditor() {
    if (!this.containerRef.value || !window.monaco) {
      return;
    }

    try {
      // Set up the dark theme
      this.setupTheme();

      const commonOptions: editor.IEditorConstructionOptions = {
        theme: 'vibetunnel-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        readOnly: this.readOnly,
        ...this.options,
      };

      if (this.mode === 'diff') {
        // Create diff editor
        const diffOptions: editor.IDiffEditorConstructionOptions = {
          ...commonOptions,
          renderSideBySide: this.diffMode === 'sideBySide',
          ignoreTrimWhitespace: false,
          renderIndicators: true,
          originalEditable: false,
        };

        this.editor = window.monaco.editor.createDiffEditor(this.containerRef.value, diffOptions);

        // Set models for diff
        const originalModel = window.monaco.editor.createModel(
          this.originalContent || '',
          this.detectLanguage()
        );
        const modifiedModel = window.monaco.editor.createModel(
          this.modifiedContent || '',
          this.detectLanguage()
        );

        this.editor.setModel({
          original: originalModel,
          modified: modifiedModel,
        });
      } else {
        // Create normal editor
        this.editor = window.monaco.editor.create(this.containerRef.value, {
          ...commonOptions,
          value: this.content,
          language: this.detectLanguage(),
        });

        // Add save command
        if (!this.readOnly) {
          this.editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS, () => {
            this.handleSave();
          });

          // Listen for content changes
          this.editor.onDidChangeModelContent(() => {
            const content = (this.editor as editor.IStandaloneCodeEditor)?.getValue() || '';
            this.dispatchEvent(
              new CustomEvent('content-changed', {
                detail: { content },
                bubbles: true,
                composed: true,
              })
            );
          });
        }
      }

      logger.debug(`Created ${this.mode} editor`);
    } catch (error) {
      logger.error('Failed to create editor:', error);
    }
  }

  private setupTheme() {
    if (!window.monaco) return;

    window.monaco.editor.defineTheme('vibetunnel-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0a0b0d',
        'editor.foreground': '#e0e0e0',
        'editorLineNumber.foreground': '#666',
        'editorLineNumber.activeForeground': '#aaa',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#1a1b1d',
        'editorCursor.foreground': '#10b981',
        'editor.findMatchBackground': '#515c6a',
        'editor.findMatchHighlightBackground': '#ea5e5e55',
        'editorIndentGuide.background': '#333',
        'editorIndentGuide.activeBackground': '#555',
      },
    });
  }

  private detectLanguage(): string {
    if (this.language) {
      return this.language;
    }

    if (this.filename) {
      const ext = this.filename.split('.').pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        html: 'html',
        htm: 'html',
        css: 'css',
        scss: 'scss',
        sass: 'sass',
        less: 'less',
        py: 'python',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        cs: 'csharp',
        php: 'php',
        swift: 'swift',
        kt: 'kotlin',
        scala: 'scala',
        r: 'r',
        sql: 'sql',
        sh: 'shell',
        bash: 'shell',
        zsh: 'shell',
        fish: 'shell',
        ps1: 'powershell',
        yml: 'yaml',
        yaml: 'yaml',
        xml: 'xml',
        md: 'markdown',
        markdown: 'markdown',
        dockerfile: 'dockerfile',
        makefile: 'makefile',
        gitignore: 'gitignore',
      };

      return languageMap[ext || ''] || 'plaintext';
    }

    return 'plaintext';
  }

  private updateContent() {
    if (!this.editor || this.mode === 'diff') return;

    const currentValue = (this.editor as editor.IStandaloneCodeEditor).getValue();
    if (currentValue !== this.content) {
      (this.editor as editor.IStandaloneCodeEditor).setValue(this.content);
    }
  }

  private updateLanguage() {
    if (!this.editor || !window.monaco) return;

    const language = this.detectLanguage();

    if (this.mode === 'normal') {
      const model = (this.editor as editor.IStandaloneCodeEditor).getModel();
      if (model) {
        window.monaco.editor.setModelLanguage(model, language);
      }
    } else {
      // For diff editor, update both models
      const diffEditor = this.editor as editor.IStandaloneDiffEditor;
      const originalModel = diffEditor.getOriginalEditor().getModel();
      const modifiedModel = diffEditor.getModifiedEditor().getModel();

      if (originalModel) {
        window.monaco.editor.setModelLanguage(originalModel, language);
      }
      if (modifiedModel) {
        window.monaco.editor.setModelLanguage(modifiedModel, language);
      }
    }
  }

  private updateReadOnly() {
    if (!this.editor) return;

    if (this.mode === 'normal') {
      (this.editor as editor.IStandaloneCodeEditor).updateOptions({ readOnly: this.readOnly });
    } else {
      const diffEditor = this.editor as editor.IStandaloneDiffEditor;
      diffEditor.getModifiedEditor().updateOptions({ readOnly: this.readOnly });
    }
  }

  private handleSave() {
    if (this.readOnly || !this.editor || this.mode === 'diff') return;

    const content = (this.editor as editor.IStandaloneCodeEditor).getValue();
    this.dispatchEvent(
      new CustomEvent('save', {
        detail: { content },
        bubbles: true,
        composed: true,
      })
    );
  }

  private toggleDiffMode() {
    if (this.mode !== 'diff') return;

    this.diffMode = this.diffMode === 'inline' ? 'sideBySide' : 'inline';
    this.recreateEditor();
  }

  private disposeEditor() {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
  }

  render() {
    return html`
      <div class="editor-container" ${ref(this.containerRef)}>
        ${this.isLoading ? html` <div class="loading">Loading editor...</div> ` : ''}
        ${this.showModeToggle && this.mode === 'diff' && !this.isLoading
          ? html`
              <button
                class="mode-toggle"
                @click=${this.toggleDiffMode}
                title="Toggle between inline and side-by-side diff"
              >
                ${this.diffMode === 'inline' ? 'Side by Side' : 'Inline'}
              </button>
            `
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'monaco-editor': MonacoEditor;
  }
}
