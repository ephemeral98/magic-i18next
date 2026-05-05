import fs from 'fs';
import path from 'path';

// 要忽略的文件夹或文件名
export const ignoreDirs = ['node_modules', '.git', 'assets', 'dist', 'build'];
export const ignoreFiles = ['.DS_Store'];

/**
 * 递归读取目录，获取匹配的文件路径
 * @param dirPath 目录路径
 * @param extensions 要匹配的文件扩展名
 * @param exclude 要排除的目录或文件
 * @param fileList 文件列表
 * @returns 文件路径列表
 */
export function readDirRecursive(
  dirPath: string,
  extensions: string[] = ['.vue', '.ts', '.tsx', '.js', '.jsx'],
  exclude: string[] = ['node_modules', '.git', 'assets'],
  fileList: string[] = []
): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);

    if (exclude.includes(file)) {
      return;
    }

    if (fs.statSync(filePath).isDirectory()) {
      readDirRecursive(filePath, extensions, exclude, fileList);
    } else if (extensions.includes(path.extname(filePath))) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * 读取文件内容
 * @param filePath 文件路径
 * @returns 文件内容
 */
export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}
