#!/usr/bin/env node

/**
 * Visual latency test for terminal rendering
 * 
 * This script outputs numbered lines with precise timestamps to help
 * visually measure the delay between output and rendering.
 * 
 * Usage: node latency-test.js [options]
 * 
 * Options:
 *   --rate <ms>       Output rate in milliseconds (default: 100)
 *   --duration <sec>  Test duration in seconds (default: 10)
 *   --mode <mode>     Test mode: counter, clock, bounce (default: counter)
 */

const args = process.argv.slice(2);
const options = {
  rate: 100,
  duration: 10,
  mode: 'counter'
};

// Parse arguments
for (let i = 0; i < args.length; i += 2) {
  const arg = args[i];
  const value = args[i + 1];
  
  switch (arg) {
    case '--rate':
      options.rate = parseInt(value);
      break;
    case '--duration':
      options.duration = parseInt(value);
      break;
    case '--mode':
      options.mode = value;
      break;
  }
}

// ANSI codes
const clearLine = '\x1b[2K\r';
const bold = '\x1b[1m';
const reset = '\x1b[0m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';

let count = 0;
const startTime = Date.now();

// Mode 1: Simple counter with timestamps
function counterMode() {
  const interval = setInterval(() => {
    count++;
    const now = Date.now();
    const elapsed = now - startTime;
    const timestamp = new Date(now).toISOString().split('T')[1].slice(0, -1);
    
    // Output with millisecond precision
    console.log(`${bold}${count.toString().padStart(4, '0')}${reset} | ` +
                `${cyan}${timestamp}${reset} | ` +
                `Elapsed: ${yellow}${elapsed}ms${reset}`);
    
    if (elapsed >= options.duration * 1000) {
      clearInterval(interval);
      showSummary();
    }
  }, options.rate);
}

// Mode 2: Real-time clock
function clockMode() {
  console.log('\n' + bold + 'Real-time Clock Test' + reset);
  console.log('Compare the displayed time with your actual clock:\n');
  
  const interval = setInterval(() => {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0];
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    
    process.stdout.write(clearLine + 
      `${bold}Current Time: ${green}${time}.${ms}${reset} ` +
      `[Frame ${++count}]`);
    
    if (Date.now() - startTime >= options.duration * 1000) {
      clearInterval(interval);
      console.log('\n');
      showSummary();
    }
  }, options.rate);
}

// Mode 3: Bouncing indicator
function bounceMode() {
  console.log('\n' + bold + 'Bounce Latency Test' + reset);
  console.log('The indicator should move smoothly. Stuttering indicates latency:\n');
  
  let position = 0;
  let direction = 1;
  const width = 60;
  
  const interval = setInterval(() => {
    const spaces = ' '.repeat(position);
    const indicator = '█';
    const remaining = ' '.repeat(width - position - 1);
    const ms = Date.now() % 1000;
    
    process.stdout.write(clearLine + 
      `[${spaces}${green}${indicator}${reset}${remaining}] ` +
      `${cyan}${ms.toString().padStart(3, '0')}ms${reset}`);
    
    position += direction;
    if (position >= width - 1 || position <= 0) {
      direction = -direction;
    }
    
    count++;
    
    if (Date.now() - startTime >= options.duration * 1000) {
      clearInterval(interval);
      console.log('\n');
      showSummary();
    }
  }, options.rate);
}

// Show summary
function showSummary() {
  const actualDuration = Date.now() - startTime;
  const expectedFrames = Math.floor(actualDuration / options.rate);
  const efficiency = ((count / expectedFrames) * 100).toFixed(1);
  
  console.log(`\n${bold}=== Latency Test Summary ===${reset}`);
  console.log(`Mode: ${options.mode}`);
  console.log(`Target rate: ${options.rate}ms (${1000/options.rate} fps)`);
  console.log(`Duration: ${(actualDuration/1000).toFixed(1)}s`);
  console.log(`Frames output: ${count}`);
  console.log(`Expected frames: ${expectedFrames}`);
  console.log(`Efficiency: ${efficiency}%`);
  
  if (efficiency < 95) {
    console.log(`\n${yellow}Warning: Low efficiency suggests system can't keep up with output rate.${reset}`);
  }
  
  console.log('\nTips for measuring latency:');
  console.log('1. In counter mode, check if timestamps match wall clock time');
  console.log('2. In clock mode, compare displayed time with actual time');
  console.log('3. In bounce mode, look for smooth vs stuttering motion');
  console.log('4. Try recording your screen to analyze frame-by-frame');
  
  process.exit(0);
}

// Startup message
console.log(`${bold}Starting ${options.mode} latency test...${reset}`);
console.log(`Rate: ${options.rate}ms | Duration: ${options.duration}s`);
console.log('Watch for delays between output and display:\n');

// Run selected mode
switch (options.mode) {
  case 'clock':
    clockMode();
    break;
  case 'bounce':
    bounceMode();
    break;
  case 'counter':
  default:
    counterMode();
    break;
}