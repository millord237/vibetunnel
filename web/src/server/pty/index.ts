/**
 * PTY Module Entry Point
 *
 * This module exports all the PTY-related components for easy integration
 * with the existing server code.
 */

// Core types
export * from './types.js';

// Main service interface
export { PtyManager } from './pty-manager.js';

// Individual components (for advanced usage)
export { AsciinemaWriter } from './asciinema-writer.js';
export { SessionManager } from './session-manager.js';
export { ProcessUtils } from './process-utils.js';

// Re-export for convenience
export { PtyError } from './types.js';
