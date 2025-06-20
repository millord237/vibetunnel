import { Router } from 'express';
import { RemoteRegistry } from '../services/remote-registry.js';
import chalk from 'chalk';

interface RemoteRoutesConfig {
  remoteRegistry: RemoteRegistry | null;
  isHQMode: boolean;
}

export function createRemoteRoutes(config: RemoteRoutesConfig): Router {
  const router = Router();
  const { remoteRegistry, isHQMode } = config;

  // HQ Mode: List all registered remotes
  router.get('/remotes', (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const remotes = remoteRegistry.getRemotes();
    // Convert Set to Array for JSON serialization
    const remotesWithArraySessionIds = remotes.map((remote) => ({
      ...remote,
      sessionIds: Array.from(remote.sessionIds),
    }));
    res.json(remotesWithArraySessionIds);
  });

  // HQ Mode: Register a new remote
  router.post('/remotes/register', (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const { id, name, url, token } = req.body;

    if (!id || !name || !url || !token) {
      return res.status(400).json({ error: 'Missing required fields: id, name, url, token' });
    }

    try {
      const remote = remoteRegistry.register({ id, name, url, token });
      console.log(chalk.green(`Remote registered: ${name} (${id}) from ${url}`));
      res.json({ success: true, remote });
    } catch (error) {
      if (error instanceof Error && error.message.includes('already registered')) {
        return res.status(409).json({ error: error.message });
      }
      console.error(chalk.red('Failed to register remote:'), error);
      res.status(500).json({ error: 'Failed to register remote' });
    }
  });

  // HQ Mode: Unregister a remote
  router.delete('/remotes/:remoteId', (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const remoteId = req.params.remoteId;
    const success = remoteRegistry.unregister(remoteId);

    if (success) {
      console.log(chalk.yellow(`Remote unregistered: ${remoteId}`));
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Remote not found' });
    }
  });

  // HQ Mode: Refresh sessions for a specific remote
  router.post('/remotes/:remoteName/refresh-sessions', async (req, res) => {
    if (!isHQMode || !remoteRegistry) {
      return res.status(404).json({ error: 'Not running in HQ mode' });
    }

    const remoteName = req.params.remoteName;
    const { action, sessionId } = req.body;

    // Find remote by name
    const remotes = remoteRegistry.getRemotes();
    const remote = remotes.find((r) => r.name === remoteName);

    if (!remote) {
      return res.status(404).json({ error: 'Remote not found' });
    }

    try {
      // Fetch latest sessions from the remote
      const response = await fetch(`${remote.url}/api/sessions`, {
        headers: {
          Authorization: `Bearer ${remote.token}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const sessions = (await response.json()) as Array<{ id: string }>;
        const sessionIds = sessions.map((s) => s.id);
        remoteRegistry.updateRemoteSessions(remote.id, sessionIds);

        console.log(
          chalk.green(
            `Updated sessions for remote ${remote.name}: ${sessionIds.length} sessions (${action} ${sessionId})`
          )
        );
        res.json({ success: true, sessionCount: sessionIds.length });
      } else {
        throw new Error(`Failed to fetch sessions: ${response.status}`);
      }
    } catch (error) {
      console.error(chalk.red(`Failed to refresh sessions for remote ${remote.name}:`), error);
      res.status(500).json({ error: 'Failed to refresh sessions' });
    }
  });

  return router;
}
