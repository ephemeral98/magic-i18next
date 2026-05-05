// 类型定义
export interface ConversionMap {
  [key: string]: {
    [key: string]: string;
  };
}

export interface FileInfo {
  path: string;
  content: string;
}

export interface ReplacementOptions {
  regex: RegExp;
  pathName: string;
  conversionMap: ConversionMap;
  bakContent: ConversionMap;
}
