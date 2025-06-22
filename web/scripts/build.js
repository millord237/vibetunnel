const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Starting build process...');

// Ensure directories exist
console.log('Creating directories...');
execSync('node scripts/ensure-dirs.js', { stdio: 'inherit' });

// Copy assets
console.log('Copying assets...');
execSync('node scripts/copy-assets.js', { stdio: 'inherit' });

// Build CSS
console.log('Building CSS...');
execSync('node node_modules/tailwindcss/lib/cli.js -i ./src/client/styles.css -o ./public/bundle/styles.css --minify', { stdio: 'inherit' });

// Bundle client JavaScript
console.log('Bundling client JavaScript...');
process.env.NODE_ENV = 'production';
execSync('node scripts/build-client.js', { stdio: 'inherit' });
execSync('./node_modules/esbuild/bin/esbuild src/client/test-terminals-entry.ts --bundle --outfile=public/bundle/terminal.js --format=esm --minify', { stdio: 'inherit' });

// Build server TypeScript
console.log('Building server...');
execSync('node node_modules/typescript/lib/tsc.js', { stdio: 'inherit' });

// Build native executable
console.log('Building native executable...');

// Check for --custom-node flag
const useCustomNode = process.argv.includes('--custom-node');

if (useCustomNode) {
  console.log('Using custom Node.js for smaller binary size...');
  execSync('node build-native.js --custom-node', { stdio: 'inherit' });
} else {
  console.log('Using system Node.js...');
  execSync('node build-native.js', { stdio: 'inherit' });
}

console.log('Build completed successfully!');