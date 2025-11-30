/**
 * Input Ownership Service
 *
 * Tracks which client has control over input for each session.
 * Implements "last writer wins" - the most recent client to send input
 * takes ownership automatically.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('input-ownership');

// How long before ownership expires due to inactivity (30 seconds)
const OWNERSHIP_TIMEOUT_MS = 30000;

interface OwnershipInfo {
  clientId: string;
  lastActivity: number;
  pendingInput: string;
}

type OwnershipChangeListener = (
  sessionId: string,
  newOwner: string | null,
  previousOwner: string | null,
  pendingInput: string
) => void;

/**
 * Service to manage input ownership for terminal sessions.
 * Only one client can "own" input for a session at a time.
 * The last client to interact automatically takes ownership.
 */
export class InputOwnershipService {
  private ownership: Map<string, OwnershipInfo> = new Map();
  private listeners: Set<OwnershipChangeListener> = new Set();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    // Periodically clean up expired ownerships
    this.cleanupTimer = setInterval(() => this.cleanupExpiredOwnerships(), 5000);
  }

  /**
   * Attempt to claim ownership for a client.
   * Returns true if ownership was granted (either new or already owned).
   */
  claimOwnership(sessionId: string, clientId: string, pendingInput = ''): boolean {
    const current = this.ownership.get(sessionId);
    const previousOwner = current?.clientId || null;

    // Update ownership
    this.ownership.set(sessionId, {
      clientId,
      lastActivity: Date.now(),
      pendingInput,
    });

    // Notify if ownership changed OR if input changed (for sync)
    if (previousOwner !== clientId || current?.pendingInput !== pendingInput) {
      if (previousOwner !== clientId) {
        logger.log(`Ownership for session ${sessionId}: ${previousOwner || 'none'} -> ${clientId}`);
      }
      this.notifyListeners(sessionId, clientId, previousOwner, pendingInput);
    }

    return true;
  }

  /**
   * Update pending input for the current owner (broadcasts to other clients).
   */
  updatePendingInput(sessionId: string, clientId: string, pendingInput: string): void {
    const current = this.ownership.get(sessionId);
    if (!current || current.clientId !== clientId) {
      // Not the owner, claim ownership first
      this.claimOwnership(sessionId, clientId, pendingInput);
      return;
    }

    // Update input and broadcast
    if (current.pendingInput !== pendingInput) {
      current.pendingInput = pendingInput;
      current.lastActivity = Date.now();
      this.notifyListeners(sessionId, clientId, clientId, pendingInput);
    }
  }

  /**
   * Get pending input for a session.
   */
  getPendingInput(sessionId: string): string {
    return this.ownership.get(sessionId)?.pendingInput || '';
  }

  /**
   * Check if a client has ownership of a session.
   */
  hasOwnership(sessionId: string, clientId: string): boolean {
    const current = this.ownership.get(sessionId);
    if (!current) return true; // No owner = anyone can write

    // Check if ownership expired
    if (Date.now() - current.lastActivity > OWNERSHIP_TIMEOUT_MS) {
      this.ownership.delete(sessionId);
      return true;
    }

    return current.clientId === clientId;
  }

  /**
   * Get the current owner of a session.
   */
  getOwner(sessionId: string): string | null {
    const current = this.ownership.get(sessionId);
    if (!current) return null;

    // Check if ownership expired
    if (Date.now() - current.lastActivity > OWNERSHIP_TIMEOUT_MS) {
      this.ownership.delete(sessionId);
      return null;
    }

    return current.clientId;
  }

  /**
   * Release ownership for a client (e.g., when they disconnect).
   */
  releaseOwnership(sessionId: string, clientId: string): void {
    const current = this.ownership.get(sessionId);
    if (current && current.clientId === clientId) {
      this.ownership.delete(sessionId);
      logger.log(`Ownership released for session ${sessionId} by ${clientId}`);
      this.notifyListeners(sessionId, null, clientId, '');
    }
  }

  /**
   * Release all ownerships for a client (when they disconnect).
   */
  releaseAllForClient(clientId: string): void {
    const toRelease: string[] = [];

    for (const [sessionId, info] of this.ownership) {
      if (info.clientId === clientId) {
        toRelease.push(sessionId);
      }
    }

    for (const sessionId of toRelease) {
      this.ownership.delete(sessionId);
      logger.log(`Ownership released for session ${sessionId} (client ${clientId} disconnected)`);
      this.notifyListeners(sessionId, null, clientId, '');
    }
  }

  /**
   * Subscribe to ownership changes.
   */
  onOwnershipChange(listener: OwnershipChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Refresh ownership timestamp (called when client sends input).
   */
  refreshOwnership(sessionId: string, clientId: string): void {
    const current = this.ownership.get(sessionId);
    if (current && current.clientId === clientId) {
      current.lastActivity = Date.now();
    }
  }

  private notifyListeners(
    sessionId: string,
    newOwner: string | null,
    previousOwner: string | null,
    pendingInput: string
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(sessionId, newOwner, previousOwner, pendingInput);
      } catch (error) {
        logger.error('Error in ownership change listener:', error);
      }
    }
  }

  private cleanupExpiredOwnerships(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, info] of this.ownership) {
      if (now - info.lastActivity > OWNERSHIP_TIMEOUT_MS) {
        expired.push(sessionId);
      }
    }

    for (const sessionId of expired) {
      const info = this.ownership.get(sessionId);
      if (info) {
        this.ownership.delete(sessionId);
        logger.log(`Ownership expired for session ${sessionId} (was ${info.clientId})`);
        this.notifyListeners(sessionId, null, info.clientId, '');
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.ownership.clear();
    this.listeners.clear();
  }
}
