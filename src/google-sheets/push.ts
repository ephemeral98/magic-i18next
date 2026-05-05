import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/runtime';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

/**
 * 平铺 JSON 数据
 */
function flattenI18n(obj: any, prefix = '') {
  const results: any = {};
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      Object.assign(results, flattenI18n(obj[key], fullKey));
    } else {
      results[fullKey] = obj[key];
    }
  }
  return results;
}

async function syncToGoogleSheets() {
  const config = getConfig();
  const gc = config.googleSheetsConfig;
  const LOCALE_DIR = gc.localeDir ?? config.outputDir;
  const SPREADSHEET_ID = gc.spreadsheetId;

  const proxyFromConfig =
    gc.proxy ? `${gc.proxy.protocol}://${gc.proxy.host}:${gc.proxy.port}` : '';
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    proxyFromConfig ||
    '';
  if (!proxy) {
    console.warn('⚠️ 未配置代理：国内环境可能连接 Google 超时。可设置 HTTPS_PROXY 或在 googleSheetsConfig.proxy 中配置。');
  }
  if (proxy.startsWith('socks5://')) {
    throw new Error('当前脚本仅支持 http 代理（不支持 socks5）。请把梯子切到 http 代理端口，或设置 HTTPS_PROXY=http://127.0.0.1:10808');
  }
  const agent = new HttpsProxyAgent(proxy);
  if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

  const credsPath = path.isAbsolute(gc.credsPath) ? gc.credsPath : path.resolve(process.cwd(), gc.credsPath);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    transporterOptions: { agent },
  });
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

  console.log('\n🚀 Google Sheets 同步脚本启动 (push)...\n');

  try {
    const BATCH_SIZE = 200; // 越大越快，但越容易触发限流/超时
    const SLEEP_MS = 150; // 每批/每次写入后的间隔，降低限流概率
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // google-spreadsheet 在写入时对 falsy 值有兼容问题：空字符串可能被写成 key
    // 用零宽空格表示“看起来为空”的单元格，避免被错误替换
    const EMPTY_CELL = '\u200B';

    // 1. 加载文档信息
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[gc.sheetIndex ?? 0]; // 默认操作第一个标签页
    console.log(`📡 已连接到表格: "${doc.title}" - 工作表: "${sheet.title}"`);

    // 2. 读取本地 JSON
    const files = fs.readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));
    const masterData: Record<string, any> = {};
    const languages: string[] = [];

    files.forEach((file) => {
      const lang = path.basename(file, '.json');
      languages.push(lang);
      const content = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, file), 'utf-8'));
      const flattened = flattenI18n(content);
      Object.entries(flattened).forEach(([key, value]) => {
        if (!masterData[key]) masterData[key] = {};
        masterData[key][lang] = value;
      });
    });

    // 3. 设置表头 (自动根据语种对齐)
    const headers = ['key', ...languages, 'status'];
    await sheet.setHeaderRow(headers);
    console.log(`📝 已自动配置表头: ${headers.join(', ')}`);

    // 4. 获取现有数据 (用于全量比对)
    const rows = await sheet.getRows();
    const existingRowsMap = new Map();
    rows.forEach((row) => existingRowsMap.set(row.get('key'), row));

    // 5. 排序逻辑：auto.* 在前按数字，extra.* 在后按数字，其它按字典序
    const keyOrder = (k: string) => (k.startsWith('auto.') ? 0 : k.startsWith('extra.') ? 1 : 2);
    const sortedKeys = Object.keys(masterData).sort((a, b) => {
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

    // 6. 全量同步：更新、新增或删除
    console.log('🔄 正在同步数据到云端...');

    // Google Sheets “更新行”不会改变行顺序，历史错误顺序会一直存在。
    // 为了强制保证：auto 全部在前、extra 全部在后（且按数字排序），这里采用“清空数据区后按顺序重写”。
    console.log('🧹 正在清空云端数据区（保留表头）以重建顺序...');
    await sheet.clearRows();
    await sleep(SLEEP_MS);

    console.log(`🚀 正在按顺序写入 ${sortedKeys.length} 条（每批 ${BATCH_SIZE}）...`);
    for (let i = 0; i < sortedKeys.length; i += BATCH_SIZE) {
      const batchKeys = sortedKeys.slice(i, i + BATCH_SIZE);
      const batchRows = batchKeys.map((key) => {
        const rowData: Record<string, any> = { key, status: '待处理' };
        languages.forEach((lang) => {
          const v = masterData[key]?.[lang];
          rowData[lang] = v === '' ? EMPTY_CELL : v ?? '';
        });
        return rowData;
      });
      await sheet.addRows(batchRows);
      const done = Math.min(i + BATCH_SIZE, sortedKeys.length);
      process.stdout.write(`\r   已写入 ${done}/${sortedKeys.length}`);
      await sleep(SLEEP_MS);
    }
    if (sortedKeys.length > 0) console.log('');

    console.log('\n✨ Google Sheets 同步完成！本地与云端已保持一致。');
  } catch (error) {
    console.error('\n❌ 同步失败:', error);
  }
}

syncToGoogleSheets();
