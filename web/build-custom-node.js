#!/usr/bin/env node

/**
 * Build a custom Node.js binary with reduced size by excluding features we don't need.
 * 
 * See custom-node-build-flags.md for detailed documentation and size optimization results.
 * 
 * Quick usage:
 *   node build-custom-node.js               # Builds Node.js 24.2.0 (recommended)
 *   node build-custom-node.js --latest      # Latest version
 *   node build-custom-node.js --version=24.2.0  # Specific version
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Parse command line arguments
const args = process.argv.slice(2);
let targetVersion = null;
let useLatest = false;

for (const arg of args) {
  if (arg.startsWith('--version=')) {
    targetVersion = arg.split('=')[1];
  } else if (arg === '--latest') {
    useLatest = true;
  }
}

// Helper to download files
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// Helper to get latest Node.js version
async function getLatestNodeVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://nodejs.org/dist/latest/SHASUMS256.txt', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Extract version from first line like: "1234567890abcdef  node-v24.2.0-darwin-arm64.tar.gz"
        const match = data.match(/node-v(\d+\.\d+\.\d+)/);
        if (match) {
          resolve(match[1]);
        } else {
          reject(new Error('Could not determine latest Node.js version'));
        }
      });
    }).on('error', reject);
  });
}

async function buildCustomNode() {
  // Determine version to build
  let nodeSourceVersion;
  if (useLatest) {
    console.log('Fetching latest Node.js version...');
    nodeSourceVersion = await getLatestNodeVersion();
    console.log(`Latest Node.js version: ${nodeSourceVersion}`);
  } else if (targetVersion) {
    nodeSourceVersion = targetVersion;
  } else {
    // Default to Node.js 24.2.0 (recommended version)
    nodeSourceVersion = '24.2.0';
  }
  
  console.log(`Building custom Node.js ${nodeSourceVersion} with all feature removals (-Os)...`);
  console.log('This will take 10-20 minutes on first run, but will be cached for future builds.');
  
  const nodeSourceUrl = `https://nodejs.org/dist/v${nodeSourceVersion}/node-v${nodeSourceVersion}.tar.gz`;
  const majorVersion = nodeSourceVersion.split('.')[0];
  
  const buildDir = path.join(__dirname, '.node-builds');
  const versionDir = path.join(buildDir, `node-v${nodeSourceVersion}-minimal`);
  const markerFile = path.join(versionDir, '.build-complete');
  const customNodePath = path.join(versionDir, 'out', 'Release', 'node');
  
  // Check if already built
  if (fs.existsSync(markerFile) && fs.existsSync(customNodePath)) {
    console.log(`Using cached custom Node.js build from ${customNodePath}`);
    const stats = fs.statSync(customNodePath);
    console.log(`Cached custom Node.js size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`\nTo use this custom Node.js with build-native.js:`);
    console.log(`node build-native.js --custom-node="${customNodePath}"`);
    return customNodePath;
  }
  
  // Create build directory
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }
  
  // Clean up old version directory if exists
  if (fs.existsSync(versionDir)) {
    console.log('Cleaning up incomplete build...');
    fs.rmSync(versionDir, { recursive: true, force: true });
  }
  
  const tarPath = path.join(buildDir, `node-v${nodeSourceVersion}.tar.gz`);
  const originalCwd = process.cwd();
  
  try {
    // Download Node.js source if not cached
    if (!fs.existsSync(tarPath)) {
      console.log(`Downloading Node.js source from ${nodeSourceUrl}...`);
      await downloadFile(nodeSourceUrl, tarPath);
    }
    
    // Extract source
    console.log('Extracting Node.js source...');
    execSync(`tar -xzf "${tarPath}" -C "${buildDir}"`, { stdio: 'inherit' });
    
    // Rename to version-specific directory
    const extractedDir = path.join(buildDir, `node-v${nodeSourceVersion}`);
    fs.renameSync(extractedDir, versionDir);
    
    // Configure and build
    process.chdir(versionDir);
    
    console.log('Configuring Node.js build (all feature removals, -Os only)...');
    const configureArgs = [
      '--without-intl',  // Remove internationalization support
      '--without-npm',   // Don't include npm
      '--without-corepack', // Don't include corepack
      '--without-inspector', // Remove debugging/profiling features
      '--without-node-code-cache', // Disable code cache
      '--without-node-snapshot',  // Don't create/use startup snapshot
      '--ninja',  // Use ninja if available for faster builds
    ];
    
    // Use -Os optimization which is proven to be safe
    process.env.CFLAGS = '-Os';
    process.env.CXXFLAGS = '-Os';
    // Clear LDFLAGS to avoid any issues
    delete process.env.LDFLAGS;
    
    // Check if ninja is available, install if not
    try {
      execSync('which ninja', { stdio: 'ignore' });
      console.log('Using Ninja for faster builds...');
    } catch {
      console.log('Ninja not found, installing via Homebrew...');
      try {
        execSync('brew install ninja', { stdio: 'inherit' });
        console.log('Ninja installed successfully');
      } catch (brewError) {
        console.log('Failed to install ninja, falling back to Make...');
        // Remove --ninja if not available
        configureArgs.pop();
      }
    }
    
    execSync(`./configure ${configureArgs.join(' ')}`, { stdio: 'inherit' });
    
    console.log('Building Node.js (this will take a while)...');
    const cores = require('os').cpus().length;
    
    // Check if we're using ninja or make
    const buildSystem = configureArgs.includes('--ninja') ? 'ninja' : 'make';
    if (buildSystem === 'ninja') {
      execSync(`ninja -C out/Release -j ${cores}`, { stdio: 'inherit' });
    } else {
      execSync(`make -j${cores}`, { stdio: 'inherit' });
    }
    
    // Verify the build
    if (!fs.existsSync(customNodePath)) {
      throw new Error('Node.js build failed - binary not found');
    }
    
    // Strip the binary
    console.log('Stripping Node.js binary...');
    execSync(`strip -S "${customNodePath}"`, { stdio: 'inherit' });
    
    // Check final size
    const stats = fs.statSync(customNodePath);
    console.log(`\n✅ Custom Node.js built successfully!`);
    console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Compare with system Node.js
    try {
      const systemNodeStats = fs.statSync(process.execPath);
      const reduction = ((systemNodeStats.size - stats.size) / systemNodeStats.size * 100).toFixed(1);
      console.log(`Size reduction: ${reduction}% compared to system Node.js`);
    } catch (e) {
      // Ignore if we can't stat system node
    }
    
    // Mark build as complete
    fs.writeFileSync(markerFile, JSON.stringify({
      version: nodeSourceVersion,
      buildDate: new Date().toISOString(),
      size: stats.size,
      configureArgs: configureArgs
    }, null, 2));
    
    // Change back to original directory
    process.chdir(originalCwd);
    
    console.log(`\nCustom Node.js location: ${customNodePath}`);
    console.log(`\nTo use this custom Node.js with build-native.js:`);
    console.log(`node build-native.js --custom-node="${customNodePath}"`);
    
    return customNodePath;
    
  } catch (error) {
    process.chdir(originalCwd);
    console.error('Failed to build custom Node.js:', error.message);
    process.exit(1);
  }
}

// Run the build
buildCustomNode().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});