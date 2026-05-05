#!/usr/bin/env node
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { initConfig, getConfig } from '../config/runtime';

// 类型定义
interface TranslationData {
  [key: string]: string;
}

interface I18nFile {
  auto: TranslationData;
  [key: string]: any;
}

/**
 * 读取或创建文件
 * @param filePath 文件路径
 * @returns 文件内容
 */
async function doReadExitFile(filePath: string): Promise<I18nFile> {
  return new Promise((resolve, reject) => {
    fs.access(filePath, async (err) => {
      if (err) {
        try {
          await fs.promises.writeFile(filePath, '{}', 'utf-8');
          resolve({ auto: {} });
        } catch (e) {
          reject(e);
        }
      } else {
        try {
          const bakContentFile = await fs.promises.readFile(filePath, 'utf8');
          const bakContent = JSON.parse(bakContentFile);
          resolve(bakContent);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

/**
 * 将 JSON 转换为 Excel
 * @param i18nFilePath 国际化文件路径
 * @param outputExcelPath 输出 Excel 文件路径
 */
async function json2Excel(i18nFilePath: string, outputExcelPath: string): Promise<void> {
  try {
    const config = getConfig();
    // 读取 locales 目录下的所有 JSON 文件
    const localesFiles = fs
      .readdirSync(config.defaultLocalesDir)
      .filter((file) => path.extname(file) === '.json');

    // 准备语言列表和数据
    const languages = localesFiles.map((file) => path.basename(file, '.json'));
    const langDataMap: { [key: string]: TranslationData } = {};

    // 读取所有语言的文件
    for (const lang of languages) {
      const langFilePath = path.join(config.defaultLocalesDir, `${lang}.json`);
      const langRes = await doReadExitFile(langFilePath);
      langDataMap[lang] = langRes.auto || {};
    }

    // 收集所有唯一的键
    const allKeys = new Set<string>();
    for (const lang of languages) {
      Object.keys(langDataMap[lang]).forEach((key) => allKeys.add(key));
    }

    // 准备 Excel 数据
    const headers = [
      config.defaultLanguage,
      ...languages.filter((lang) => lang !== config.defaultLanguage),
    ];
    const rows: any[][] = [headers];

    // 为每个键创建一行数据
    allKeys.forEach((key) => {
      const row = [];
      // 第一列是默认语言的内容
      row.push(langDataMap[config.defaultLanguage][key] || '');
      // 后面的列是其他语言的内容
      languages.forEach((lang) => {
        if (lang !== config.defaultLanguage) {
          row.push(langDataMap[lang][key] || '');
        }
      });
      rows.push(row);
    });

    console.log('📊 待导出数据行数:', rows.length);

    // 创建 Excel 工作簿和工作表
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // 添加工作表到工作簿
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    // 写入 Excel 文件
    XLSX.writeFile(wb, outputExcelPath);

    console.log(`📁 Excel 已生成: ${outputExcelPath}`);
    console.log('✅ JSON → Excel 导出完成！');
  } catch (error) {
    console.error('❌ JSON 转 Excel 失败:', error);
    throw error;
  }
}

/**
 * 主函数
 */
export async function main() {
  try {
    await initConfig();
    const config = getConfig();
    // 使用默认语言的文件路径
    const i18nFilePath = path.join(config.defaultLocalesDir, `${config.defaultLanguage}.json`);

    console.log(`📂 读取语言目录: ${i18nFilePath}`);
    console.log('🔄 开始将 JSON 转为 Excel...\n');

    // 执行转换
    await json2Excel(i18nFilePath, config.defaultOutputExcelPath);
  } catch (error) {
    console.error('❌ 转换失败:', error);
  }
}
