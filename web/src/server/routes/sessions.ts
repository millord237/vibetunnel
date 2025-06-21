import { Router } from 'express';
import { PtyManager, PtyError } from '../pty/index.js';
import { TerminalManager } from '../services/terminal-manager.js';
import { StreamWatcher } from '../services/stream-watcher.js';
import { RemoteRegistry } from '../services/remote-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

interface SessionRoutesConfig {
  ptyManager: PtyManager;
  terminalManager: TerminalManager;
  streamWatcher: StreamWatcher;
  remoteRegistry: RemoteRegistry | null;
  isHQMode: boolean;
}

// Helper function to resolve path (handles ~)
function resolvePath(inputPath: string, defaultPath: string): string {
  if (!inputPath || inputPath.trim() === '') {
    return defaultPath;
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  if (!path.isAbsolute(inputPath)) {
    return path.join(defaultPath, inputPath);
  }

  return inputPath;
}

export function createSessionRoutes(config: SessionRoutesConfig): Router {
  const router = Router();
  const { ptyManager, terminalManager, streamWatcher, remoteRegistry, isHQMode } = config;

  // List all sessions (aggregate local + remote in HQ mode)
  router.get('/sessions', async (req, res) => {
    try {
      let allSessions = [];

      // Get local sessions
      const localSessions = ptyManager.listSessions();
      console.log(`Found ${localSessions.length} local sessions`);

      // Add source info to local sessions
      const localSessionsWithSource = localSessions.map((session) => ({
        ...session,
        id: session.session_id,
        command: Array.isArray(session.cmdline) ? session.cmdline.join(' ') : session.cmdline || '',
        workingDir: session.cwd,
        name: session.name,
        status: session.status,
        exitCode: session.exit_code,
        startedAt: session.started_at,
        pid: session.pid,
        source: 'local',
      }));

      allSessions = [...localSessionsWithSource];

      // If in HQ mode, aggregate sessions from all remotes
      if (isHQMode && remoteRegistry) {
        const remotes = remoteRegistry.getRemotes();
        console.log(`HQ Mode: Checking ${remotes.length} remote servers for sessions`);

        // Fetch sessions from each remote in parallel
        const remotePromises = remotes.map(async (remote) => {
          try {
            const response = await fetch(`${remote.url}/api/sessions`, {
              headers: {
                Authorization: `Bearer ${remote.token}`,
              },
              signal: AbortSignal.timeout(5000), // 5 second timeout
            });

            if (response.ok) {
              const remoteSessions = await response.json();
              console.log(`Got ${remoteSessions.length} sessions from remote ${remote.name}`);

              // Track session IDs for this remote
              const sessionIds = remoteSessions.map((s: { id: string }) => s.id);
              remoteRegistry.updateRemoteSessions(remote.id, sessionIds);

              // Add remote info to each session
              return remoteSessions.map((session: { id: string; [key: string]: unknown }) => ({
                ...session,
                source: 'remote',
                remoteId: remote.id,
                remoteName: remote.name,
                remoteUrl: remote.url,
              }));
            } else {
              console.error(
                `Failed to get sessions from remote ${remote.name}: HTTP ${response.status}`
              );
              return [];
            }
          } catch (error) {
            console.error(`Failed to get sessions from remote ${remote.name}:`, error);
            return [];
          }
        });

        const remoteResults = await Promise.all(remotePromises);
        const remoteSessions = remoteResults.flat();
        console.log(`Total remote sessions: ${remoteSessions.length}`);

        allSessions = [...allSessions, ...remoteSessions];
      }

      console.log(`Returning ${allSessions.length} total sessions`);
      res.json(allSessions);
    } catch (error) {
      console.error('Error listing sessions:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Create new session (local or on remote)
  router.post('/sessions', async (req, res) => {
    const { command, workingDir, name, remoteId, spawn_terminal } = req.body;

    if (!command || !Array.isArray(command) || command.length === 0) {
      return res.status(400).json({ error: 'Command array is required' });
    }

    try {
      // If remoteId is specified and we're in HQ mode, forward to remote
      if (remoteId && isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemote(remoteId);
        if (!remote) {
          return res.status(404).json({ error: 'Remote server not found' });
        }

        console.log(`Forwarding session creation to remote ${remote.name}`);

        // Forward the request to the remote server
        const response = await fetch(`${remote.url}/api/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${remote.token}`,
          },
          body: JSON.stringify({
            command,
            workingDir,
            name,
            spawn_terminal,
            // Don't forward remoteId to avoid recursion
          }),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Unknown error' }));
          return res.status(response.status).json(error);
        }

        const result = await response.json();

        // Track the session in the remote's sessionIds
        if (result.sessionId) {
          remoteRegistry.addSessionToRemote(remote.id, result.sessionId);
        }

        res.json(result); // Return sessionId as-is, no namespacing
        return;
      }

      // If spawn_terminal is true and socket exists, use the spawn-terminal logic
      const socketPath = '/tmp/vibetunnel-terminal.sock';
      if (spawn_terminal && fs.existsSync(socketPath)) {
        try {
          // Generate session ID
          const sessionId = generateSessionId();
          const sessionName = name || `session_${Date.now()}`;

          // Request Mac app to spawn terminal
          console.log(`Requesting terminal spawn with command: ${JSON.stringify(command)}`);
          const spawnResult = await requestTerminalSpawn({
            sessionId,
            sessionName,
            command,
            workingDir: resolvePath(workingDir, process.cwd()),
          });

          if (!spawnResult.success) {
            if (spawnResult.error?.includes('ECONNREFUSED')) {
              console.log(
                'Terminal spawn requested but socket not available, falling back to normal spawn'
              );
            } else {
              throw new Error(spawnResult.error || 'Failed to spawn terminal');
            }
          } else {
            // Wait a bit for the session to be created
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Return the session ID - client will poll for the session to appear
            res.json({ sessionId, message: 'Terminal spawn requested' });
            return;
          }
        } catch (error) {
          console.error('Error spawning terminal:', error);
          res.status(500).json({
            error: 'Failed to spawn terminal',
            details: error instanceof Error ? error.message : 'Unknown error',
          });
          return;
        }
      } else if (spawn_terminal && !fs.existsSync(socketPath)) {
        console.log(
          'Terminal spawn requested but socket not available, falling back to normal spawn'
        );
      }

      // Create local session
      const sessionName =
        name || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const cwd = resolvePath(workingDir, process.cwd());

      console.log(`Creating session with PTY service: ${command.join(' ')} in ${cwd}`);

      const result = await ptyManager.createSession(command, {
        sessionName,
        workingDir: cwd,
        term: 'xterm-256color',
      });

      const { sessionId, sessionInfo } = result;
      console.log(`Session created: ${sessionId} (PID: ${sessionInfo.pid})`);

      // Stream watcher is set up when clients connect to the stream endpoint

      res.json({ sessionId });
    } catch (error) {
      console.error('Error creating session:', error);
      if (error instanceof PtyError) {
        res.status(500).json({ error: 'Failed to create session', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to create session' });
      }
    }
  });

  // Get single session info
  router.get('/sessions/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;

    try {
      // If in HQ mode, check if this is a remote session
      if (isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          // Forward to remote server
          try {
            const response = await fetch(`${remote.url}/api/sessions/${sessionId}`, {
              headers: {
                Authorization: `Bearer ${remote.token}`,
              },
              signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
              return res.status(response.status).json(await response.json());
            }

            return res.json(await response.json());
          } catch (error) {
            console.error(`Failed to get session info from remote ${remote.name}:`, error);
            return res.status(503).json({ error: 'Failed to reach remote server' });
          }
        }
      }

      // Local session handling
      const sessionInfo = ptyManager.getSession(sessionId);

      if (!sessionInfo) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Get the last modified time of the stream file
      let lastModified = sessionInfo.started_at || new Date().toISOString();
      try {
        if (fs.existsSync(sessionInfo['stream-out'])) {
          const stats = fs.statSync(sessionInfo['stream-out']);
          lastModified = stats.mtime.toISOString();
        }
      } catch {
        // Use started_at as fallback
      }

      res.json({
        id: sessionInfo.session_id,
        command: Array.isArray(sessionInfo.cmdline)
          ? sessionInfo.cmdline.join(' ')
          : sessionInfo.cmdline || '',
        workingDir: sessionInfo.cwd,
        name: sessionInfo.name,
        status: sessionInfo.status,
        exitCode: sessionInfo.exit_code,
        startedAt: sessionInfo.started_at,
        lastModified: lastModified,
        pid: sessionInfo.pid,
        waiting: sessionInfo.waiting,
      });
    } catch (error) {
      console.error('Error getting session info:', error);
      res.status(500).json({ error: 'Failed to get session info' });
    }
  });

  // Kill session (just kill the process)
  router.delete('/sessions/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;

    try {
      // If in HQ mode, check if this is a remote session
      if (isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          // Forward kill request to remote server
          try {
            const response = await fetch(`${remote.url}/api/sessions/${sessionId}`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${remote.token}`,
              },
              signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
              return res.status(response.status).json(await response.json());
            }

            // Remote killed the session, now update our registry
            remoteRegistry.removeSessionFromRemote(sessionId);
            console.log(`Remote session ${sessionId} killed on ${remote.name}`);

            return res.json(await response.json());
          } catch (error) {
            console.error(`Failed to kill session on remote ${remote.name}:`, error);
            return res.status(503).json({ error: 'Failed to reach remote server' });
          }
        }
      }

      // Local session handling - just kill it, no registry updates needed
      const session = ptyManager.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      await ptyManager.killSession(sessionId, 'SIGTERM');
      console.log(`Local session ${sessionId} killed`);

      res.json({ success: true, message: 'Session killed' });
    } catch (error) {
      console.error('Error killing session:', error);
      if (error instanceof PtyError) {
        res.status(500).json({ error: 'Failed to kill session', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to kill session' });
      }
    }
  });

  // Cleanup session files
  router.delete('/sessions/:sessionId/cleanup', async (req, res) => {
    const sessionId = req.params.sessionId;

    try {
      // If in HQ mode, check if this is a remote session
      if (isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          // Forward cleanup request to remote server
          try {
            const response = await fetch(`${remote.url}/api/sessions/${sessionId}/cleanup`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${remote.token}`,
              },
              signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
              return res.status(response.status).json(await response.json());
            }

            // Remote cleaned up the session, now update our registry
            remoteRegistry.removeSessionFromRemote(sessionId);
            console.log(`Remote session ${sessionId} cleaned up on ${remote.name}`);

            return res.json(await response.json());
          } catch (error) {
            console.error(`Failed to cleanup session on remote ${remote.name}:`, error);
            return res.status(503).json({ error: 'Failed to reach remote server' });
          }
        }
      }

      // Local session handling - just cleanup, no registry updates needed
      ptyManager.cleanupSession(sessionId);
      console.log(`Local session ${sessionId} cleaned up`);

      res.json({ success: true, message: 'Session cleaned up' });
    } catch (error) {
      console.error('Error cleaning up session:', error);
      if (error instanceof PtyError) {
        res.status(500).json({ error: 'Failed to cleanup session', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to cleanup session' });
      }
    }
  });

  // Cleanup all exited sessions (local and remote)
  router.post('/cleanup-exited', async (req, res) => {
    try {
      // Clean up local sessions
      const localCleanedSessions = ptyManager.cleanupExitedSessions();
      console.log(`Cleaned up ${localCleanedSessions.length} local exited sessions`);

      // Remove cleaned local sessions from remote registry if in HQ mode
      if (isHQMode && remoteRegistry) {
        for (const sessionId of localCleanedSessions) {
          remoteRegistry.removeSessionFromRemote(sessionId);
        }
      }

      let totalCleaned = localCleanedSessions.length;
      const remoteResults: Array<{ remoteName: string; cleaned: number; error?: string }> = [];

      // If in HQ mode, clean up sessions on all remotes
      if (isHQMode && remoteRegistry) {
        const allRemotes = remoteRegistry.getRemotes();

        // Clean up on each remote in parallel
        const remoteCleanupPromises = allRemotes.map(async (remote) => {
          try {
            const response = await fetch(`${remote.url}/api/cleanup-exited`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${remote.token}`,
              },
              signal: AbortSignal.timeout(10000), // 10 second timeout
            });

            if (response.ok) {
              const result = await response.json();
              const cleanedSessionIds = result.cleanedSessions || [];
              const cleanedCount = cleanedSessionIds.length;
              totalCleaned += cleanedCount;

              // Remove cleaned remote sessions from registry
              for (const sessionId of cleanedSessionIds) {
                remoteRegistry.removeSessionFromRemote(sessionId);
              }

              remoteResults.push({ remoteName: remote.name, cleaned: cleanedCount });
            } else {
              throw new Error(`HTTP ${response.status}`);
            }
          } catch (error) {
            console.error(`Failed to cleanup sessions on remote ${remote.name}:`, error);
            remoteResults.push({
              remoteName: remote.name,
              cleaned: 0,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        });

        await Promise.all(remoteCleanupPromises);
      }

      res.json({
        success: true,
        message: `${totalCleaned} exited sessions cleaned up across all servers`,
        localCleaned: localCleanedSessions.length,
        remoteResults,
      });
    } catch (error) {
      console.error('Error cleaning up exited sessions:', error);
      if (error instanceof PtyError) {
        res
          .status(500)
          .json({ error: 'Failed to cleanup exited sessions', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to cleanup exited sessions' });
      }
    }
  });

  // Get session buffer
  router.get('/sessions/:sessionId/buffer', async (req, res) => {
    const sessionId = req.params.sessionId;

    console.log(`[BUFFER] Client requesting buffer for session ${sessionId}`);

    try {
      // If in HQ mode, check if this is a remote session
      if (isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          // Forward buffer request to remote server
          try {
            const response = await fetch(`${remote.url}/api/sessions/${sessionId}/buffer`, {
              headers: {
                Authorization: `Bearer ${remote.token}`,
              },
              signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
              return res.status(response.status).json(await response.json());
            }

            // Forward the binary buffer
            const buffer = await response.arrayBuffer();
            res.setHeader('Content-Type', 'application/octet-stream');
            return res.send(Buffer.from(buffer));
          } catch (error) {
            console.error(`Failed to get buffer from remote ${remote.name}:`, error);
            return res.status(503).json({ error: 'Failed to reach remote server' });
          }
        }
      }

      // Local session handling
      const session = ptyManager.getSession(sessionId);
      if (!session) {
        console.error(`[BUFFER] Session ${sessionId} not found`);
        return res.status(404).json({ error: 'Session not found' });
      }

      // Get terminal buffer snapshot
      const snapshot = await terminalManager.getBufferSnapshot(sessionId);

      // Encode as binary buffer
      const buffer = terminalManager.encodeSnapshot(snapshot);

      console.log(
        `[BUFFER] Sending buffer for session ${sessionId}: ${buffer.length} bytes, ` +
          `dimensions: ${snapshot.cols}x${snapshot.rows}, cursor: (${snapshot.cursorX},${snapshot.cursorY})`
      );

      // Send as binary data
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(buffer);
    } catch (error) {
      console.error('[BUFFER] Error getting buffer:', error);
      res.status(500).json({ error: 'Failed to get terminal buffer' });
    }
  });

  // Stream session output
  router.get('/sessions/:sessionId/stream', async (req, res) => {
    const sessionId = req.params.sessionId;

    console.log(
      `[STREAM] New SSE client connected to session ${sessionId} from ${req.get('User-Agent')?.substring(0, 50) || 'unknown'}`
    );

    // If in HQ mode, check if this is a remote session
    if (isHQMode && remoteRegistry) {
      const remote = remoteRegistry.getRemoteBySessionId(sessionId);
      if (remote) {
        // Proxy SSE stream from remote server
        try {
          const controller = new AbortController();
          const response = await fetch(`${remote.url}/api/sessions/${sessionId}/stream`, {
            headers: {
              Authorization: `Bearer ${remote.token}`,
              Accept: 'text/event-stream',
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            return res.status(response.status).json(await response.json());
          }

          // Set up SSE headers
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control',
            'X-Accel-Buffering': 'no',
          });

          // Proxy the stream
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body');
          }

          const decoder = new TextDecoder();
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                res.write(chunk);
              }
            } catch (error) {
              console.error(`Stream proxy error for remote ${remote.name}:`, error);
            }
          };

          pump();

          // Clean up on disconnect
          req.on('close', () => {
            console.log(`[STREAM] SSE client disconnected from remote session ${sessionId}`);
            controller.abort();
          });

          return;
        } catch (error) {
          console.error(`Failed to stream from remote ${remote.name}:`, error);
          return res.status(503).json({ error: 'Failed to reach remote server' });
        }
      }
    }

    // Local session handling
    const session = ptyManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const streamPath = session['stream-out'];
    if (!streamPath) {
      return res.status(404).json({ error: 'Session stream not found' });
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    // Send initial connection event
    res.write(':ok\n\n');

    // Add client to stream watcher
    streamWatcher.addClient(sessionId, streamPath, res);

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);

    // Clean up on disconnect
    req.on('close', () => {
      console.log(`[STREAM] SSE client disconnected from session ${sessionId}`);
      streamWatcher.removeClient(sessionId, res);
      clearInterval(heartbeat);
    });
  });

  // Send input to session
  router.post('/sessions/:sessionId/input', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { text, key } = req.body;

    // Validate that only one of text or key is provided
    if ((text === undefined && key === undefined) || (text !== undefined && key !== undefined)) {
      return res.status(400).json({ error: 'Either text or key must be provided, but not both' });
    }

    if (text !== undefined && typeof text !== 'string') {
      return res.status(400).json({ error: 'Text must be a string' });
    }

    if (key !== undefined && typeof key !== 'string') {
      return res.status(400).json({ error: 'Key must be a string' });
    }

    try {
      // If in HQ mode, check if this is a remote session
      if (isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          // Forward input to remote server
          try {
            const response = await fetch(`${remote.url}/api/sessions/${sessionId}/input`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${remote.token}`,
              },
              body: JSON.stringify(req.body),
              signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
              return res.status(response.status).json(await response.json());
            }

            return res.json(await response.json());
          } catch (error) {
            console.error(`Failed to send input to remote ${remote.name}:`, error);
            return res.status(503).json({ error: 'Failed to reach remote server' });
          }
        }
      }

      // Local session handling
      const session = ptyManager.getSession(sessionId);
      if (!session) {
        console.error(`Session ${sessionId} not found for input`);
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.status !== 'running') {
        console.error(`Session ${sessionId} is not running (status: ${session.status})`);
        return res.status(400).json({ error: 'Session is not running' });
      }

      const inputData = text !== undefined ? { text } : { key };
      console.log(`Sending input to session ${sessionId}: ${JSON.stringify(inputData)}`);

      ptyManager.sendInput(sessionId, inputData);
      res.json({ success: true });
    } catch (error) {
      console.error('Error sending input:', error);
      if (error instanceof PtyError) {
        res.status(500).json({ error: 'Failed to send input', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to send input' });
      }
    }
  });

  // Resize session
  router.post('/sessions/:sessionId/resize', async (req, res) => {
    const sessionId = req.params.sessionId;
    const { cols, rows } = req.body;

    if (typeof cols !== 'number' || typeof rows !== 'number') {
      return res.status(400).json({ error: 'Cols and rows must be numbers' });
    }

    if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) {
      return res.status(400).json({ error: 'Cols and rows must be between 1 and 1000' });
    }

    console.log(`Resizing session ${sessionId} to ${cols}x${rows}`);

    try {
      // If in HQ mode, check if this is a remote session
      if (isHQMode && remoteRegistry) {
        const remote = remoteRegistry.getRemoteBySessionId(sessionId);
        if (remote) {
          // Forward resize to remote server
          try {
            const response = await fetch(`${remote.url}/api/sessions/${sessionId}/resize`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${remote.token}`,
              },
              body: JSON.stringify({ cols, rows }),
              signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
              return res.status(response.status).json(await response.json());
            }

            return res.json(await response.json());
          } catch (error) {
            console.error(`Failed to resize session on remote ${remote.name}:`, error);
            return res.status(503).json({ error: 'Failed to reach remote server' });
          }
        }
      }

      // Local session handling
      const session = ptyManager.getSession(sessionId);
      if (!session) {
        console.error(`Session ${sessionId} not found for resize`);
        return res.status(404).json({ error: 'Session not found' });
      }

      if (session.status !== 'running') {
        console.error(`Session ${sessionId} is not running (status: ${session.status})`);
        return res.status(400).json({ error: 'Session is not running' });
      }

      // Resize the session
      ptyManager.resizeSession(sessionId, cols, rows);
      console.log(`Successfully resized session ${sessionId} to ${cols}x${rows}`);

      res.json({ success: true, cols, rows });
    } catch (error) {
      console.error('Error resizing session via PTY service:', error);
      if (error instanceof PtyError) {
        res.status(500).json({ error: 'Failed to resize session', details: error.message });
      } else {
        res.status(500).json({ error: 'Failed to resize session' });
      }
    }
  });

  return router;
}

// Generate a unique session ID
function generateSessionId(): string {
  // Generate UUID v4
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }

  // Set version (4) and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Convert to hex string with dashes
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// Request terminal spawn from Mac app
async function requestTerminalSpawn(params: {
  sessionId: string;
  sessionName: string;
  command: string[];
  workingDir: string;
}): Promise<{ success: boolean; error?: string }> {
  const socketPath = '/tmp/vibetunnel-terminal.sock';

  // Check if socket exists
  if (!fs.existsSync(socketPath)) {
    return {
      success: false,
      error: 'Terminal spawn service not available. Is the Mac app running?',
    };
  }

  const spawnRequest = {
    workingDir: params.workingDir,
    sessionId: params.sessionId,
    command: params.command.join(' '),
    terminal: null, // Let Mac app use default terminal
  };

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      console.log(`Connected to terminal spawn service for session ${params.sessionId}`);
      client.write(JSON.stringify(spawnRequest));
    });

    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log(`Terminal spawn response:`, response);
        resolve({ success: response.success, error: response.error });
      } catch (error) {
        console.error('Failed to parse terminal spawn response:', error);
        resolve({ success: false, error: 'Invalid response from terminal spawn service' });
      }
      client.end();
    });

    client.on('error', (error) => {
      console.error('Failed to connect to terminal spawn service:', error);
      resolve({
        success: false,
        error: `Connection failed: ${error.message}`,
      });
    });

    client.on('timeout', () => {
      client.destroy();
      resolve({ success: false, error: 'Terminal spawn request timed out' });
    });

    client.setTimeout(5000); // 5 second timeout
  });
}
