import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import strip from '@rollup/plugin-strip';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import path from 'path';
import terser from '@rollup/plugin-terser';

/** npx 可执行入口需带 shebang */
function shebangCli() {
  return {
    name: 'shebang-cli',
    generateBundle(_opts, bundle) {
      const chunk = bundle['cli.js'];
      if (chunk && chunk.type === 'chunk' && !chunk.code.startsWith('#!')) {
        chunk.code = '#!/usr/bin/env node\n' + chunk.code;
      }
    },
  };
}

function isExternal(id) {
  if (id.startsWith('\0')) return false;
  if (id.includes('node_modules')) return true;
  if (id.startsWith('.') || path.isAbsolute(id)) return false;
  return true;
}

module.exports = {
  input: path.resolve(__dirname, 'src/cli.ts'),
  output: {
    dir: path.resolve(__dirname, 'build'),
    format: 'esm',
    sourcemap: false,
    entryFileNames: 'cli.js',
    chunkFileNames: '[name]-[hash].js',
  },
  plugins: [
    strip(),
    commonjs(),
    nodeResolve({
      extensions: ['.js', '.ts'],
    }),
    typescript({
      compilerOptions: {
        declaration: false,
        outDir: 'build',
        module: 'ESNext',
        target: 'ES2020',
        allowImportingTsExtensions: false,
        noEmit: false,
      },
    }),
    babel({
      exclude: 'node_modules/**',
      presets: ['@babel/preset-typescript'],
    }),
    terser({
      compress: { passes: 2, drop_console: false },
      mangle: true,
      format: { comments: false },
    }),
    shebangCli(),
  ],
  external: isExternal,
};
