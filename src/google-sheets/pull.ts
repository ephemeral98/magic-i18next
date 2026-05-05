import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config/runtime';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const EMPTY_CELL = '\u200B';
const norm = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s === EMPTY_CELL ? '' : s;
};

// key 专用：去首尾空格，避免因为不可见字符导致排序分组错误（extra 插进 auto）
const normKey = (v: unknown) => norm(v).trim();

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

async function pullFromGoogleSheets() {
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
    console.warn(
      '⚠️ 未配置代理：国内环境可能连接 Google 超时。可设置 HTTPS_PROXY 或在 googleSheetsConfig.proxy 中配置。',
    );
  }
  if (proxy.startsWith('socks5://')) {
    throw new Error(
      '当前脚本仅支持 http 代理（不支持 socks5）。请把梯子切到 http 代理端口，或设置 HTTPS_PROXY=http://127.0.0.1:10808',
    );
  }
  const agent = new HttpsProxyAgent(proxy);
  if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));

  const credsPath = path.isAbsolute(gc.credsPath)
    ? gc.credsPath
    : path.resolve(process.cwd(), gc.credsPath);
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    transporterOptions: { agent },
  });
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

  console.log('\n📥 Google Sheets 拉取脚本启动 (pull-google)...\n');
  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[gc.sheetIndex ?? 0];
    console.log(`📡 已连接到表格: "${doc.title}" - 工作表: "${sheet.title}"`);

    // 读取所有行（包含 header）
    const rows = await sheet.getRows();
    const headerValues: string[] = (sheet as unknown as { headerValues?: string[] })
      .headerValues ?? [];

    const headers = headerValues.filter(Boolean);
    const languages = headers.filter((h) => h !== 'key' && h !== 'status');
    if (languages.length === 0) {
      throw new Error('未能从 Google Sheets 表头识别出语种列（需要 key + 至少 1 个语言列）');
    }

    console.log(`🔍 识别到语种列: ${languages.join(', ')}`);
    console.log(`🔍 表格 key 总行数: ${rows.length}`);

    const masterData: Record<string, Record<string, string>> = {};
    rows.forEach((row) => {
      const key = normKey(row.get('key'));
      if (!key) return;
      if (!masterData[key]) masterData[key] = {};
      languages.forEach((lang) => {
        masterData[key][lang] = norm(row.get(lang));
      });
    });

    const sortedKeys = sortKeys(Object.keys(masterData));
    const langData: Record<string, Record<string, unknown>> = {};
    languages.forEach((lang) => {
      langData[lang] = {};
      sortedKeys.forEach((key) => {
        setByPath(langData[lang], key, masterData[key][lang] ?? '');
      });
    });

    if (!fs.existsSync(LOCALE_DIR)) fs.mkdirSync(LOCALE_DIR, { recursive: true });
    console.log(`\n📝 正在写入本地 ${LOCALE_DIR} ...`);
    languages.forEach((lang) => {
      const filePath = path.join(LOCALE_DIR, `${lang}.json`);
      fs.writeFileSync(filePath, JSON.stringify(langData[lang], null, 2), 'utf-8');
      console.log(`   ✓ ${lang}.json`);
    });

    console.log('\n✨ 拉取完成！本地 JSON 已与 Google Sheets 强制一致。');
    console.log(`   - 共 ${sortedKeys.length} 条，语种: ${languages.join(', ')}`);
  } catch (error) {
    console.error('\n❌ 拉取失败:', error);
  }
}

pullFromGoogleSheets();

