import fs from 'fs';
import path from 'path';
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
  let index = 1;
  const promises: Promise<string>[] = [];
  const key = 'auto';

  // 初始化转换映射
  conversionMap[key] = isEmpty(conversionMap[key]) ? {} : conversionMap[key];

  // 合并备份文件内容
  if (conversionMap[key] || bakContent[key]) {
    conversionMap[key] = { ...bakContent[key], ...conversionMap[key] };
    index = Object.keys(conversionMap[key]).length + 1;
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

    // 已经是目标格式（如 auto.10__文案）则跳过，避免重复转换导致嵌套污染
    if (regex === regexNew && /^auto\.\d+__/.test(value)) {
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

    // 去重 - 基于值而不是key
    let foundIndex = index;
    let isDuplicate = false;
    
    for (const [inx, val] of Object.entries(conversionMap[key])) {
      if (val === normalizedValue) {
        foundIndex = parseInt(inx);
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      conversionMap[key][index] = normalizedValue;
      foundIndex = index;
      index += 1; // 新增后递增，避免所有新文案复用同一个序号
    }

    // 生成新的key格式: auto.自增数字__文案
    const newKey = `${key}.${foundIndex}__${value}`;

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

  return conversionMap[key];
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
