import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ConversionMap } from './types';
import { isEmpty } from '../utils/commonTools';
import { getConfig } from '../config/runtime';

/* eslint-disable no-useless-escape -- 正则内转义用于匹配 Vue / i18n 模板语法 */
// 匹配文件中存在的 $t('')内容
export const regexBase =
  /(?:this\.\$t\(\')([a-zA-Z0-9.\-_]+)(?:\'\))|(?:{{$t\(')([a-zA-Z0-9.\-_]+)(?:'\)}})|(?:\$t\(\n?\s*[`'"']{1}([\s\S]*?)[`'"']{1}\n?\s*\))/g;

// 匹配文件中存在的 $k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.14__auto.2__内容` 和 $k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.14__auto.10__内容`
export const regexNew =
  /(?:this\.\$k\(\')([a-zA-Z0-9.\-_]+)(?:\'\))|(?:{{\$k\(')([a-zA-Z0-9.\-_]+)(?:'\)}})|(?:\$k\(\n?\s*[`'"']{1}([\s\S]*?)[`'"']{1}\n?\s*\))|(?:\$k\s*`([\s\S]*?)`)/g;

// 匹配文件中存在的 'auto.1'内容
export const regexFuc =
  /(?:{{$f\(')([a-zA-Z0-9.\-_]+)(?:'\)}})|(?:\$f\(\n?\s*[`'"']{1}([\s\S]*?)[`'"']{1}\n?\s*\))/g;

// 匹配 $k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.14__undefined` / $k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.14__undefined`
export const regexTx = /\$k\((['"'])(.*?)\1\)/g;

/* === Key 生成策略 ====================================================
 * 旧方案：'auto' 命名空间 + 自增数字 + 全表 O(n) 线性查重
 *   - key 与扫描顺序耦合，不同机器/不同时序结果不一致
 *   - 同一文案在不同文件需重新查重才能复用
 * 新方案：md5(normalizedValue).slice(0, 8) 作为子键
 *   - key 由内容唯一决定，扫描顺序无关、跨文件天然去重
 *   - 查重退化成 O(1) 字典命中
 *   - 极小概率前 8 位碰撞 → 按位延长 hash 直至唯一
 *   - 兼容历史数字 key：扫描时优先复用既有 key，避免迁移期同文案双份入库
 * ==================================================================== */

const NAMESPACE = 'auto';
const HASH_LEN = 8;
// auto.123__文案（旧自增）/ auto.8f2a1b3c__文案（新 hash）都视为已转换，避免二次包裹
const ALREADY_CONVERTED = /^auto\.[\w-]+__/;

/** 进程级 text → subKey 缓存：同一文案多次出现时省掉重复 md5 计算 + 碰撞探测 */
const hashCache = new Map<string, string>();

/**
 * 为 normalizedValue 取或新建一个稳定子键。
 *
 * @param text       归一化后的文案（${var} 已替换为 {0} / {{0}} 等占位）
 * @param existing   命名空间下已有的 key→value（可能含历史数字 key）
 * @param valueToKey 反查表 value→key；命中即复用，未命中则新建后写入
 */
function getOrCreateSubKey(
  text: string,
  existing: Record<string, string>,
  valueToKey: Map<string, string>,
): string {
  // 1) 已存在同文案：直接复用 —— 兼容旧自增 key，杜绝同一文案在 JSON 里出现两份
  const reused = valueToKey.get(text);
  if (reused !== undefined) return reused;

  // 2) 进程内缓存仍然有效（existing 里也确认存在该映射）
  const cached = hashCache.get(text);
  if (cached !== undefined && existing[cached] === text) return cached;

  // 3) md5 前 8 位作为新 key；命中已占用且内容不同就按位延长 hash 直至唯一
  const fullHash = crypto.createHash('md5').update(text).digest('hex');
  let len = HASH_LEN;
  let subKey = fullHash.slice(0, len);
  while (existing[subKey] !== undefined && existing[subKey] !== text) {
    len += 1;
    if (len > fullHash.length) {
      throw new Error(`hash 碰撞且无法在 md5 长度内消解: ${text}`);
    }
    subKey = fullHash.slice(0, len);
  }

  hashCache.set(text, subKey);
  valueToKey.set(text, subKey);
  return subKey;
}

/**
 * 获取需要替换的内容，统一输出标签模板风格
 * @param str 字符串
 * @returns 替换后的字符串
 */
export const getReplacement = (str: string): Promise<string> => {
  return Promise.resolve(`$k\`${str}\``);
};

/**
 * 获取基础替换内容
 * @param str 字符串
 * @returns 替换后的字符串
 */
export const getBaseReplacement = (str: string): Promise<string> => Promise.resolve(`'${str}'`);

/**
 * 检查代码是否应该被忽略（通过 /* i18n-ignore * / 注释）
 * @param fullString 完整文件内容
 * @param offset 当前匹配的偏移量
 * @returns 是否忽略
 */
function isIgnored(fullString: string, offset: number): boolean {
  const beforeMatch = fullString.substring(0, offset);
  const lines = beforeMatch.split('\n');
  const currentLine = lines[lines.length - 1];

  // 检查当前行是否包含忽略注释
  if (currentLine.includes('/* i18n-ignore */')) {
    return true;
  }

  // 检查上一行是否包含忽略注释
  if (lines.length >= 2) {
    const previousLine = lines[lines.length - 2];
    if (previousLine.includes('/* i18n-ignore */')) {
      return true;
    }
  }

  return false;
}

/**
 * 替换文件内容
 * @param fileDir 文件路径
 * @param fileContent 文件内容
 * @param regex 正则表达式
 * @param pathName 路径名称
 * @param conversionMap 转换映射
 * @param bakContent 备份内容
 * @returns 转换映射
 */
export async function replaceContent(
  fileDir: string,
  fileContent: string,
  regex: RegExp,
  pathName: string,
  conversionMap: ConversionMap,
  bakContent: ConversionMap,
): Promise<{ [key: string]: string }> {
  const promises: Promise<string>[] = [];

  conversionMap[NAMESPACE] = isEmpty(conversionMap[NAMESPACE])
    ? {}
    : conversionMap[NAMESPACE];

  // 历史词条作为防碰撞 / 复用基底（每个文件循环都会重新合并一次，幂等）
  if (bakContent[NAMESPACE]) {
    conversionMap[NAMESPACE] = { ...bakContent[NAMESPACE], ...conversionMap[NAMESPACE] };
  }

  // 反查表：value→key（首次出现优先），让历史数字 key 与新 hash key 都能 O(1) 复用
  const valueToKey = new Map<string, string>();
  for (const [k, v] of Object.entries(conversionMap[NAMESPACE])) {
    if (!valueToKey.has(v)) valueToKey.set(v, k);
  }

  // 匹配并准备替换
  fileContent.replace(regex, (...args) => {
    const match = args[0];
    const fullString = args[args.length - 1];
    const offset = args[args.length - 2];

    // 检查是否被标记为忽略
    if (isIgnored(fullString, offset)) {
      promises.push(Promise.resolve(match));
      return match;
    }

    // 提取捕获组内容
    let p1, p2, p3, p4;
    if (regex === regexNew) {
      // 新正则包含：$k(...) / $k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.10__...` / $k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.10__...`
      // 其中模板字符串风格捕获组：4($k`auto.17__auto.17__auto.17__auto.17__auto.17__auto.10__...`)
      p1 = args[1];
      p2 = args[2];
      p3 = args[3];
      p4 = args[4];
    } else if (regex === regexBase) {
      [p1, p2, p3] = [args[1], args[2], args[3]];
    } else if (regex === regexFuc) {
      [p1, p2] = [args[1], args[2]];
    }

    const value = p1 || p2 || p3 || p4;

    // 已经是目标格式（auto.<数字 | hash>__文案）则跳过，避免二次包裹
    if (regex === regexNew && ALREADY_CONVERTED.test(value)) {
      promises.push(Promise.resolve(match));
      return match;
    }
    
    // 处理带参数的情况，将 ${变量} 替换为 {索引}
    let normalizedValue = value;
    const params: string[] = [];
    const paramRegex = /\$\{([^}]+)\}/g;
    let matchParam;
    
    // 提取参数名
    while ((matchParam = paramRegex.exec(value)) !== null) {
      params.push(matchParam[1].trim());
    }
    
    // 用索引替换变量名
    if (params.length > 0) {
      normalizedValue = value;
      params.forEach((param, idx) => {
        // 根据配置的参数格式模板生成参数，添加默认值确保格式正确
        const paramFormatTemplate = getConfig().paramFormat || '{index}';
        // 确保正确替换 {index} 为数字，保留括号
        let paramFormat;
        if (paramFormatTemplate === '{index}') {
          // 特殊处理：如果格式模板是 {index}，直接生成 {0} 格式
          paramFormat = `{${idx}}`;
        } else if (paramFormatTemplate === '{{index}}') {
          // 特殊处理：如果格式模板是 {{index}}，直接生成 {{0}} 格式
          paramFormat = `{{${idx}}}`;
        } else if (paramFormatTemplate.includes('{index}')) {
          // 替换 {index} 为索引，保留括号
          paramFormat = paramFormatTemplate.replace('{index}', idx.toString());
        } else {
          // 如果没有 {index} 占位符，使用默认格式
          paramFormat = `{${idx}}`;
        }
        normalizedValue = normalizedValue.replace(new RegExp(`\\$\\{${param}\\}`, 'g'), paramFormat);
      });
    }

    // 用内容驱动的稳定 hash 替代“自增数字 + O(n) 线性查重”
    // 同一 normalizedValue 永远得到同一 subKey；历史数字 key 通过 valueToKey 优先复用
    const subKey = getOrCreateSubKey(normalizedValue, conversionMap[NAMESPACE], valueToKey);
    conversionMap[NAMESPACE][subKey] = normalizedValue;

    // 仍保留 __${value} 后缀：
    //   1. 与现有 $k 运行时兼容（运行时按分隔符切出真正 key）
    //   2. 在源码中可视化对应文案，方便 review
    const newKey = `${NAMESPACE}.${subKey}__${value}`;

    if (regex === regexNew) {
      // 统一替换为 $k`auto.17__auto.17__auto.10__...`（不带括号）
      promises.push(getReplacement(newKey));
    } else {
      promises.push(getBaseReplacement(newKey));
    }

    return match;
  });

  // 执行替换
  const promiseRes = await Promise.all(promises);
  if (promiseRes.length) {
    let replacementIndex = 0;
    const output = fileContent.replace(regex, () => promiseRes[replacementIndex++]);
    fs.writeFileSync(fileDir, output, 'utf-8');
  }

  return conversionMap[NAMESPACE];
}

/**
 * 提取转换内容
 * @param fileList 文件列表
 * @param i18nFilePath 国际化文件路径
 * @returns 转换映射
 */
export async function extractConversion(
  fileList: string[],
  i18nFilePath: string,
): Promise<ConversionMap> {
  const conversionMap: ConversionMap = {};

  for (const fileDir of fileList) {
    const content = fs.readFileSync(fileDir, 'utf8');

    // 检查文件是否存在于当前目录中、以及是否可写。
    let bakContent: ConversionMap = {};
    try {
      const res = await doReadExitFile(i18nFilePath);
      bakContent = res ?? {};
    } catch (error) {
      console.warn('⚠️ 读取已有语言文件失败，将按空数据继续:', error);
      const res = await doReadExitFile(i18nFilePath);
      bakContent = res ?? {};
    }

    const pathName = path
      .dirname(fileDir)
      .replace(/^src[\\/]?/, '') // 去除 src 字段
      .replace(/^views[\\/]?/, '') // 去除 views 字段
      .replace(/[\\/]/g, '_') // 将路径分隔符转化为_
      .toLocaleLowerCase();

    await replaceContent(fileDir, content, regexFuc, pathName, conversionMap, bakContent);
    // 重新获取内容再次替换
    const newContent = fs.readFileSync(fileDir, 'utf8');
    await replaceContent(fileDir, newContent, regexNew, pathName, conversionMap, bakContent);
  }

  return conversionMap;
}

/**
 * 读取或创建文件
 * @param path_way 文件路径
 * @returns 文件内容
 */
export function doReadExitFile(path_way: string): Promise<ConversionMap> {
  return new Promise((resolve, reject) => {
    fs.access(path_way, (err) => {
      if (err) {
        fs.writeFile(path_way, '{}', 'utf-8', (_e) => {
          reject(false);
        });
      } else {
        const bakContent_file = fs.readFileSync(path_way, 'utf8');
        const bakContent = JSON.parse(bakContent_file);
        resolve(bakContent);
      }
    });
  });
}
