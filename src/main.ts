// 主入口文件
import { main as conversionMain } from './conversion/index';
import { main as json2ExcelMain } from './json2Excel/index';
import { main as excel2JsonMain } from './excel2Json/index';

// 导出所有功能
export {
  conversionMain,
  json2ExcelMain,
  excel2JsonMain
};

// 导出默认对象
export default {
  conversion: conversionMain,
  json2Excel: json2ExcelMain,
  excel2Json: excel2JsonMain
};
