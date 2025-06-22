import * as fs from 'fs';
import { Response } from 'express';

interface StreamClient {
  response: Response;
  startTime: number;
}

interface WatcherInfo {
  clients: Set<StreamClient>;
  watcher?: fs.FSWatcher;
  lastOffset: number;
  lastSize: number;
  lastMtime: number;
  lineBuffer: string;
}

export class StreamWatcher {
  private activeWatchers: Map<string, WatcherInfo> = new Map();

  constructor() {
    // Clean up notification listeners on exit
    process.on('beforeExit', () => {
      this.cleanup();
    });
  }

  /**
   * Add a client to watch a stream file
   */
  addClient(sessionId: string, streamPath: string, response: Response): void {
    const startTime = Date.now() / 1000;
    const client: StreamClient = { response, startTime };

    let watcherInfo = this.activeWatchers.get(sessionId);

    if (!watcherInfo) {
      // Create new watcher for this session
      watcherInfo = {
        clients: new Set(),
        lastOffset: 0,
        lastSize: 0,
        lastMtime: 0,
        lineBuffer: '',
      };
      this.activeWatchers.set(sessionId, watcherInfo);

      // Send existing content first
      this.sendExistingContent(streamPath, client);

      // Get current file size and stats
      if (fs.existsSync(streamPath)) {
        const stats = fs.statSync(streamPath);
        watcherInfo.lastOffset = stats.size;
        watcherInfo.lastSize = stats.size;
        watcherInfo.lastMtime = stats.mtimeMs;
      }

      // Start watching for new content
      this.startWatching(sessionId, streamPath, watcherInfo);
    } else {
      // Send existing content to new client
      this.sendExistingContent(streamPath, client);
    }

    // Add client to set
    watcherInfo.clients.add(client);
    console.log(
      `[STREAM] Added client to session ${sessionId}, total clients: ${watcherInfo.clients.size}`
    );
  }

  /**
   * Remove a client
   */
  removeClient(sessionId: string, response: Response): void {
    const watcherInfo = this.activeWatchers.get(sessionId);
    if (!watcherInfo) return;

    // Find and remove client
    let clientToRemove: StreamClient | undefined;
    for (const client of watcherInfo.clients) {
      if (client.response === response) {
        clientToRemove = client;
        break;
      }
    }

    if (clientToRemove) {
      watcherInfo.clients.delete(clientToRemove);
      console.log(
        `[STREAM] Removed client from session ${sessionId}, remaining clients: ${watcherInfo.clients.size}`
      );

      // If no more clients, stop watching
      if (watcherInfo.clients.size === 0) {
        console.log(`[STREAM] No more clients for session ${sessionId}, stopping watcher`);
        if (watcherInfo.watcher) {
          watcherInfo.watcher.close();
        }
        this.activeWatchers.delete(sessionId);
      }
    }
  }

