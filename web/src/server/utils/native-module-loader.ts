/**
 * Native Module Loader with Fallback Support
 * 
 * Provides robust loading of native modules with multiple fallback strategies
 * to handle different environments (development, production, SEA mode, etc.)
 */

import { createLogger } from './logger.js';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('native-module-loader');

interface LoaderOptions {
  moduleName: string;
  searchPaths?: string[];
  fallbackLoader?: () => Promise<any>;
}

export class NativeModuleLoader {
  private static cache = new Map<string, any>();
  
  /**
   * Load a native module with fallback support
   */
  public static async load(options: LoaderOptions): Promise<any> {
    const { moduleName, searchPaths = [], fallbackLoader } = options;
    
    // Check cache first
    if (this.cache.has(moduleName)) {
      logger.debug(`Returning cached module: ${moduleName}`);
      return this.cache.get(moduleName);
    }
    
    // Strategy 1: Try normal import first (without VIBETUNNEL_SEA)
    if (!process.env.VIBETUNNEL_SEA) {
      try {
        logger.debug(`Attempting standard import of ${moduleName}`);
        const module = await import(moduleName);
        this.cache.set(moduleName, module);
        logger.log(`✅ Loaded ${moduleName} via standard import`);
        return module;
      } catch (error) {
        logger.debug(`Standard import failed for ${moduleName}:`, error.message);
      }
    }
    
    // Strategy 2: Try with temporarily removed VIBETUNNEL_SEA
    if (process.env.VIBETUNNEL_SEA) {
      const originalSEA = process.env.VIBETUNNEL_SEA;
      try {
        logger.debug(`Attempting import of ${moduleName} with VIBETUNNEL_SEA removed`);
        delete process.env.VIBETUNNEL_SEA;
        const module = await import(moduleName);
        process.env.VIBETUNNEL_SEA = originalSEA;
        this.cache.set(moduleName, module);
        logger.log(`✅ Loaded ${moduleName} after removing VIBETUNNEL_SEA`);
        return module;
      } catch (error) {
        process.env.VIBETUNNEL_SEA = originalSEA;
        logger.debug(`Import with removed SEA failed:`, error.message);
      }
    }
    
    // Strategy 3: Search for native binaries in custom paths
    if (searchPaths.length > 0) {
      for (const searchPath of searchPaths) {
        try {
          const fullPath = join(process.cwd(), searchPath, moduleName);
          if (existsSync(fullPath)) {
            logger.debug(`Attempting to load from custom path: ${fullPath}`);
            const module = await import(fullPath);
            this.cache.set(moduleName, module);
            logger.log(`✅ Loaded ${moduleName} from custom path: ${searchPath}`);
            return module;
          }
        } catch (error) {
          logger.debug(`Custom path import failed:`, error.message);
        }
      }
    }
    
    // Strategy 4: Use fallback loader if provided
    if (fallbackLoader) {
      try {
        logger.debug(`Using fallback loader for ${moduleName}`);
        const module = await fallbackLoader();
        this.cache.set(moduleName, module);
        logger.log(`✅ Loaded ${moduleName} via fallback loader`);
        return module;
      } catch (error) {
        logger.error(`Fallback loader failed:`, error);
      }
    }
    
    // All strategies failed
    throw new Error(`Failed to load native module ${moduleName} after trying all strategies`);
  }
  
  /**
   * Load node-pty with automatic fallback handling
   */
  public static async loadNodePty(): Promise<any> {
    return this.load({
      moduleName: 'node-pty',
      searchPaths: [
        'node_modules/.pnpm/node-pty@file+node-pty/node_modules',
        'node_modules',
        '../node_modules',
        '../../node_modules'
      ],
      fallbackLoader: async () => {
        // Last resort: try to rebuild
        logger.warn('Attempting to rebuild node-pty...');
        const { execSync } = await import('child_process');
        try {
          execSync('pnpm rebuild node-pty', { stdio: 'inherit' });
          return import('node-pty');
        } catch (error) {
          throw new Error('Failed to rebuild node-pty');
        }
      }
    });
  }
  
  /**
   * Clear module cache
   */
  public static clearCache(moduleName?: string): void {
    if (moduleName) {
      this.cache.delete(moduleName);
    } else {
      this.cache.clear();
    }
  }
  
  /**
   * Get diagnostic information about native modules
   */
  public static getDiagnostics(): Record<string, any> {
    const diagnostics: Record<string, any> = {
      environment: {
        VIBETUNNEL_SEA: process.env.VIBETUNNEL_SEA || 'not set',
        NODE_ENV: process.env.NODE_ENV || 'not set',
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      },
      nativeModulePaths: {}
    };
    
    // Check for node-pty
    const ptyPaths = [
      'node_modules/.pnpm/node-pty@file+node-pty/node_modules/node-pty/build/Release/pty.node',
      'node_modules/node-pty/build/Release/pty.node',
      'node-pty/build/Release/pty.node'
    ];
    
    for (const path of ptyPaths) {
      const fullPath = join(process.cwd(), path);
      diagnostics.nativeModulePaths[path] = existsSync(fullPath);
    }
    
    return diagnostics;
  }
}

/**
 * Wrapper for require() that handles SEA mode
 */
export function safeRequire(moduleName: string): any {
  const originalSEA = process.env.VIBETUNNEL_SEA;
  
  try {
    // Remove SEA flag temporarily
    delete process.env.VIBETUNNEL_SEA;
    
    // Use createRequire for ESM compatibility
    const { createRequire } = require('module');
    const customRequire = createRequire(import.meta.url || __filename);
    const module = customRequire(moduleName);
    
    // Restore SEA flag
    if (originalSEA) {
      process.env.VIBETUNNEL_SEA = originalSEA;
    }
    
    return module;
  } catch (error) {
    // Restore SEA flag on error
    if (originalSEA) {
      process.env.VIBETUNNEL_SEA = originalSEA;
    }
    throw error;
  }
}

// Export singleton instance for convenience
export const nativeModuleLoader = new NativeModuleLoader();