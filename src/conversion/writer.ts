import fs from 'fs';
import path from 'path';
import { isPlainObject, type JsonObject } from '../utils/emptyLocaleFromPrimary';
import { ConversionMap } from './types';

/** 读取 JSON，文件不存在或解析失败时返回 {} */
export function readJsonObjectSafe(filePath: string): JsonObject {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as unknown;
    return isPlainObject(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * 主语言本轮写入后(after)相对写入前(before)：仅「新增叶子」或「叶子 value 变化」时，兄弟 locale 对应叶子置 ""。
 * 若某叶子在 cn 中未变，则保留 sibling 中已有字符串。
 */
function mergeSiblingForPrimaryDiff(
  after: JsonObject,
  before: JsonObject,
  sibling: JsonObject,
): JsonObject {
  const result: JsonObject = {};
  for (const key of Object.keys(after)) {
    const afterVal = after[key];
    const beforeVal = before[key];
    const sibVal = sibling[key];

    if (isPlainObject(afterVal)) {
      const subBefore = isPlainObject(beforeVal) ? beforeVal : {};
      const subSib = isPlainObject(sibVal) ? sibVal : {};
      result[key] = mergeSiblingForPrimaryDiff(afterVal, subBefore, subSib);
    } else {
      const isNew = !(key in before);
      if (isNew) {
        result[key] = '';
      } else if (isPlainObject(beforeVal)) {
        // 结构从对象变为叶子，视为变更，需重译
        result[key] = '';
      } else {
        const unchanged = String(beforeVal) === String(afterVal);
        if (unchanged) {
          result[key] = typeof sibVal === 'string' ? sibVal : '';
        } else {
          result[key] = '';
        }
      }
    }
  }
  return result;
}

/**
 * 将翻译内容写入 JSON 文件
 * @param conversion 转换映射
 * @param filePath 文件路径
 */
export function writeConversionToFile(conversion: ConversionMap, filePath: string): void {
  try {
    const curFile = fs.readFileSync(filePath, 'utf8');
    const fileContent = JSON.parse(curFile);
    const data = { ...fileContent, ...conversion };
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonData);
    console.log(`💾 语言文件已更新: ${filePath}`);
  } catch (error) {
    console.error('❌ 写入语言文件失败:', error);
    throw error;
  }
}

/**
 * 创建目录（如果不存在）
 * @param dirPath 目录路径
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 根据主语言写入前/后的差异，更新 outputDir 下其余 *.json：
 * 仅当主语言某叶子为新增或 value 变化时，对应兄弟文件叶子置 ""；否则保留兄弟文件原 value。
 */
export function updateSiblingLocalesFromPrimaryDiff(
  beforePrimary: JsonObject,
  afterPrimary: JsonObject,
  outputDir: string,
  primaryLanguage: string,
): void {
  const primaryName = `${primaryLanguage}.json`;
  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.json') && f !== primaryName);
  for (const file of files) {
    const p = path.join(outputDir, file);
    const sibling = readJsonObjectSafe(p);
    const merged = mergeSiblingForPrimaryDiff(afterPrimary, beforePrimary, sibling);
    const text = `${JSON.stringify(merged, null, 2)}\n`;
    fs.writeFileSync(p, text, 'utf8');
    console.log(`💾 已按主语言差异更新兄弟语言: ${p}`);
  }
}
