import { EventEmitter } from 'events';

interface StreamUpdate {
  sessionId: string;
  data: string;
  timestamp: number;
}

/**
 * Global event emitter for direct in-process notifications between
 * AsciinemaWriter and StreamWatcher to bypass file watching latency
 */
export class StreamNotifier extends EventEmitter {
  // Define event types for type safety
  on(event: 'stream-update', listener: (update: StreamUpdate) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  emit(event: 'stream-update', update: StreamUpdate): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
  private static instance: StreamNotifier;

  private constructor() {
    super();
    // Increase max listeners as we might have many sessions
    this.setMaxListeners(1000);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): StreamNotifier {
    if (!StreamNotifier.instance) {
      StreamNotifier.instance = new StreamNotifier();
    }
    return StreamNotifier.instance;
  }

  /**
   * Notify about new stream data
   */
  notifyStreamUpdate(sessionId: string, data: string): void {
    const update: StreamUpdate = {
      sessionId,
      data,
      timestamp: Date.now(),
    };
    this.emit('stream-update', update);
  }

  /**
   * Check if there are any listeners for a session
   */
  hasListeners(_sessionId: string): boolean {
    // Check if there are any listeners at all
    return this.listenerCount('stream-update') > 0;
  }
}

// Export singleton instance
export const streamNotifier = StreamNotifier.getInstance();
