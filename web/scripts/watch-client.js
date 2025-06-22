const esbuild = require('esbuild');

async function watchClient() {
  try {
    const ctx = await esbuild.context({
      entryPoints: ['src/client/app-entry.ts'],
      bundle: true,
      outfile: 'public/bundle/client-bundle.js',
      format: 'esm',
      sourcemap: true,
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
        'process.env.NODE_ENV': JSON.stringify('development')
      }
    });

    await ctx.watch();
    console.log('Watching client bundle...');

    // Keep the process alive
    process.on('SIGINT', async () => {
      await ctx.dispose();
      process.exit(0);
    });

  } catch (error) {
    console.error('Watch failed:', error);
    process.exit(1);
  }
}

watchClient();