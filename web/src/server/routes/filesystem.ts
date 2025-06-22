import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import mime from 'mime-types';
import { createReadStream, statSync } from 'fs';

const execAsync = promisify(exec);

interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions?: string;
  isGitTracked?: boolean;
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged';
}

interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
}

export function createFilesystemRoutes(): Router {
  const router = Router();

  // Helper to check if path is safe (no directory traversal)
  function isPathSafe(requestedPath: string, basePath: string): boolean {
    const resolved = path.resolve(basePath, requestedPath);
    return resolved.startsWith(path.resolve(basePath));
  }

  // Helper to get Git status for a directory
  async function getGitStatus(dirPath: string): Promise<GitStatus | null> {
    try {
      // Check if directory is a git repository
      await execAsync('git rev-parse --git-dir', { cwd: dirPath });

      // Get current branch
      const { stdout: branch } = await execAsync('git branch --show-current', { cwd: dirPath });

      // Get status
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: dirPath });

      const status: GitStatus = {
        isGitRepo: true,
        branch: branch.trim(),
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
      };

      // Parse git status output
      statusOutput.split('\n').forEach((line) => {
        if (!line) return;

        const statusCode = line.substring(0, 2);
        const filename = line.substring(3);

        if (statusCode === ' M' || statusCode === 'M ' || statusCode === 'MM') {
          status.modified.push(filename);
        } else if (statusCode === 'A ' || statusCode === 'AM') {
          status.added.push(filename);
        } else if (statusCode === ' D' || statusCode === 'D ') {
          status.deleted.push(filename);
        } else if (statusCode === '??') {
          status.untracked.push(filename);
        }
      });

      return status;
    } catch {
      return null;
    }
  }

  // Helper to get file Git status
  function getFileGitStatus(filePath: string, gitStatus: GitStatus | null): FileInfo['gitStatus'] {
    if (!gitStatus) return undefined;

    const relativePath = path.relative(process.cwd(), filePath);

    if (gitStatus.modified.includes(relativePath)) return 'modified';
    if (gitStatus.added.includes(relativePath)) return 'added';
    if (gitStatus.deleted.includes(relativePath)) return 'deleted';
    if (gitStatus.untracked.includes(relativePath)) return 'untracked';

    return 'unchanged';
  }

  // Browse directory endpoint
  router.get('/fs/browse', async (req: Request, res: Response) => {
    try {
      const requestedPath = (req.query.path as string) || '.';
      const showHidden = req.query.showHidden === 'true';
      const gitFilter = req.query.gitFilter as string; // 'all' | 'changed' | 'none'

      // Security check
      if (!isPathSafe(requestedPath, process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.resolve(process.cwd(), requestedPath);

      // Check if path exists and is a directory
      const stats = await fs.stat(fullPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }

      // Get Git status if requested
      const gitStatus = gitFilter !== 'none' ? await getGitStatus(fullPath) : null;

      // Read directory contents
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      // Build file list
      const files: FileInfo[] = await Promise.all(
        entries
          .filter((entry) => showHidden || !entry.name.startsWith('.'))
          .map(async (entry) => {
            const entryPath = path.join(fullPath, entry.name);
            const stats = await fs.stat(entryPath);
            const relativePath = path.relative(process.cwd(), entryPath);

            const fileInfo: FileInfo = {
              name: entry.name,
              path: relativePath,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: stats.mtime.toISOString(),
              permissions: stats.mode.toString(8).slice(-3),
              isGitTracked: gitStatus?.isGitRepo || false,
              gitStatus: getFileGitStatus(entryPath, gitStatus),
            };

            return fileInfo;
          })
      );

      // Filter by Git status if requested
      let filteredFiles = files;
      if (gitFilter === 'changed' && gitStatus) {
        filteredFiles = files.filter((file) => file.gitStatus && file.gitStatus !== 'unchanged');
      }

      // Sort: directories first, then by name
      filteredFiles.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      res.json({
        path: requestedPath,
        fullPath,
        gitStatus,
        files: filteredFiles,
      });
    } catch (error) {
      console.error('Browse error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get file preview
  router.get('/fs/preview', async (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;
      if (!requestedPath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check
      if (!isPathSafe(requestedPath, process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.resolve(process.cwd(), requestedPath);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        return res.status(400).json({ error: 'Cannot preview directories' });
      }

      // Determine file type
      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
      const isText =
        mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/javascript' ||
        mimeType === 'application/typescript' ||
        mimeType === 'application/xml';
      const isImage = mimeType.startsWith('image/');

      if (isImage) {
        // For images, return URL to fetch the image
        res.json({
          type: 'image',
          mimeType,
          url: `/api/fs/raw?path=${encodeURIComponent(requestedPath)}`,
          size: stats.size,
        });
      } else if (isText || stats.size < 1024 * 1024) {
        // Text or small files (< 1MB)
        const content = await fs.readFile(fullPath, 'utf-8');
        const language = getLanguageFromPath(fullPath);

        res.json({
          type: 'text',
          content,
          language,
          mimeType,
          size: stats.size,
        });
      } else {
        // Binary or large files
        res.json({
          type: 'binary',
          mimeType,
          size: stats.size,
          humanSize: formatBytes(stats.size),
        });
      }
    } catch (error) {
      console.error('Preview error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Serve raw file content
  router.get('/fs/raw', (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;
      if (!requestedPath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check
      if (!isPathSafe(requestedPath, process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.resolve(process.cwd(), requestedPath);

      // Check if file exists
      if (!statSync(fullPath).isFile()) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Set appropriate content type
      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);

      // Stream the file
      const stream = createReadStream(fullPath);
      stream.pipe(res);
    } catch (error) {
      console.error('Raw file error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get file content (text files only)
  router.get('/fs/content', async (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;
      if (!requestedPath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check
      if (!isPathSafe(requestedPath, process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.resolve(process.cwd(), requestedPath);
      const content = await fs.readFile(fullPath, 'utf-8');

      res.json({
        path: requestedPath,
        content,
        language: getLanguageFromPath(fullPath),
      });
    } catch (error) {
      console.error('Content error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get Git diff for a file
  router.get('/fs/diff', async (req: Request, res: Response) => {
    try {
      const requestedPath = req.query.path as string;
      if (!requestedPath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      // Security check
      if (!isPathSafe(requestedPath, process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.resolve(process.cwd(), requestedPath);
      const relativePath = path.relative(process.cwd(), fullPath);

      // Get git diff
      const { stdout: diff } = await execAsync(`git diff HEAD -- "${relativePath}"`, {
        cwd: process.cwd(),
      });

      res.json({
        path: requestedPath,
        diff,
        hasDiff: diff.length > 0,
      });
    } catch (error) {
      console.error('Diff error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Create directory
  router.post('/fs/mkdir', async (req: Request, res: Response) => {
    try {
      const { path: dirPath, name } = req.body;

      if (!dirPath || !name) {
        return res.status(400).json({ error: 'Path and name are required' });
      }

      // Validate name (no slashes, no dots at start)
      if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
        return res.status(400).json({ error: 'Invalid directory name' });
      }

      // Security check
      if (!isPathSafe(dirPath, process.cwd())) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fullPath = path.resolve(process.cwd(), dirPath, name);

      // Create directory
      await fs.mkdir(fullPath, { recursive: true });

      res.json({
        success: true,
        path: path.relative(process.cwd(), fullPath),
      });
    } catch (error) {
      console.error('Mkdir error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

// Helper function to determine language from file path
function getLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.m': 'objective-c',
    '.mm': 'objective-c',
    '.h': 'c',
    '.hpp': 'cpp',
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.fish': 'shell',
    '.ps1': 'powershell',
    '.html': 'html',
    '.htm': 'html',
    '.xml': 'xml',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.ini': 'ini',
    '.cfg': 'ini',
    '.conf': 'ini',
    '.sql': 'sql',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.tex': 'latex',
    '.dockerfile': 'dockerfile',
    '.makefile': 'makefile',
    '.cmake': 'cmake',
    '.gradle': 'gradle',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.elm': 'elm',
    '.clj': 'clojure',
    '.cljs': 'clojure',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.erl': 'erlang',
    '.hrl': 'erlang',
    '.fs': 'fsharp',
    '.fsx': 'fsharp',
    '.fsi': 'fsharp',
    '.ml': 'ocaml',
    '.mli': 'ocaml',
    '.pas': 'pascal',
    '.pp': 'pascal',
    '.pl': 'perl',
    '.pm': 'perl',
    '.t': 'perl',
    '.lua': 'lua',
    '.dart': 'dart',
    '.nim': 'nim',
    '.nims': 'nim',
    '.zig': 'zig',
    '.jl': 'julia',
  };

  return languageMap[ext] || 'plaintext';
}

// Helper function to format bytes
function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
