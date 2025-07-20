/**
 * Environment Sanitizer
 * 
 * Ensures the development environment is properly configured and prevents
 * conflicts with production SEA (Single Executable Application) mode.
 */

import { createLogger } from './logger.js';
import { existsSync } from 'fs';
import { join } from 'path';

const logger = createLogger('environment-sanitizer');

interface EnvironmentIssue {
  variable: string;
  issue: string;
  solution: string;
  fixed: boolean;
}

export class EnvironmentSanitizer {
  private issues: EnvironmentIssue[] = [];
  
  /**
   * Check and fix all environment issues
   */
  public sanitize(): void {
    logger.log('🔍 Checking environment configuration...');
    
    // Check VIBETUNNEL_SEA variable
    this.checkVibeTunnelSEA();
    
    // Check NODE_ENV
    this.checkNodeEnv();
    
    // Check native module paths
    this.checkNativeModulePaths();
    
    // Check for conflicting environment variables
    this.checkConflictingVars();
    
    // Report results
    this.reportResults();
  }
  
  /**
   * Check and fix VIBETUNNEL_SEA variable
   */
  private checkVibeTunnelSEA(): void {
    if (process.env.VIBETUNNEL_SEA) {
      const issue: EnvironmentIssue = {
        variable: 'VIBETUNNEL_SEA',
        issue: `VIBETUNNEL_SEA is set to '${process.env.VIBETUNNEL_SEA}' which causes native modules to load from wrong location`,
        solution: 'Removing VIBETUNNEL_SEA for development mode',
        fixed: false
      };
      
      // Fix it
      delete process.env.VIBETUNNEL_SEA;
      issue.fixed = true;
      
      this.issues.push(issue);
      logger.warn(`⚠️  Fixed: ${issue.solution}`);
    }
  }
  
  /**
   * Check NODE_ENV is appropriate for development
   */
  private checkNodeEnv(): void {
    if (process.env.NODE_ENV === 'production' && !process.env.VIBETUNNEL_BUILD) {
      const issue: EnvironmentIssue = {
        variable: 'NODE_ENV',
        issue: 'NODE_ENV is set to production in development environment',
        solution: 'Setting NODE_ENV to development',
        fixed: false
      };
      
      // Fix it
      process.env.NODE_ENV = 'development';
      issue.fixed = true;
      
      this.issues.push(issue);
      logger.warn(`⚠️  Fixed: ${issue.solution}`);
    }
  }
  
  /**
   * Check native module paths exist
   */
  private checkNativeModulePaths(): void {
    const modulesToCheck = [
      {
        name: 'node-pty',
        paths: [
          'node_modules/.pnpm/node-pty@file+node-pty/node_modules/node-pty/build/Release/pty.node',
          'node_modules/node-pty/build/Release/pty.node',
          'node-pty/build/Release/pty.node'
        ]
      }
    ];
    
    for (const module of modulesToCheck) {
      let found = false;
      let foundPath = '';
      
      for (const path of module.paths) {
        const fullPath = join(process.cwd(), path);
        if (existsSync(fullPath)) {
          found = true;
          foundPath = path;
          break;
        }
      }
      
      if (!found) {
        const issue: EnvironmentIssue = {
          variable: 'PATH',
          issue: `Native module ${module.name} not found in expected locations`,
          solution: 'Run "pnpm install" to rebuild native modules',
          fixed: false
        };
        this.issues.push(issue);
      } else {
        logger.debug(`✓ Found ${module.name} at ${foundPath}`);
      }
    }
  }
  
  /**
   * Check for other conflicting environment variables
   */
  private checkConflictingVars(): void {
    const conflictingVars = [
      'ELECTRON_RUN_AS_NODE',
      'NODE_OPTIONS',
      'NODE_PATH'
    ];
    
    for (const varName of conflictingVars) {
      if (process.env[varName]) {
        logger.debug(`ℹ️  ${varName} is set to: ${process.env[varName]}`);
      }
    }
  }
  
  /**
   * Report sanitization results
   */
  private reportResults(): void {
    if (this.issues.length === 0) {
      logger.log('✅ Environment is properly configured');
      return;
    }
    
    logger.log(`🔧 Fixed ${this.issues.filter(i => i.fixed).length} environment issues:`);
    
    for (const issue of this.issues) {
      if (issue.fixed) {
        logger.log(`  ✓ ${issue.variable}: ${issue.solution}`);
      } else {
        logger.warn(`  ⚠️  ${issue.variable}: ${issue.issue}`);
        logger.warn(`      Solution: ${issue.solution}`);
      }
    }
  }
  
  /**
   * Get a clean environment for spawning child processes
   */
  public static getCleanEnvironment(): NodeJS.ProcessEnv {
    const cleanEnv = { ...process.env };
    
    // Remove problematic variables
    delete cleanEnv.VIBETUNNEL_SEA;
    
    // Ensure development mode
    if (!cleanEnv.NODE_ENV || cleanEnv.NODE_ENV === 'production') {
      cleanEnv.NODE_ENV = 'development';
    }
    
    return cleanEnv;
  }
  
  /**
   * Create a diagnostic report
   */
  public static getDiagnosticReport(): string {
    const report: string[] = [
      '=== VibeTunnel Environment Diagnostic Report ===',
      '',
      `Date: ${new Date().toISOString()}`,
      `Platform: ${process.platform}`,
      `Node Version: ${process.version}`,
      `Current Directory: ${process.cwd()}`,
      '',
      '=== Environment Variables ===',
      `NODE_ENV: ${process.env.NODE_ENV || 'not set'}`,
      `VIBETUNNEL_SEA: ${process.env.VIBETUNNEL_SEA || 'not set'}`,
      `PATH: ${process.env.PATH?.split(':').slice(0, 3).join(':')}... (truncated)`,
      '',
      '=== Native Module Check ===',
    ];
    
    // Check for node-pty
    const ptyPaths = [
      'node_modules/.pnpm/node-pty@file+node-pty/node_modules/node-pty/build/Release/pty.node',
      'node_modules/node-pty/build/Release/pty.node'
    ];
    
    for (const path of ptyPaths) {
      const exists = existsSync(join(process.cwd(), path));
      report.push(`${exists ? '✓' : '✗'} ${path}`);
    }
    
    report.push('', '=== End of Report ===');
    
    return report.join('\n');
  }
}

// Export singleton instance
export const environmentSanitizer = new EnvironmentSanitizer();