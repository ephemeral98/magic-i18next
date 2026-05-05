#!/usr/bin/env node
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { initConfig, getConfig } from '../config/runtime';

// 类型定义
interface ConversionMap {
  [key: string]: string;
}

/**
 * 创建目录（如果不存在）
 * @param dirPath 目录路径
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 从 Excel 转换到 JSON
 * @param excelPath Excel 文件路径
 */
async function excel2Json(excelPath: string): Promise<void> {
  try {
    // 读取 Excel 文件
    const data = XLSX.readFile(excelPath, { type: 'array' });
    const sheetName = data.SheetNames[0];
    const sheet = data.Sheets[sheetName];

    // 获取第一行作为表头
    const headers: any = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
    console.log('📋 表头（语言列）:', headers);

    // 读取所有数据
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // 跳过表头，处理数据行
    const dataRows = rows.slice(1);

    // 为每个语言创建 JSON 文件
    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const lang = headers[colIndex] as string;
      if (!lang) continue;

      // 构建转换映射
      const conversionMap: ConversionMap = {};
      for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
        const row = dataRows[rowIndex];
        const value = (row[colIndex] as string) || '';
        conversionMap[(rowIndex + 1).toString()] = value;
      }

      console.log(`📝 语言「${lang}」词条数: ${Object.keys(conversionMap).length}`);

      // 生成 JSON 文件路径
      const outputDir = './translate-done';
      ensureDir(outputDir);
      const jsonFilePath = path.join(outputDir, `${lang}.json`);

      // 构建 JSON 内容
      const jsonContent = {
        auto: conversionMap,
      };

      // 写入文件
      const jsonData = JSON.stringify(jsonContent, null, 2);
      await fs.promises.writeFile(jsonFilePath, jsonData, 'utf-8');
      console.log(`   💾 已写入: ${jsonFilePath}`);
    }

    console.log('\n✅ Excel → JSON 转换完成！');
  } catch (error) {
    console.error('❌ Excel 转 JSON 失败:', error);
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
    // 使用配置文件中的默认 Excel 路径
    const excelPath = config.defaultOutputExcelPath || './data.xlsx';

    console.log(`📂 读取 Excel: ${excelPath}`);
    console.log('🔄 开始将 Excel 转为 JSON...\n');

    // 执行转换
    await excel2Json(excelPath);
  } catch (error) {
    console.error('❌ 转换失败:', error);
  }
}
