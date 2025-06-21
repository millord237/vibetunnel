// Version information for VibeTunnel Server
// This file is updated during the build process

export const VERSION = '1.0.0-beta.3';
// BUILD_DATE will be replaced by build script, fallback to current time in dev
export const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString();
export const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || Date.now();

// This will be replaced during build
export const GIT_COMMIT = process.env.GIT_COMMIT || 'development';
export const NODE_VERSION = process.version;
export const PLATFORM = process.platform;
export const ARCH = process.arch;

export function getVersionInfo() {
  return {
    version: VERSION,
    buildDate: BUILD_DATE,
    buildTimestamp: BUILD_TIMESTAMP,
    gitCommit: GIT_COMMIT,
    nodeVersion: NODE_VERSION,
    platform: PLATFORM,
    arch: ARCH,
    uptime: process.uptime(),
    pid: process.pid,
  };
}

export function printVersionBanner() {
  console.log(`VibeTunnel Server v${VERSION}`);
  console.log(`Built: ${BUILD_DATE}`);
  console.log(`Platform: ${PLATFORM}/${ARCH} Node ${NODE_VERSION}`);
  console.log(`PID: ${process.pid}`);
}
