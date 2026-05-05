import fs from 'fs';
import path from 'path';
import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from '../config/runtime';

/**
 * 按路径写入嵌套对象，如 setByPath(obj, 'auto.1', 'x') => obj.auto['1'] = 'x'
 */
function setByPath(obj: Record<string, unknown>, key: string, value: string): void {
  const parts = key.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!(p in cur) || typeof cur[p] !== 'object' || cur[p] === null) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** 与 push 一致的 key 排序：auto 在前按数字，extra 在后按数字，其余 localeCompare */
function sortKeys(keys: string[]): string[] {
  const keyOrder = (k: string) =>
    k.startsWith('auto.') ? 0 : k.startsWith('extra.') ? 1 : 2;
  return [...keys].sort((a, b) => {
    if (keyOrder(a) !== keyOrder(b)) return keyOrder(a) - keyOrder(b);
    const numA = a.match(/\.(\d+)$/)?.[1];
    const numB = b.match(/\.(\d+)$/)?.[1];
    if (numA != null && numB != null) {
      const nA = parseInt(numA, 10);
      const nB = parseInt(numB, 10);
      if (nA !== nB) return nA - nB;
    }
    return a.localeCompare(b);
  });
}

async function pullFromFeishu() {
  const config = getConfig();
  const fc = config.feishuConfig;
  const LOCALE_DIR = fc.localeDir ?? config.outputDir;
  const KEY_FIELD_NAME = fc.keyFieldName ?? 'key';
  const DEFAULT_FIRST_COLUMN_NAME = fc.defaultFirstColumnName ?? '文本';
  const fieldMap: Record<string, string> = fc.fieldMap ?? {};

  const client = new lark.Client({
    appId: fc.appId,
    appSecret: fc.appSecret,
  });

  const languages = Object.keys(fieldMap);

  console.log('\n📥 飞书拉取脚本启动 (pull)...\n');
  try {
    if (languages.length === 0) {
      throw new Error('feishuConfig.fieldMap 为空，无法确定要拉取的语言');
    }
    console.log(`🔍 将拉取语种: ${languages.join(', ')}`);

    // 1. 分页拉取飞书表格全部记录
    const masterData: Record<string, Record<string, string>> = {};
    let pageToken = '';

    console.log('📡 正在读取飞书云端数据...');
    do {
      const res = await client.bitable.appTableRecord.list({
        path: { app_token: fc.appToken, table_id: fc.tableId },
        params: { page_token: pageToken, page_size: 500 },
      });
      const items = (res.data?.items ?? []) as { fields: Record<string, unknown> }[];
      items.forEach((item) => {
        const key = (item.fields[KEY_FIELD_NAME] ?? item.fields[DEFAULT_FIRST_COLUMN_NAME] ?? '') as string;
        if (!key) return;
        if (!masterData[key]) masterData[key] = {};
        languages.forEach((lang) => {
          const colName = fieldMap[lang] ?? lang;
          const val = item.fields[colName];
          masterData[key][lang] = typeof val === 'string' ? val : val != null ? String(val) : '';
        });
      });
      pageToken = res.data?.page_token ?? '';
    } while (pageToken);

    const totalKeys = Object.keys(masterData).length;
    console.log(`🔍 飞书共 ${totalKeys} 条记录`);

    const sortedKeys = sortKeys(Object.keys(masterData));

    // 2. 按语言生成嵌套结构（顺序与 push 一致）
    const langData: Record<string, Record<string, unknown>> = {};
    languages.forEach((lang) => {
      langData[lang] = {};
      sortedKeys.forEach((key) => {
        setByPath(langData[lang], key, masterData[key][lang] ?? '');
      });
    });

    // 3. 强制写入本地 JSON
    if (!fs.existsSync(LOCALE_DIR)) {
      fs.mkdirSync(LOCALE_DIR, { recursive: true });
    }

    console.log(`\n📝 正在写入本地 ${LOCALE_DIR} ...`);
    languages.forEach((lang) => {
      const filePath = path.join(LOCALE_DIR, `${lang}.json`);
      fs.writeFileSync(filePath, JSON.stringify(langData[lang], null, 2), 'utf-8');
      console.log(`   ✓ ${lang}.json`);
    });

    console.log('\n✨ 拉取完成！本地 JSON 已与飞书表格强制一致。');
    console.log(`   - 共 ${totalKeys} 条，语种: ${languages.join(', ')}`);
  } catch (error: unknown) {
    console.error('\n❌ 拉取失败:');
    if (error && typeof error === 'object' && 'response' in error) {
      const res = (error as { response?: { data?: unknown } }).response;
      if (res?.data) console.error(JSON.stringify(res.data, null, 2));
      else console.error(error);
    } else {
      console.error(error);
    }
  }
}

pullFromFeishu();
