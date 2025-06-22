import { WebSocket } from 'ws';
import chalk from 'chalk';
import { RemoteRegistry } from './remote-registry.js';
import { TerminalManager } from './terminal-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('buffer-aggregator');

interface BufferAggregatorConfig {
  terminalManager: TerminalManager;
  remoteRegistry: RemoteRegistry | null;
  isHQMode: boolean;
}

interface RemoteWebSocketConnection {
  ws: WebSocket;
  remoteId: string;
  remoteName: string;
  subscriptions: Set<string>;
}

export class BufferAggregator {
  private config: BufferAggregatorConfig;
  private remoteConnections: Map<string, RemoteWebSocketConnection> = new Map();
  private clientSubscriptions: Map<WebSocket, Map<string, () => void>> = new Map();

  constructor(config: BufferAggregatorConfig) {
    this.config = config;
  }

  /**
   * Handle a new client WebSocket connection
   */
  async handleClientConnection(ws: WebSocket): Promise<void> {
    logger.log(chalk.blue('New client connected'));

    // Initialize subscription map for this client
    this.clientSubscriptions.set(ws, new Map());

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', version: '1.0' }));

    // Handle messages from client
    ws.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        await this.handleClientMessage(ws, data);
      } catch (error) {
        logger.error('Error handling client message:', error);
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          })
        );
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleClientDisconnect(ws);
    });

    ws.on('error', (error) => {
      logger.error(chalk.red('Client WebSocket error:'), error);
    });
  }

  /**
   * Handle messages from a client
   */
  private async handleClientMessage(
    clientWs: WebSocket,
    data: { type: string; sessionId?: string }
  ): Promise<void> {
    const subscriptions = this.clientSubscriptions.get(clientWs);
    if (!subscriptions) return;

    if (data.type === 'subscribe' && data.sessionId) {
      const sessionId = data.sessionId;

      // Unsubscribe if already subscribed
      if (subscriptions.has(sessionId)) {
        const existingUnsubscribe = subscriptions.get(sessionId);
        if (existingUnsubscribe) {
          existingUnsubscribe();
        }
        subscriptions.delete(sessionId);
      }

      // Check if this is a local or remote session
      const isRemoteSession =
        this.config.isHQMode &&
        this.config.remoteRegistry &&
        this.config.remoteRegistry.getRemoteBySessionId(sessionId);

      if (isRemoteSession) {
        // Subscribe to remote session
        await this.subscribeToRemoteSession(clientWs, sessionId, isRemoteSession.id);
      } else {
        // Subscribe to local session
        await this.subscribeToLocalSession(clientWs, sessionId);
      }

      clientWs.send(JSON.stringify({ type: 'subscribed', sessionId }));
      logger.debug(`Client subscribed to session ${sessionId}`);
    } else if (data.type === 'unsubscribe' && data.sessionId) {
      const sessionId = data.sessionId;
      const unsubscribe = subscriptions.get(sessionId);
      if (unsubscribe) {
        unsubscribe();
        subscriptions.delete(sessionId);
        logger.debug(`Client unsubscribed from session ${sessionId}`);
      }

      // Also unsubscribe from remote if applicable
      if (this.config.isHQMode && this.config.remoteRegistry) {
        const remote = this.config.remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          const remoteConn = this.remoteConnections.get(remote.id);
          if (remoteConn) {
            remoteConn.subscriptions.delete(sessionId);
            if (remoteConn.ws.readyState === WebSocket.OPEN) {
              remoteConn.ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }));
            }
          }
        }
      }
    } else if (data.type === 'ping') {
      clientWs.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  }

  /**
   * Subscribe a client to a local session
   */
  private async subscribeToLocalSession(clientWs: WebSocket, sessionId: string): Promise<void> {
    const subscriptions = this.clientSubscriptions.get(clientWs);
    if (!subscriptions) return;

    try {
      const unsubscribe = await this.config.terminalManager.subscribeToBufferChanges(
        sessionId,
        (sessionId: string, snapshot: Parameters<TerminalManager['encodeSnapshot']>[0]) => {
          try {
            const buffer = this.config.terminalManager.encodeSnapshot(snapshot);
            const sessionIdBuffer = Buffer.from(sessionId, 'utf8');
            const totalLength = 1 + 4 + sessionIdBuffer.length + buffer.length;
            const fullBuffer = Buffer.allocUnsafe(totalLength);

            let offset = 0;
            fullBuffer.writeUInt8(0xbf, offset); // Magic byte for binary message
            offset += 1;

            fullBuffer.writeUInt32LE(sessionIdBuffer.length, offset);
            offset += 4;

            sessionIdBuffer.copy(fullBuffer, offset);
            offset += sessionIdBuffer.length;

            buffer.copy(fullBuffer, offset);

            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(fullBuffer);
            }
          } catch (error) {
            logger.error('Error encoding buffer update:', error);
          }
        }
      );

      subscriptions.set(sessionId, unsubscribe);

      // Send initial buffer
      const initialSnapshot = await this.config.terminalManager.getBufferSnapshot(sessionId);
      const buffer = this.config.terminalManager.encodeSnapshot(initialSnapshot);

      const sessionIdBuffer = Buffer.from(sessionId, 'utf8');
      const totalLength = 1 + 4 + sessionIdBuffer.length + buffer.length;
      const fullBuffer = Buffer.allocUnsafe(totalLength);

      let offset = 0;
      fullBuffer.writeUInt8(0xbf, offset);
      offset += 1;

      fullBuffer.writeUInt32LE(sessionIdBuffer.length, offset);
      offset += 4;

      sessionIdBuffer.copy(fullBuffer, offset);
      offset += sessionIdBuffer.length;

      buffer.copy(fullBuffer, offset);

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(fullBuffer);
      }
    } catch (error) {
      logger.error(`Error subscribing to local session ${sessionId}:`, error);
      clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to subscribe to session' }));
    }
  }

  /**
   * Subscribe a client to a remote session
   */
  private async subscribeToRemoteSession(
    clientWs: WebSocket,
    sessionId: string,
    remoteId: string
  ): Promise<void> {
    // Ensure we have a connection to this remote
    let remoteConn = this.remoteConnections.get(remoteId);
    if (!remoteConn || remoteConn.ws.readyState !== WebSocket.OPEN) {
      // Need to connect to remote
      const connected = await this.connectToRemote(remoteId);
      if (!connected) {
        clientWs.send(
          JSON.stringify({ type: 'error', message: 'Failed to connect to remote server' })
        );
        return;
      }
      remoteConn = this.remoteConnections.get(remoteId);
    }

    if (!remoteConn) return;

    // Subscribe to the session on the remote
    remoteConn.subscriptions.add(sessionId);
    remoteConn.ws.send(JSON.stringify({ type: 'subscribe', sessionId }));

    // Store an unsubscribe function for the client
    const subscriptions = this.clientSubscriptions.get(clientWs);
    if (subscriptions) {
      subscriptions.set(sessionId, () => {
        // Will be handled in the unsubscribe message handler
      });
    }
  }

  /**
   * Connect to a remote server's WebSocket
   */
  private async connectToRemote(remoteId: string): Promise<boolean> {
    if (!this.config.remoteRegistry) return false;

    const remote = this.config.remoteRegistry.getRemote(remoteId);
    if (!remote) return false;

    try {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = remote.url.replace(/^http/, 'ws');
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${remote.token}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);

        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const remoteConn: RemoteWebSocketConnection = {
        ws,
        remoteId: remote.id,
        remoteName: remote.name,
        subscriptions: new Set(),
      };

      this.remoteConnections.set(remoteId, remoteConn);

      // Handle messages from remote
      ws.on('message', (data: Buffer) => {
        this.handleRemoteMessage(remoteId, data);
      });

      // Handle disconnection
      ws.on('close', () => {
        logger.log(chalk.yellow(`Disconnected from remote ${remote.name}`));
        this.remoteConnections.delete(remoteId);
      });

      ws.on('error', (error) => {
        logger.error(chalk.red(`Remote ${remote.name} WebSocket error:`), error);
      });

      logger.log(chalk.green(`Connected to remote ${remote.name}`));
      return true;
    } catch (error) {
      logger.error(chalk.red(`Failed to connect to remote ${remoteId}:`), error);
      return false;
    }
  }

  /**
   * Handle messages from a remote server
   */
  private handleRemoteMessage(remoteId: string, data: Buffer): void {
    // Check if this is a binary buffer update
    if (data.length > 0 && data[0] === 0xbf) {
      // Forward to all clients subscribed to sessions from this remote
      this.forwardBufferToClients(data);
    } else {
      // JSON message
      try {
        const message = JSON.parse(data.toString());
        logger.debug(`Remote ${remoteId} message:`, message.type);
      } catch (error) {
        logger.error(`Failed to parse remote message:`, error);
      }
    }
  }

  /**
   * Forward a buffer update to all subscribed clients
   */
  private forwardBufferToClients(buffer: Buffer): void {
    // Extract session ID from buffer
    if (buffer.length < 5) return;

    const sessionIdLength = buffer.readUInt32LE(1);
    if (buffer.length < 5 + sessionIdLength) return;

    const sessionId = buffer.subarray(5, 5 + sessionIdLength).toString('utf8');

    // Forward to all clients subscribed to this session
    for (const [clientWs, subscriptions] of this.clientSubscriptions) {
      if (subscriptions.has(sessionId) && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(buffer);
      }
    }
  }

  /**
   * Handle client disconnection
   */
  private handleClientDisconnect(ws: WebSocket): void {
    const subscriptions = this.clientSubscriptions.get(ws);
    if (subscriptions) {
      // Unsubscribe from all sessions
      for (const [_sessionId, unsubscribe] of subscriptions) {
        unsubscribe();
      }
      subscriptions.clear();
    }
    this.clientSubscriptions.delete(ws);
    logger.log(chalk.yellow('Client disconnected'));
  }

  /**
   * Register a new remote server (called when a remote registers with HQ)
   */
  async onRemoteRegistered(remoteId: string): Promise<void> {
    // Optionally pre-connect to the remote
    await this.connectToRemote(remoteId);
  }

  /**
   * Handle remote server unregistration
   */
  onRemoteUnregistered(remoteId: string): void {
    const remoteConn = this.remoteConnections.get(remoteId);
    if (remoteConn) {
      remoteConn.ws.close();
      this.remoteConnections.delete(remoteId);
    }
  }

  /**
   * Clean up all connections
   */
  destroy(): void {
    // Close all client connections
    for (const [ws] of this.clientSubscriptions) {
      ws.close();
    }
    this.clientSubscriptions.clear();

    // Close all remote connections
    for (const [_, remoteConn] of this.remoteConnections) {
      remoteConn.ws.close();
    }
    this.remoteConnections.clear();
  }
}
