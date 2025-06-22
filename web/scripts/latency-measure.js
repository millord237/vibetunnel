#!/usr/bin/env node

/**
 * Precise latency measurement for terminal rendering
 * 
 * This script outputs timestamped markers to measure actual end-to-end latency
 */

const MARKER = '█';
const INTERVAL = 100; // 100ms intervals for easier measurement

console.log('Latency measurement test - watch for delay between timestamp and display\n');

let count = 0;
const startTime = Date.now();

const interval = setInterval(() => {
  count++;
  const now = Date.now();
  const elapsed = now - startTime;
  const timestamp = new Date(now).toISOString().split('T')[1].slice(0, -1);
  
  // Output with high-precision timestamp
  console.log(`[${count.toString().padStart(3, '0')}] ${timestamp} ${MARKER.repeat(10)} MARKER`);
  
  // Flush stdout to ensure immediate output
  if (process.stdout.isTTY) {
    process.stdout.write('');
  }
  
  if (count >= 50) { // 5 seconds of data
    clearInterval(interval);
    console.log('\nTest complete. Compare the timestamps with when you see them appear.');
    console.log('The difference is your end-to-end latency.');
    process.exit(0);
  }
}, INTERVAL);

// Also test immediate response to keypress
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (data) => {
    const key = data.toString();
    const now = Date.now();
    const timestamp = new Date(now).toISOString().split('T')[1].slice(0, -1);
    
    if (key === '\x03') { // Ctrl+C
      clearInterval(interval);
      process.exit(0);
    }
    
    console.log(`[KEY] ${timestamp} You pressed: ${key.charCodeAt(0)} ${MARKER.repeat(20)}`);
  });
}

console.log('Press any key to test input latency (Ctrl+C to exit)\n');