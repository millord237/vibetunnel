/**
 * ESBuild configuration for VibeTunnel web client
 */
const { monacoPlugin } = require('./monaco-plugin.js');

const commonOptions = {
  bundle: true,
  format: 'esm',
  target: 'es2020',
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.js': 'js',
    '.jsx': 'jsx',
    '.css': 'css',
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  external: [],
  plugins: [monacoPlugin],
  // Allow importing from node_modules without issues
  mainFields: ['module', 'main'],
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
      sourceMap: true,
      inlineSourceMap: true,
      inlineSources: true,
    }
  }
};

const devOptions = {
  ...commonOptions,
  sourcemap: 'inline',
  sourcesContent: true,
  minify: false,
  define: {
    ...commonOptions.define,
    'process.env.NODE_ENV': '"development"',
  },
};

const prodOptions = {
  ...commonOptions,
  sourcemap: false,
  minify: true,
};

module.exports = {
  commonOptions,
  devOptions,
  prodOptions,
};