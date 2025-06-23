import { Request, Response, NextFunction } from 'express';
import chalk from 'chalk';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('auth');

interface AuthConfig {
  basicAuthUsername: string | null;
  basicAuthPassword: string | null;
  isHQMode: boolean;
  bearerToken?: string; // Token that HQ must use to authenticate with this remote
}

export function createAuthMiddleware(config: AuthConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check endpoint
    if (req.path === '/api/health') {
      logger.debug('bypassing auth for health check endpoint');
      return next();
    }

    // If no auth configured, allow all requests
    if (!config.basicAuthUsername || !config.basicAuthPassword) {
      logger.debug('no auth configured, allowing request');
      return next();
    }

    logger.debug(`auth check for ${req.method} ${req.path} from ${req.ip}`);

    // Check for Bearer token (for HQ to remote communication)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // In HQ mode, bearer tokens are not accepted (HQ uses basic auth)
      if (config.isHQMode) {
        logger.warn(`bearer token rejected in HQ mode from ${req.ip}`);
        res.setHeader('WWW-Authenticate', 'Basic realm="VibeTunnel"');
        return res.status(401).json({ error: 'Bearer token not accepted in HQ mode' });
      } else if (config.bearerToken && token === config.bearerToken) {
        // Token matches what this remote server expects from HQ
        logger.log(chalk.green(`authenticated via bearer token from ${req.ip}`));
        return next();
      } else if (config.bearerToken) {
        // We have a bearer token configured but it doesn't match
        logger.warn(`invalid bearer token from ${req.ip}`);
      }
    }

    // Check Basic auth
    if (authHeader && authHeader.startsWith('Basic ')) {
      const base64Credentials = authHeader.substring(6);
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
      const [username, password] = credentials.split(':');

      // If no username is configured, accept any username as long as password matches
      // This allows for password-only authentication mode
      if (!config.basicAuthUsername) {
        // Password-only mode: ignore username, only check password
        if (password === config.basicAuthPassword) {
          logger.log(chalk.green(`authenticated via password-only mode from ${req.ip}`));
          return next();
        } else {
          logger.warn(`failed password-only auth attempt from ${req.ip}`);
        }
      } else {
        // Username+password mode: check both
        if (username === config.basicAuthUsername && password === config.basicAuthPassword) {
          return next();
        } else {
          logger.warn(`failed basic auth attempt from ${req.ip} for user: ${username}`);
        }
      }
    }

    // No valid auth provided
    logger.warn(`unauthorized request to ${req.method} ${req.path} from ${req.ip}`);
    res.setHeader('WWW-Authenticate', 'Basic realm="VibeTunnel"');
    res.status(401).json({ error: 'Authentication required' });
  };
}
