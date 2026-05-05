/**
 * npx 入口：默认 conversion；子命令 push:feishu / pull:feishu / push:google / pull:google / translate / json2Excel / excel2Json
 */
import { initConfig } from './config/runtime';
import { main as conversionMain } from './conversion/index';

const SUBCOMMANDS = new Set([
  'push:feishu',
  'push:google',
  'pull:feishu',
  'pull:google',
  'translate',
  'convert',
  'conversion',
  'rep',
  'json2Excel',
  'excel2Json',
]);

function parseArgv() {
  const args = process.argv.slice(2);
  const first = args[0];
  if (!first) {
    return { cmd: 'convert' as const, rest: [] as string[] };
  }
  if (SUBCOMMANDS.has(first)) {
    return { cmd: first, rest: args.slice(1) };
  }
  return { cmd: 'convert' as const, rest: args };
}

function printHelp() {
  console.log(`
magic-i18next — 国际化工具

用法:
  npx magic [路径...]              扫描并替换文案（conversion，默认）
  npx magic convert [路径...]      同上
  npx magic push:feishu            本地 JSON 推送到飞书多维表格
  npx magic pull:feishu            从飞书拉取到本地 JSON
  npx magic push:google            推送到 Google Sheets
  npx magic pull:google            从 Google Sheets 拉取
  npx magic translate [母体语言]   使用 DeepSeek 补全空翻译
  npx magic json2Excel             将 locales 下 JSON 导出为 Excel
  npx magic excel2Json             将 Excel 导入为 JSON（translate-done）
  npx magic ./src/xxx.vue          仅扫描并替换 xxx.vue 中的文案

说明:
  - 需在项目根目录提供 magic-i18next.config（.mjs / .js / .ts，.ts 由内置 jiti 加载）
`);
}

async function run() {
  const raw = process.argv.slice(2);
  if (raw[0] === '--help' || raw[0] === '-h') {
    printHelp();
    return;
  }

  await initConfig();

  const { cmd, rest } = parseArgv();

  if (rest[0] === '--help' || rest[0] === '-h') {
    printHelp();
    return;
  }

  switch (cmd) {
    case 'convert':
    case 'conversion':
    case 'rep':
      await conversionMain(rest.length ? rest : undefined);
      break;
    case 'push:feishu':
      await import('./feishu/push');
      break;
    case 'pull:feishu':
      await import('./feishu/pull');
      break;
    case 'push:google':
      await import('./google-sheets/push');
      break;
    case 'pull:google':
      await import('./google-sheets/pull');
      break;
    case 'translate': {
      const { main: translateMain } = await import('./deepSeek/index');
      await translateMain(rest[0]);
      break;
    }
    case 'json2Excel': {
      const { main: json2ExcelMain } = await import('./json2Excel/index');
      await json2ExcelMain();
      break;
    }
    case 'excel2Json': {
      const { main: excel2JsonMain } = await import('./excel2Json/index');
      await excel2JsonMain();
      break;
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
