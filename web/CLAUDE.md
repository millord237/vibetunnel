# Claude Development Notes

After receiving the first user mesage, read spec.md before you proceed. The spec.md contains a map of this code base that should help you navigate it.

**IMPORTANT**: NEVER USE GREP. ALWAYS USE RIPGREP!

## Updating spec.md
As code changes, the spec.md might get outdated. If you detect outdated information, ask the user if they want to regenerate the spec.md file.

### How to regenerate spec.md:
1. Create a todo list to track the analysis tasks
2. Use multiple parallel Task tool calls to analyze:
   - Server architecture (src/server/, authentication, session management)
   - Client architecture (src/client/, components, services)
   - fwd.ts application functionality
   - API endpoints and protocols
   - Binary buffer format and WebSocket implementation
   - HQ mode and distributed architecture
3. Focus on capturing:
   - File locations with key line numbers for important functions
   - Component responsibilities and data flow
   - Protocol specifications and message formats
   - Configuration options and CLI arguments
4. Write a concise spec.md that serves as a navigation map, keeping descriptions brief to minimize token usage
5. Include a "Key Files Quick Reference" section for fast lookup

## Build Process
- **Never run build commands** - the user has `npm run dev` running which handles automatic rebuilds
- Changes to TypeScript files are automatically compiled and watched
- Do not run `npm run build:client` or similar build commands

## Development Workflow
- Make changes to source files in `src/`
- Format, lint and typecheck after you made changes.
    - `npm run format`
    - `npm run lint`
    - `npm run lint:fix`
    - `npm run typecheck`
- Always fix all linting and type checking errors.

## Server Execution
- NEVER RUN THE SERVER YOURSELF, I ALWAYS RUN IT ON THE SIDE VIA NPM RUN DEV!