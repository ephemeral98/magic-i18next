import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { MagicI18nextConfig } from '../../magic-i18next.config';

declare global {
  var __MAGIC_I18NEXT_CONFIG__: MagicI18nextConfig | undefined;
}

/**
 * 从运行目录加载 magic-i18next.config（.mjs / .js / .ts）。
 * .ts 使用 jiti 在运行时编译（Node 原生不支持直接 import .ts）。
 */
export async function initConfig(): Promise<void> {
  if (globalThis.__MAGIC_I18NEXT_CONFIG__ !== undefined) return;

  const cwd = process.cwd();
  const names = ['magic-i18next.config.mjs', 'magic-i18next.config.js', 'magic-i18next.config.ts'];
  const errors: Error[] = [];

  for (const name of names) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    try {
      if (name.endsWith('.ts')) {
        const { createJiti } = await import('jiti');
        const jiti = createJiti(import.meta.url, { interopDefault: true });
        const mod = jiti(p) as { default?: MagicI18nextConfig } & MagicI18nextConfig;
        globalThis.__MAGIC_I18NEXT_CONFIG__ = mod?.default ?? mod;
        return;
      }
      const mod = await import(pathToFileURL(p).href);
      globalThis.__MAGIC_I18NEXT_CONFIG__ = mod.default ?? mod;
      return;
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  const last = errors[errors.length - 1];
  const hint = last ? `\n最后一次加载错误: ${last.message}` : '';
  throw new Error(
    `未在项目根目录找到可用的 magic-i18next.config（已尝试 .mjs / .js / .ts）。${hint}`,
  );
}

export function getConfig(): MagicI18nextConfig {
  const c = globalThis.__MAGIC_I18NEXT_CONFIG__;
  if (c === undefined) {
    throw new Error('内部错误：配置未初始化，请先 await initConfig()');
  }
  return c;
}
