# Frontend Logging Update Prompt

## Context
We've just implemented a structured logging system for the server-side code and created endpoints for frontend logging. Now we need to update all frontend components to use this system instead of console.log/error/warn.

## What's Already Done
1. **Server-side logging**: All server files now use the structured logger with proper log levels
2. **Log endpoints created**: 
   - `POST /api/logs/client` - Frontend can send logs to this endpoint
   - The endpoint expects: `{ level: 'log'|'warn'|'error'|'debug', module: string, args: unknown[] }`
3. **Log viewer component**: Available at `/logs.html` to view all logs (both server and client)
4. **Style guide**: Created in `LOGGING_STYLE_GUIDE.md` with rules:
   - No colors in error/warn
   - Colors only in logger.log (green=success, yellow=warning, blue=info, gray=metadata)
   - No prefixes or tags
   - Lowercase start, no periods
   - Always include error objects

## Your Task
Replace all `console.log`, `console.error`, and `console.warn` calls in frontend code (`src/client/`) with API calls to the logging endpoint.

### Step 1: Create a Frontend Logger Utility
Create `/src/client/utils/logger.ts` with:
```typescript
export function createLogger(moduleName: string) {
  const sendLog = async (level: string, ...args: unknown[]) => {
    try {
      await fetch('/api/logs/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, module: moduleName, args })
      });
    } catch {
      // Fallback to console on network error
      console[level]?.(...args) || console.log(...args);
    }
  };

  return {
    log: (...args: unknown[]) => sendLog('log', ...args),
    warn: (...args: unknown[]) => sendLog('warn', ...args),
    error: (...args: unknown[]) => sendLog('error', ...args),
    debug: (...args: unknown[]) => sendLog('debug', ...args)
  };
}
```

### Step 2: Find All Console Calls
Use ripgrep to find all console.log/error/warn in frontend:
```bash
rg "console\.(log|error|warn)" src/client/ --type ts
```

### Step 3: Update Each File
For each file with console calls:
1. Import the logger: `import { createLogger } from '../utils/logger.js';`
2. Create logger instance: `const logger = createLogger('component-name');`
3. Replace console calls following the style guide
4. Remove superfluous logs (like "View transition ready")
5. Ensure essential logs use appropriate levels

### Step 4: Special Cases
- For error boundaries and critical failures, you may keep console.error as fallback
- WebSocket/SSE error handling should use logger but can keep console as fallback
- Remove all debug console.logs that were for development (like view transition logs)

### Step 5: Test
After updates, verify:
1. Navigate to `/logs.html` 
2. Perform actions in the app
3. Confirm client logs appear with `CLIENT:` prefix
4. Check that log levels and messages follow the style guide

## Files to Update (based on previous analysis)
Key files that likely have console calls:
- `/src/client/app.ts`
- `/src/client/services/terminal-connection.ts`
- `/src/client/services/sse-client.ts`
- `/src/client/services/websocket-client.ts`
- `/src/client/components/*.ts` (all component files)
- Any other files in `/src/client/`

## Remember
- Module names should be descriptive (e.g., 'terminal-connection', 'session-list', 'app')
- Follow the same style guide as server logs (no prefixes, lowercase start)
- Essential logs only - remove debugging/development logs
- Include error objects when logging errors