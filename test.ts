import { main } from "./src/conversion";
// import { main } from './src/json2Excel';
// import { main } from './src/excel2Json';

// yarn test → 全盘扫描；yarn test src/test/test_1.ts → 只处理指定文件/目录（tsx 下 argv[1] 为脚本路径，用户参数从 argv[2] 起）
const userArgs = process.argv.slice(2);
void main(userArgs.length ? userArgs : undefined);
