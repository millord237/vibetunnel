const { spawn } = require('child_process');
const path = require('path');

console.log('Starting development mode...');

// Determine what to watch based on arguments
const watchServer = !process.argv.includes('--client-only');

// Initial build of assets and CSS
console.log('Initial build...');
require('child_process').execSync('node scripts/ensure-dirs.js', { stdio: 'inherit' });
require('child_process').execSync('node scripts/copy-assets.js', { stdio: 'inherit' });
require('child_process').execSync('npx tailwindcss -i ./src/client/styles.css -o ./public/bundle/styles.css', { stdio: 'inherit' });

// Build the command parts
const commands = [
  // Watch CSS
  ['npx', ['tailwindcss', '-i', './src/client/styles.css', '-o', './public/bundle/styles.css', '--watch']],
  // Watch assets
  ['npx', ['chokidar', 'src/client/assets/**/*', '-c', 'node scripts/copy-assets.js']],
  // Watch client bundle
  ['node', ['scripts/watch-client.js']],
  // Watch test bundle
  ['npx', ['esbuild', 'src/client/test-terminals-entry.ts', '--bundle', '--outfile=public/bundle/terminal.js', '--format=esm', '--sourcemap', '--watch']]
];

// Add server watching if not client-only
if (watchServer) {
  commands.push(['npx', ['tsx', 'watch', 'src/cli.ts']]);
}

// Start all processes
const processes = commands.map(([cmd, args], index) => {
  const proc = spawn(cmd, args, { 
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  
  proc.on('error', (err) => {
    console.error(`Process ${index} error:`, err);
  });
  
  return proc;
});

// Handle exit
process.on('SIGINT', () => {
  console.log('\nStopping all processes...');
  processes.forEach(proc => proc.kill());
  process.exit(0);
});

console.log(`Development mode started (${watchServer ? 'full' : 'client only'})`);