  /**
   * Send existing content to a client
   */
  private sendExistingContent(streamPath: string, client: StreamClient): void {
    try {
      const stream = fs.createReadStream(streamPath, { encoding: 'utf8' });
      let exitEventFound = false;
      let lineBuffer = '';

      stream.on('data', (chunk: string | Buffer) => {
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep incomplete line for next chunk

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.version && parsed.width && parsed.height) {
                // Send header as-is
                client.response.write(`data: ${line}\n\n`);
              } else if (Array.isArray(parsed) && parsed.length >= 3) {
                if (parsed[0] === 'exit') {
                  exitEventFound = true;
                  client.response.write(`data: ${line}\n\n`);
                } else {
                  // Set timestamp to 0 for existing content
                  const instantEvent = [0, parsed[1], parsed[2]];
                  client.response.write(`data: ${JSON.stringify(instantEvent)}\n\n`);
                }
              }
            } catch (_e) {
              // Skip invalid lines
            }
          }
        }
      });

      stream.on('end', () => {
        // Process any remaining line
        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer);
            if (parsed.version && parsed.width && parsed.height) {
              client.response.write(`data: ${lineBuffer}\n\n`);
            } else if (Array.isArray(parsed) && parsed.length >= 3) {
              if (parsed[0] === 'exit') {
                exitEventFound = true;
                client.response.write(`data: ${lineBuffer}\n\n`);
              } else {
                const instantEvent = [0, parsed[1], parsed[2]];
                client.response.write(`data: ${JSON.stringify(instantEvent)}\n\n`);
              }
            }
          } catch (_e) {
            // Skip invalid line
          }
        }

        // If exit event found, close connection
        if (exitEventFound) {
          console.log(`[STREAM] Session already has exit event, closing connection`);
          client.response.end();
        }
      });

      stream.on('error', (error) => {
        console.error(`[STREAM] Error streaming existing content:`, error);
      });
    } catch (error) {
      console.error(`[STREAM] Error creating read stream:`, error);
    }
  }

  /**
   * Start watching a file for changes
   */
  private startWatching(sessionId: string, streamPath: string, watcherInfo: WatcherInfo): void {
    console.log(`[STREAM] Using file watcher for session ${sessionId}`);

    // Use standard fs.watch with stat checking
    watcherInfo.watcher = fs.watch(streamPath, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        try {
          // Check if file actually changed by comparing stats
          const stats = fs.statSync(streamPath);

          // Only process if size increased (append-only file)
          if (stats.size > watcherInfo.lastSize || stats.mtimeMs > watcherInfo.lastMtime) {
            watcherInfo.lastSize = stats.size;
            watcherInfo.lastMtime = stats.mtimeMs;

            // Read only new data
            if (stats.size > watcherInfo.lastOffset) {
              const fd = fs.openSync(streamPath, 'r');
              const buffer = Buffer.alloc(stats.size - watcherInfo.lastOffset);
              fs.readSync(fd, buffer, 0, buffer.length, watcherInfo.lastOffset);
              fs.closeSync(fd);

              // Update offset
              watcherInfo.lastOffset = stats.size;

              // Process new data
              const newData = buffer.toString('utf8');
              watcherInfo.lineBuffer += newData;

              // Process complete lines
              const lines = watcherInfo.lineBuffer.split('\n');
              watcherInfo.lineBuffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim()) {
                  this.broadcastLine(sessionId, line, watcherInfo);
                }
              }
            }
          }
        } catch (error) {
          console.error(`[STREAM] Error reading file changes:`, error);
        }
      }
    });

    watcherInfo.watcher.on('error', (error) => {
      console.error(`[STREAM] File watcher error for session ${sessionId}:`, error);
    });
  }

  /**
   * Broadcast a line to all clients
   */
  private broadcastLine(sessionId: string, line: string, watcherInfo: WatcherInfo): void {
    let eventData: string | null = null;

    try {
      const parsed = JSON.parse(line);
      if (parsed.version && parsed.width && parsed.height) {
        return; // Skip duplicate headers
      }
      if (Array.isArray(parsed) && parsed.length >= 3) {
        if (parsed[0] === 'exit') {
          console.log(`[STREAM] Exit event detected: ${JSON.stringify(parsed)}`);
          eventData = `data: ${JSON.stringify(parsed)}\n\n`;

          // Send exit event to all clients and close connections
          for (const client of watcherInfo.clients) {
            try {
              client.response.write(eventData);
              client.response.end();
            } catch (error) {
              console.error(`[STREAM] Error writing to client:`, error);
            }
          }
          return;
        } else {
          // Calculate relative timestamp for each client
          for (const client of watcherInfo.clients) {
            const currentTime = Date.now() / 1000;
            const relativeEvent = [currentTime - client.startTime, parsed[1], parsed[2]];
            const clientData = `data: ${JSON.stringify(relativeEvent)}\n\n`;

            try {
              client.response.write(clientData);
              // @ts-expect-error - flush exists but not in types
              if (client.response.flush) client.response.flush();
            } catch (error) {
              console.error(`[STREAM] Error writing to client:`, error);
              // Client might be disconnected
            }
          }
          return; // Already handled per-client
        }
      }
    } catch (_e) {
      // Handle non-JSON as raw output
      const currentTime = Date.now() / 1000;
      for (const client of watcherInfo.clients) {
        const castEvent = [currentTime - client.startTime, 'o', line];
        const clientData = `data: ${JSON.stringify(castEvent)}\n\n`;

        try {
          client.response.write(clientData);
          // @ts-expect-error - flush exists but not in types
          if (client.response.flush) client.response.flush();
        } catch (error) {
          console.error(`[STREAM] Error writing to client:`, error);
        }
      }
      return;
    }
  }

  /**
   * Clean up all watchers and listeners
   */
  private cleanup(): void {
    for (const [_sessionId, watcherInfo] of this.activeWatchers) {
      if (watcherInfo.watcher) {
        watcherInfo.watcher.close();
      }
    }
    this.activeWatchers.clear();
  }
}
