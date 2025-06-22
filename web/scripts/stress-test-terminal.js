#!/usr/bin/env node

/**
 * Terminal stress test script for measuring rendering latency
 * 
 * Usage: node stress-test-terminal.js [options]
 * 
 * Options:
 *   --mode <mode>     Test mode: rapid, burst, mixed, ansi (default: mixed)
 *   --duration <ms>   Test duration in milliseconds (default: 10000)
 *   --delay <ms>      Delay between outputs in rapid mode (default: 10)
 *   --burst-size <n>  Number of lines per burst (default: 50)
 *   --burst-delay <ms> Delay between bursts (default: 100)
 */

const args = process.argv.slice(2);
const options = {
  mode: 'mixed',
  duration: 10000,
  delay: 10,
  burstSize: 50,
  burstDelay: 100
};

// Parse command line arguments
for (let i = 0; i < args.length; i += 2) {
  const arg = args[i];
  const value = args[i + 1];
  
  switch (arg) {
    case '--mode':
      options.mode = value;
      break;
    case '--duration':
      options.duration = parseInt(value);
      break;
    case '--delay':
      options.delay = parseInt(value);
      break;
    case '--burst-size':
      options.burstSize = parseInt(value);
      break;
    case '--burst-delay':
      options.burstDelay = parseInt(value);
      break;
  }
}

// ANSI color codes
const colors = [
  '\x1b[31m', // red
  '\x1b[32m', // green
  '\x1b[33m', // yellow
  '\x1b[34m', // blue
  '\x1b[35m', // magenta
  '\x1b[36m', // cyan
  '\x1b[37m', // white
];

const reset = '\x1b[0m';
const bold = '\x1b[1m';
const clearLine = '\x1b[2K\r';

let startTime = Date.now();
let lineCount = 0;
let byteCount = 0;

// Helper to generate timestamp
function timestamp() {
  return new Date().toISOString().split('T')[1].slice(0, -1);
}

// Helper to track output
function output(str) {
  process.stdout.write(str);
  lineCount += (str.match(/\n/g) || []).length;
  byteCount += Buffer.byteLength(str);
}

// Test 1: Rapid single character output
function rapidTest() {
  const interval = setInterval(() => {
    const char = String.fromCharCode(33 + Math.floor(Math.random() * 94));
    output(char);
    
    if (Date.now() - startTime > options.duration) {
      clearInterval(interval);
      showStats();
    }
  }, options.delay);
}

// Test 2: Burst output
function burstTest() {
  const interval = setInterval(() => {
    const burst = [];
    for (let i = 0; i < options.burstSize; i++) {
      burst.push(`[${timestamp()}] Line ${lineCount + i}: ${generateRandomData()}\n`);
    }
    output(burst.join(''));
    
    if (Date.now() - startTime > options.duration) {
      clearInterval(interval);
      showStats();
    }
  }, options.burstDelay);
}

// Test 3: Mixed output with ANSI codes
function mixedTest() {
  let mode = 0;
  const interval = setInterval(() => {
    mode = (mode + 1) % 4;
    
    switch (mode) {
      case 0: // Progress bar
        const progress = Math.floor((Date.now() - startTime) / options.duration * 50);
        output(clearLine + '[' + '█'.repeat(progress) + ' '.repeat(50 - progress) + '] ' + 
               Math.floor(progress * 2) + '%');
        break;
        
      case 1: // Colored text
        const color = colors[Math.floor(Math.random() * colors.length)];
        output(`${color}${timestamp()} Colored output test${reset}\n`);
        break;
        
      case 2: // Large block
        const block = generateRandomData(200);
        output(`${bold}[BLOCK]${reset} ${block}\n`);
        break;
        
      case 3: // Rapid characters
        for (let i = 0; i < 10; i++) {
          output(String.fromCharCode(33 + Math.floor(Math.random() * 94)));
        }
        output('\n');
        break;
    }
    
    if (Date.now() - startTime > options.duration) {
      clearInterval(interval);
      output('\n');
      showStats();
    }
  }, options.delay);
}

// Test 4: Heavy ANSI sequences
function ansiTest() {
  const interval = setInterval(() => {
    // Random cursor movements
    const row = Math.floor(Math.random() * 20) + 1;
    const col = Math.floor(Math.random() * 80) + 1;
    output(`\x1b[${row};${col}H`);
    
    // Random color and style
    const color = colors[Math.floor(Math.random() * colors.length)];
    const style = Math.random() > 0.5 ? bold : '';
    
    // Output colored character
    output(`${style}${color}█${reset}`);
    
    // Occasional screen operations
    if (Math.random() > 0.95) {
      output('\x1b[2J'); // Clear screen
    }
    
    if (Date.now() - startTime > options.duration) {
      clearInterval(interval);
      output('\x1b[24;1H\n'); // Move to bottom
      showStats();
    }
  }, options.delay);
}

// Generate random data
function generateRandomData(length = 80) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Show statistics
function showStats() {
  const duration = Date.now() - startTime;
  const linesPerSecond = (lineCount / duration * 1000).toFixed(2);
  const bytesPerSecond = (byteCount / duration * 1000).toFixed(0);
  const kbPerSecond = (bytesPerSecond / 1024).toFixed(2);
  
  output(`\n${bold}=== Stress Test Complete ===${reset}\n`);
  output(`Mode: ${options.mode}\n`);
  output(`Duration: ${duration}ms\n`);
  output(`Lines output: ${lineCount}\n`);
  output(`Bytes output: ${byteCount} (${kbPerSecond} KB/s)\n`);
  output(`Lines per second: ${linesPerSecond}\n`);
  output(`\nTo measure latency, compare visual output timing with timestamps.\n`);
  output(`Run with different modes to test various scenarios:\n`);
  output(`  --mode rapid    Fast single character output\n`);
  output(`  --mode burst    Burst of lines at intervals\n`);
  output(`  --mode mixed    Mix of different output types\n`);
  output(`  --mode ansi     Heavy ANSI escape sequences\n`);
  process.exit(0);
}

// Start message
output(`${bold}Starting ${options.mode} stress test for ${options.duration}ms...${reset}\n\n`);

// Run selected test
switch (options.mode) {
  case 'rapid':
    rapidTest();
    break;
  case 'burst':
    burstTest();
    break;
  case 'ansi':
    ansiTest();
    break;
  case 'mixed':
  default:
    mixedTest();
    break;
}