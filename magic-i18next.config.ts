export interface MagicI18nextConfig {
  /**
   * 扫描的入口目录
   * @default './src'
   */
  scanDir: string;

  /**
   * 要扫描的文件扩展名
   * @default ['.vue', '.ts', '.tsx', '.js', '.jsx']
   */
  extensions: string[];

  /**
   * 国际化文件的输出目录
   * @default './src/locales'
   */
  outputDir: string;

  /**
   * 默认语言
   * @default 'en'
   */
  defaultLanguage: string;

  /**
   * 排除的目录或文件
   * @default ['node_modules', 'dist', 'build']
   */
  exclude: string[];

  /**
   * 参数格式模板，{index} 会被替换为参数索引
   * @default '{index}' // vue-i18n, next-i18n 等
   * @example '{{index}}' // react-i18next
   */
  paramFormat: string;

  /**
   * 国际化文件的默认目录（用于 json2Excel）
   * @default './src/locales'
   */
  defaultLocalesDir: string;

  /**
   * 生成的 Excel 文件的默认路径（用于 json2Excel）
   * @default './data.xlsx'
   */
  defaultOutputExcelPath: string;

  /**
   * 飞书多维表格同步配置（用于 push）
   */
  feishuConfig: {
    /** 飞书应用 App ID */
    appId: string;
    /** 飞书应用 App Secret */
    appSecret: string;
    /** 多维表格的 app_token（从表格 URL 或知识库节点获取） */
    appToken: string;
    /** 多维表格数据表 ID（table_id） */
    tableId: string;
    /** 本地语言 JSON 目录，不填则使用 outputDir */
    localeDir?: string;
    /** 存 key 的列名，若有「文本」列会改为此名，否则新建此列 @default 'key' */
    keyFieldName?: string;
    /** 飞书建表时可能自带的第一列名，若存在则改名为 keyFieldName @default '文本' */
    defaultFirstColumnName?: string;
    /** 状态列名（单选：待处理/已处理）@default '状态' */
    statusFieldName?: string;
    /** 语言代码 -> 飞书列名，如 { cn: '中文', en: 'English' }，未列出的用语言代码本身 */
    fieldMap?: Record<string, string>;
  };

  /**
   * DeepSeek 翻译（yarn translate）
   * 环境变量 DEEPSEEK_API_KEY 可覆盖 apiKey
   */
  deepSeek: {
    apiKey: string;
    model: string;
    batchSize: number;
    retries: number;
    retryDelayMs: number;
    /** 语言代码 -> 英文语言名（用于翻译 prompt） */
    localLabel: Record<string, string>;
  };

  /**
   * Google Sheets 同步配置（用于 push-google）
   */
  googleSheetsConfig: {
    /** 表格 ID（URL 中 /d/<id>/ 那段） */
    spreadsheetId: string;
    /** Service Account 凭证文件路径（相对项目根目录） */
    credsPath: string;
    /** 本地语言 JSON 目录，不填则使用 outputDir */
    localeDir?: string;
    /** 写入第几个 sheet（从 0 开始）@default 0 */
    sheetIndex?: number;
    /** 代理配置（国内建议开启） */
    proxy?: {
      /** http 或 socks5 */
      protocol: 'http' | 'socks5';
      /** 例如 127.0.0.1 */
      host: string;
      /** 例如 10808 */
      port: number;
    };
  };
}

const config: MagicI18nextConfig = {
  scanDir: './src',
  extensions: ['.vue', '.ts', '.tsx', '.js', '.jsx'],
  outputDir: './src/locales',
  defaultLanguage: 'cn',
  exclude: ['node_modules', 'dist', 'build'],
  paramFormat: '{index}', // 默认格式，适用于 vue-i18n, next-i18n 等
  defaultLocalesDir: './src/locales',
  defaultOutputExcelPath: './data.xlsx',
  feishuConfig: {
    appId: '',
    appSecret: '',
    appToken: '',
    tableId: '',
    localeDir: './src/locales',
    keyFieldName: 'key',
    defaultFirstColumnName: '文本',
    statusFieldName: '状态',
    fieldMap: { cn: '中文', en: 'English', jp: 'Japanese' },
  },
  googleSheetsConfig: {
    spreadsheetId: '',
    credsPath: './google-creds.json',
    sheetIndex: 0,
    localeDir: './src/locales',
    proxy: { protocol: 'http', host: '127.0.0.1', port: 10808 },
  },
  deepSeek: {
    apiKey: '',
    model: 'deepseek-chat',
    batchSize: 40,
    retries: 2,
    retryDelayMs: 1500,
    localLabel: {
      en: 'English',
      jp: 'Japanese',
      ko: 'Korean',
      fr: 'French',
      de: 'German',
      es: 'Spanish',
      pt: 'Portuguese',
      ru: 'Russian',
      ar: 'Arabic',
      vi: 'Vietnamese',
      th: 'Thai',
      cn: 'Simplified Chinese',
      tw: 'Traditional Chinese',
      hk: 'Traditional Chinese (Hong Kong)',
    },
  },
};

export default config;
