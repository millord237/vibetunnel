/**
 * Monaco Editor Loader
 *
 * Handles loading and initialization of Monaco Editor for the application.
 * This module ensures Monaco is properly loaded and configured before use.
 */
import * as monaco from 'monaco-editor';
import { createLogger } from './logger.js';

const logger = createLogger('monaco-loader');

// Re-export monaco for use in other modules
export { monaco };

// Flag to track if Monaco has been initialized
let isInitialized = false;

/**
 * Initialize Monaco Editor with custom configuration
 */
export async function initializeMonaco(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    logger.debug('Initializing Monaco Editor...');

    // Configure Monaco environment
    // Set up worker URLs if needed (for advanced features like TypeScript support)
    // In a bundled environment, we might need to configure worker paths

    // Make Monaco available globally for the component
    (window as Window & { monaco: typeof monaco }).monaco = monaco;

    // Configure languages
    monaco.languages.register({ id: 'shell' });
    monaco.languages.setMonarchTokensProvider('shell', {
      tokenizer: {
        root: [
          [/^#.*$/, 'comment'],
          [/\$\w+/, 'variable'],
          [
            /\b(echo|cd|ls|grep|find|chmod|mkdir|rm|cp|mv|touch|cat|sed|awk|curl|wget|git|npm|yarn|docker|kubectl)\b/,
            'keyword',
          ],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
        ],
      },
    });

    // Add custom themes if needed
    monaco.editor.defineTheme('vibetunnel-dark', {
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

    isInitialized = true;
    logger.debug('Monaco Editor initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Monaco Editor:', error);
    throw error;
  }
}

/**
 * Ensure Monaco is loaded and ready
 */
export async function ensureMonacoLoaded(): Promise<typeof monaco> {
  await initializeMonaco();
  return monaco;
}
