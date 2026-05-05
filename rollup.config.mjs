import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import strip from '@rollup/plugin-strip';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import path from 'path';
import terser from '@rollup/plugin-terser';

module.exports = {
  input: {
    'conversion/index': path.resolve(__dirname, 'src/conversion/index.ts'),
    'json2Excel/index': path.resolve(__dirname, 'src/json2Excel/index.ts'),
    'excel2Json/index': path.resolve(__dirname, 'src/excel2Json/index.ts'),
    'index': path.resolve(__dirname, 'src/main.ts')
  },
  output: [
    {
      dir: path.resolve(__dirname, 'build'),
      format: 'esm',
      sourcemap: false,
      entryFileNames: '[name].js'
    }
  ],
  plugins: [
    // 这个插件是有执行顺序的
    strip(), // 打包产物清除调试代码
    // 支持基于 CommonJS 模块引入
    commonjs(),
    nodeResolve({
      extensions: ['.js', '.ts'],
    }),
    typescript({
      compilerOptions: {
        declaration: true,
        declarationDir: 'build/types',
        outDir: 'build',
        module: 'ESNext',
        target: 'ES2020',
        allowImportingTsExtensions: false,
        noEmit: false,
      },
    }),
    // babel 配置
    babel({
      // 编译库使用
      // 只转换源代码，不转换外部依赖
      exclude: 'node_modules/**',
      // babel 默认不支持 ts 需要手动添加
      presets: ['@babel/preset-typescript']
    }),
    terser({
      compress: { passes: 2, drop_console: false },
      mangle: true,
      format: { comments: false },
    }),
  ],
  external: ['xlsx', 'fs', 'path', 'readline', 'process'],
};
