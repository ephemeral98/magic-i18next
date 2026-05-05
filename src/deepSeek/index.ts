#!/usr/bin/env node
/**
 * DeepSeek 批量补全 locale：以母体 JSON 为源，仅翻译目标文件中 value 为空字符串的条目。
 * 配置见 magic-i18next.config.ts 的 deepSeek；环境变量 DEEPSEEK_API_KEY 可覆盖 apiKey。
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { pathToFileURL } from 'url';
import { initConfig, getConfig } from '../config/runtime';
import { isPlainObject, type JsonObject } from '../utils/emptyLocaleFromPrimary';

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

function pathToDot(parts: string[]): string {
  return parts.join('.');
}

function setLeafAtPath(root: JsonObject, parts: string[], value: string): void {
  let cur: JsonObject = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cur[k];
    if (!isPlainObject(next)) {
      cur[k] = {};
    }
    cur = cur[k] as JsonObject;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * 母体为源：仅当源为非空字符串，且目标该叶子为 "" 或缺失时，收集待译条目。
 */
function collectEmptyLeafTasks(
  source: JsonObject,
  target: JsonObject,
  prefix: string[] = [],
): { dotPath: string; parts: string[]; sourceText: string }[] {
  const out: { dotPath: string; parts: string[]; sourceText: string }[] = [];
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (isPlainObject(sv)) {
      const sub = isPlainObject(tv) ? tv : {};
      out.push(...collectEmptyLeafTasks(sv, sub, [...prefix, key]));
    } else if (typeof sv === 'string' && sv.length > 0) {
      const needTranslate = tv === '' || tv === undefined;
      if (needTranslate) {
        const parts = [...prefix, key];
        out.push({ dotPath: pathToDot(parts), parts, sourceText: sv });
      }
    }
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

function parseJsonObjectFromModel(text: string): Record<string, string> {
  const trimmed = text.trim();
  const tryParse = (s: string) => JSON.parse(s) as Record<string, string>;
  try {
    return tryParse(trimmed);
  } catch {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return tryParse(m[1].trim());
  }
  throw new Error('无法解析模型返回的 JSON');
}

function targetLocaleLabel(code: string): string {
  const cfg = getConfig();
  return (
    cfg.deepSeek.localLabel[code] ??
    cfg.feishuConfig?.fieldMap?.[code] ??
    code
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateBatch(
  apiKey: string,
  targetLangCode: string,
  batch: { dotPath: string; sourceText: string }[],
): Promise<Record<string, string>> {
  const { model, retries, retryDelayMs } = getConfig().deepSeek;
  const targetLabel = targetLocaleLabel(targetLangCode);
  const payload: Record<string, string> = {};
  for (const t of batch) {
    payload[t.dotPath] = t.sourceText;
  }

  const system = `You are a professional UI translator. Translate values from the source locale to ${targetLabel}.
Rules:
- Output MUST be a single JSON object only (no markdown outside JSON).
- Use exactly the same keys as input (dot-path strings like "auto.13").
- Preserve all placeholders exactly: {0}, {1}, {name}, {{x}}, $place, etc. Do not translate placeholder tokens.
- Keep punctuation and line breaks reasonable for UI strings.
- If a value is already mostly Latin/English and the target is English, still localize naturally if needed.`;

  const user = `Translate each value to ${targetLabel}. Input JSON (keys are stable ids):\n${JSON.stringify(payload, null, 2)}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(DEEPSEEK_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let msg = `HTTP ${res.status}: ${errText.slice(0, 500)}`;
        try {
          const j = JSON.parse(errText) as { error?: { message?: string } };
          const m = j.error?.message;
          if (m) msg = m;
        } catch {
          /* ignore */
        }
        if (
          res.status === 402 ||
          /insufficient balance|余额|欠费/i.test(msg)
        ) {
          throw new Error(
            `DeepSeek 账户余额不足（HTTP ${res.status}），请到 DeepSeek 控制台充值后再试。详情：${msg}`,
          );
        }
        throw new Error(msg);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('API 未返回 content');

      const parsed = parseJsonObjectFromModel(content);
      for (const k of Object.keys(payload)) {
        if (!(k in parsed)) {
          throw new Error(`返回 JSON 缺少 key: ${k}`);
        }
      }
      return parsed;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/余额不足|Insufficient Balance|HTTP 402/i.test(msg)) {
        throw e;
      }
      if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

async function askSourceLang(cliArg?: string): Promise<string> {
  if (cliArg?.trim()) return cliArg.trim();
  const rl = readline.createInterface({ input, output });
  try {
    const raw = await rl.question('🌐 请输入母体语言代码（直接回车默认 cn）: ');
    return raw.trim() || 'cn';
  } finally {
    rl.close();
  }
}

/** 从 argv 解析母体语言（兼容直接运行 ts/js、以及 npx magic translate 子进程） */
function resolveLangFromArgv(): string | undefined {
  const a2 = process.argv[2];
  const a3 = process.argv[3];
  if (!a2) return undefined;
  if (a2.includes('deepSeek') && (a2.endsWith('.ts') || a2.endsWith('.js'))) return a3;
  if (a2 === 'translate') return a3;
  return a2;
}

export async function main(sourceLangOverride?: string): Promise<void> {
  await initConfig();
  const config = getConfig();
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() || config.deepSeek.apiKey?.trim();
  if (!apiKey) {
    console.error(
      '❌ 未配置 DeepSeek API Key：请在 magic-i18next.config.ts 的 deepSeek.apiKey 中填写，或设置环境变量 DEEPSEEK_API_KEY。',
    );
    process.exit(1);
  }

  const sourceLang = await askSourceLang(sourceLangOverride ?? resolveLangFromArgv());
  const localesDir = path.resolve(process.cwd(), config.outputDir);
  const sourceName = `${sourceLang}.json`;
  const sourcePath = path.join(localesDir, sourceName);

  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ 未找到母体文件: ${sourcePath}`);
    process.exit(1);
  }

  const sourceRaw = fs.readFileSync(sourcePath, 'utf8');
  const source = JSON.parse(sourceRaw) as JsonObject;

  const otherFiles = fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith('.json') && f !== sourceName);

  if (otherFiles.length === 0) {
    console.log('ℹ️ 没有其他 locale 文件需要处理。');
    return;
  }

  console.log(`📂 母体: ${sourcePath}`);
  console.log(`📝 待处理语言文件: ${otherFiles.join(', ')}\n`);

  for (const file of otherFiles) {
    const targetLang = path.basename(file, '.json');
    const filePath = path.join(localesDir, file);
    let target: JsonObject;
    try {
      target = JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonObject;
    } catch {
      console.warn(`⚠️ 跳过（JSON 无法解析）: ${filePath}`);
      continue;
    }

    const tasks = collectEmptyLeafTasks(source, target);
    if (tasks.length === 0) {
      console.log(`✓ ${file}：无空 value，跳过。`);
      continue;
    }

    const batchSize = config.deepSeek.batchSize;
    console.log(`⏳ ${file}：待翻译 ${tasks.length} 条（分批 ${batchSize}）…`);
    const batches = chunk(tasks, batchSize);
    let done = 0;

    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const translated = await translateBatch(apiKey, targetLang, b);
      for (const t of b) {
        const text = translated[t.dotPath];
        if (typeof text !== 'string') {
          throw new Error(`返回类型错误: ${t.dotPath}`);
        }
        setLeafAtPath(target, t.parts, text);
      }
      done += b.length;
      console.log(`   批次 ${i + 1}/${batches.length} 完成（${done}/${tasks.length}）`);
    }

    fs.writeFileSync(filePath, `${JSON.stringify(target, null, 2)}\n`, 'utf8');
    console.log(`💾 已写入 ${filePath}\n`);
  }

  console.log('✅ 翻译任务结束。');
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((e) => {
    console.error('❌', e);
    process.exit(1);
  });
}
