const esbuild = require('esbuild');
const path = require('path');

async function buildClient() {
  try {
    await esbuild.build({
      entryPoints: ['src/client/app-entry.ts'],
      bundle: true,
      outfile: 'public/bundle/client-bundle.js',
      format: 'esm',
      sourcemap: true,
      minify: process.env.NODE_ENV === 'production',
      loader: {
        '.ttf': 'file',
        '.woff': 'file',
        '.woff2': 'file',
        '.eot': 'file',
        '.svg': 'file',
        '.png': 'file',
        '.jpg': 'file',
        '.jpeg': 'file',
        '.gif': 'file',
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
      }
    });
    console.log('Client bundle built successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildClient();