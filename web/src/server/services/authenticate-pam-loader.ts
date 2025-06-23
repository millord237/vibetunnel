import * as path from 'path';
import * as fs from 'fs';

interface AuthenticateFunction {
  (
    username: string,
    password: string,
    callback: (err: Error | null, authenticated?: boolean) => void
  ): void;
}

// Helper function to load native module using dlopen
function loadNativeModule(modulePath: string): { authenticate?: AuthenticateFunction } {
  const module = { exports: {} };
  process.dlopen(module, modulePath);
  return module.exports;
}

// Try to load authenticate_pam.node
let authenticate: AuthenticateFunction;

try {
  // First try the standard require (for development)
  authenticate = require('authenticate-pam');
} catch (_error) {
  // In SEA mode, load from next to the executable
  const possiblePaths = [
    path.join(path.dirname(process.execPath), 'authenticate_pam.node'),
    path.join(path.dirname(process.execPath), 'native', 'authenticate_pam.node'),
    path.join(__dirname, '..', '..', '..', 'native', 'authenticate_pam.node'),
  ];

  let loaded = false;
  for (const modulePath of possiblePaths) {
    if (fs.existsSync(modulePath)) {
      try {
        const nativeModule = loadNativeModule(modulePath);
        if (nativeModule.authenticate) {
          authenticate = nativeModule.authenticate;
        } else {
          throw new Error('Module does not export authenticate function');
        }
        loaded = true;
        break;
      } catch (_loadError) {
        // Continue to next path
      }
    }
  }

  if (!loaded) {
    console.warn(
      'Warning: authenticate-pam native module not found. PAM authentication will not work.'
    );
    // Provide a stub implementation
    authenticate = (
      username: string,
      password: string,
      callback: (err: Error | null, authenticated?: boolean) => void
    ) => {
      callback(new Error('PAM authentication not available'));
    };
  }
}

export { authenticate };
