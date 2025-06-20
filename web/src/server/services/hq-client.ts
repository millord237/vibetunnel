import { v4 as uuidv4 } from 'uuid';

export class HQClient {
  private readonly hqUrl: string;
  private readonly remoteId: string;
  private readonly remoteName: string;
  private readonly token: string;
  private readonly hqUsername: string;
  private readonly hqPassword: string;
  private readonly remoteUrl: string;

  constructor(
    hqUrl: string,
    hqUsername: string,
    hqPassword: string,
    remoteName: string,
    remoteUrl: string,
    bearerToken: string
  ) {
    this.hqUrl = hqUrl;
    this.remoteId = uuidv4();
    this.remoteName = remoteName;
    this.token = bearerToken;
    this.hqUsername = hqUsername;
    this.hqPassword = hqPassword;
    this.remoteUrl = remoteUrl;
  }

  async register(): Promise<void> {
    try {
      const response = await fetch(`${this.hqUrl}/api/remotes/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64')}`,
        },
        body: JSON.stringify({
          id: this.remoteId,
          name: this.remoteName,
          url: this.remoteUrl,
          token: this.token, // Token for HQ to authenticate with this remote
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Registration failed: ${errorBody.error || response.statusText}`);
      }

      console.log(`Successfully registered with HQ at ${this.hqUrl}`);
      console.log(`Remote ID: ${this.remoteId}`);
      console.log(`Remote name: ${this.remoteName}`);
      console.log(`Token: ${this.token}`);
    } catch (error) {
      console.error('Failed to register with HQ:', error);
      throw error; // Let the caller handle retries if needed
    }
  }

  async destroy(): Promise<void> {
    try {
      // Try to unregister
      await fetch(`${this.hqUrl}/api/remotes/${this.remoteId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64')}`,
        },
      });
    } catch {
      // Ignore errors during shutdown
    }
  }

  getRemoteId(): string {
    return this.remoteId;
  }

  getToken(): string {
    return this.token;
  }

  getHQUrl(): string {
    return this.hqUrl;
  }

  getHQAuth(): string {
    const credentials = Buffer.from(`${this.hqUsername}:${this.hqPassword}`).toString('base64');
    return `Basic ${credentials}`;
  }

  getName(): string {
    return this.remoteName;
  }
}
