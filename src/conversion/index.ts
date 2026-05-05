#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
// import { pathToFileURL } from 'url';
import { readDirRecursive } from './scan';
import { extractConversion } from './replace';
import {
  writeConversionToFile,
  readJsonObjectSafe,
  updateSiblingLocalesFromPrimaryDiff,
  ensureDir,
} from './writer';
import { readInpJsonDir } from './userInput';
import { initConfig, getConfig } from '../config/runtime';

function uniq(list: string[]) {
  return Array.from(new Set(list));
}


function normalizeTargetInput(inputPath: string) {
  // 支持 `yarn rep ./src/test` / `yarn rep src/test/test.ts` / 绝对路径
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

/**
 * 根据显式路径（文件或目录）解析要扫描的文件列表；不传则全盘扫描 config.scanDir。
 */
function resolveScanTargets(explicitPaths?: string[]): string[] {
  const cfg = getConfig();
  if (!explicitPaths?.length) {
    return readDirRecursive(cfg.scanDir, cfg.extensions, cfg.exclude);
  }

  const allFiles: string[] = [];
  for (const raw of explicitPaths) {
    const targetPath = normalizeTargetInput(raw);

    if (!fs.existsSync(targetPath)) {
      throw new Error(`文件夹or文件不存在: ${raw} -> ${targetPath}`);
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      allFiles.push(...readDirRecursive(targetPath, cfg.extensions, cfg.exclude));
      continue;
    }

    if (stat.isFile()) {
      const base = path.basename(targetPath);
      const ext = path.extname(targetPath);
      const excluded = (cfg.exclude || []).includes(base);
      const allowed = (cfg.extensions || []).includes(ext);
      if (!excluded && allowed) {
        allFiles.push(targetPath);
      }
      continue;
    }
  }

  return uniq(allFiles);
}

function normalizeTargetPathsInput(targetPaths?: string | string[]): string[] | undefined {
  if (targetPaths === undefined) return undefined;
  const arr = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
  return arr.filter(Boolean);
}

/**
 * 主函数
 * @param targetPaths 可选。传入文件或目录路径（字符串或数组）时只处理这些目标；不传则按配置全盘扫描。
 */
export async function main(targetPaths?: string | string[]) {
  try {
    await initConfig();
    const config = getConfig();
    // 获取用户输入的语言
    const lang = await readInpJsonDir();
    const language = lang || config.defaultLanguage;
    const resolvedOutputDir = path.resolve(process.cwd(), config.outputDir);
    const i18nFilePath = path.join(resolvedOutputDir, `${language}.json`);

    // 确保输出目录存在
    ensureDir(resolvedOutputDir);

    console.log(`📂 输出语言文件: ${i18nFilePath}`);
    console.log(`🌐 当前语言: ${language}`);
    console.log('🔄 开始扫描并替换文案...\n');

    const beforePrimary = readJsonObjectSafe(i18nFilePath);

    const explicit = normalizeTargetPathsInput(targetPaths);
    const fileList = resolveScanTargets(
      explicit?.length ? explicit : undefined,
    );
    console.log(`📋 已扫描 ${fileList.length} 个文件:\n`, fileList);

    // 提取并替换内容
    const conversion = await extractConversion(fileList, i18nFilePath);

    // 写入主语言文件
    writeConversionToFile(conversion, i18nFilePath);

    const afterPrimary = readJsonObjectSafe(i18nFilePath);
    updateSiblingLocalesFromPrimaryDiff(beforePrimary, afterPrimary, resolvedOutputDir, language);

    console.log('\n✅ 文案转换完成！');
  } catch (error) {
    console.error('❌ 转换失败:', error);
  }
}
