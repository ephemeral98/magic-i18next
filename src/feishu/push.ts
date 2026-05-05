import fs from 'fs';
import path from 'path';
import * as lark from '@larksuiteoapi/node-sdk';
import { getConfig } from '../config/runtime';

/**
 * 平铺 JSON 数据，将 { auto: { "1": "xxx" } } 转为 "auto.1": "xxx"
 */
function flattenI18n(obj, prefix = '') {
  const results = {};
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

async function syncToFeishu() {
  const config = getConfig();
  const fc = config.feishuConfig;
  const LOCALE_DIR = fc.localeDir ?? config.outputDir;
  const KEY_FIELD_NAME = fc.keyFieldName ?? 'key';
  const DEFAULT_FIRST_COLUMN_NAME = fc.defaultFirstColumnName ?? '文本';
  const STATUS_FIELD_NAME = fc.statusFieldName ?? '状态';

  const client = new lark.Client({
    appId: fc.appId,
    appSecret: fc.appSecret,
  });

  console.log('\n🚀 飞书同步脚本启动 (push)...\n');
  try {
    // 1. 读取本地目录下的所有语言 JSON
    if (!fs.existsSync(LOCALE_DIR)) {
      throw new Error(`目录不存在: ${LOCALE_DIR}，请先执行 rep 生成国际化文件`);
    }
    const files = fs.readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error(`${LOCALE_DIR} 下没有 .json 文件，请先执行 rep 生成`);
    }
    const masterData = {}; // 结构: { "auto.1": { "cn": "...", "en": "..." } }
    const languages = [];

    files.forEach((file) => {
      const lang = path.basename(file, '.json'); // 例如 cn, en
      languages.push(lang);
      const content = JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, file), 'utf-8'));
      const flattened = flattenI18n(content);

      Object.entries(flattened).forEach(([key, value]) => {
        if (!masterData[key]) masterData[key] = {};
        masterData[key][lang] = value;
      });
    });

    console.log(`\n🔍 本地检测到语种: ${languages.join(', ')}`);
    console.log(`🔍 待查对词条总数: ${Object.keys(masterData).length}`);

    const fieldMap: Record<string, string> = fc.fieldMap ?? {};

    // 2. 确保所需列存在，缺失则自动创建（不包含 key：用表格自带的「文本」列存 key）
    const requiredFields = new Set<string>([STATUS_FIELD_NAME]);
    languages.forEach((lang) => requiredFields.add(fieldMap[lang] || lang));

    const fieldListRes = await client.bitable.appTableField.list({
      path: { app_token: fc.appToken, table_id: fc.tableId },
      params: { page_size: 500 },
    });
    const fieldItems = (fieldListRes.data?.items ?? []) as { field_id?: string; field_name?: string; type?: number }[];
    const existingFieldNames = new Set<string>(fieldItems.map((f) => f.field_name).filter(Boolean));

    // 确保 key 列存在且列名为 "key"：有「文本」则改名为 key，没有则新建 key 列
    if (existingFieldNames.has(KEY_FIELD_NAME)) {
      // 已有 key 列，无需处理
    } else if (existingFieldNames.has(DEFAULT_FIRST_COLUMN_NAME)) {
      const textField = fieldItems.find((f) => f.field_name === DEFAULT_FIRST_COLUMN_NAME);
      if (textField?.field_id != null) {
        const updateRes = await client.bitable.appTableField.update({
          path: { app_token: fc.appToken, table_id: fc.tableId, field_id: textField.field_id },
          data: { field_name: KEY_FIELD_NAME, type: textField.type ?? 1 },
        });
        if (updateRes.code !== 0) {
          console.error(`❌ 将「${DEFAULT_FIRST_COLUMN_NAME}」列改名为「${KEY_FIELD_NAME}」失败:`, updateRes.msg);
          throw new Error(`无法重命名列: ${updateRes.msg}`);
        }
        console.log(`📝 已将第一列「${DEFAULT_FIRST_COLUMN_NAME}」改名为「${KEY_FIELD_NAME}」`);
        existingFieldNames.delete(DEFAULT_FIRST_COLUMN_NAME);
        existingFieldNames.add(KEY_FIELD_NAME);
        await new Promise((r) => setTimeout(r, 150));
      }
    } else {
      const createRes = await client.bitable.appTableField.create({
        path: { app_token: fc.appToken, table_id: fc.tableId },
        data: { field_name: KEY_FIELD_NAME, type: 1 },
      });
      if (createRes.code !== 0) {
        console.error(`❌ 创建「${KEY_FIELD_NAME}」列失败:`, createRes.msg);
        throw new Error(`无法创建列: ${KEY_FIELD_NAME}`);
      }
      console.log(`📝 已创建「${KEY_FIELD_NAME}」列`);
      existingFieldNames.add(KEY_FIELD_NAME);
      await new Promise((r) => setTimeout(r, 150));
    }

    const toCreateFields = [...requiredFields]
      .filter((name) => !existingFieldNames.has(name))
      .sort((a, b) => (a === STATUS_FIELD_NAME ? 1 : b === STATUS_FIELD_NAME ? -1 : 0)); // 状态列最后创建
    if (toCreateFields.length > 0) {
      console.log(`📝 检测到缺失列，正在自动创建: ${toCreateFields.join(', ')}`);
      for (const fieldName of toCreateFields) {
        const isStatusField = fieldName === STATUS_FIELD_NAME;
        const createRes = await client.bitable.appTableField.create({
          path: { app_token: fc.appToken, table_id: fc.tableId },
          data: isStatusField
            ? { field_name: fieldName, type: 3, property: { options: [{ name: '待处理' }, { name: '已处理' }] } } // 3 = 单选
            : { field_name: fieldName, type: 1 }, // 1 = 文本
        });
        if (createRes.code !== 0) {
          console.error(`❌ 创建列 "${fieldName}" 失败:`, createRes.msg, (createRes as { error?: unknown }).error);
          throw new Error(`无法创建列: ${fieldName}`);
        }
        console.log(`   ✓ 已创建列: ${fieldName}`);
        existingFieldNames.add(fieldName);
        await new Promise((r) => setTimeout(r, 150)); // 避免触发 API 频率限制
      }
    }

    // 3. 获取飞书表格中已有的 Key
    const existingKeys = new Map(); // Key -> record_id
    let pageToken = '';

    console.log('📡 正在读取飞书云端数据...');
    do {
      const res = await client.bitable.appTableRecord.list({
        path: { app_token: fc.appToken, table_id: fc.tableId },
        params: { page_token: pageToken, page_size: 500 },
      });
      res.data.items?.forEach((item) => {
        const k = item.fields[KEY_FIELD_NAME] ?? item.fields[DEFAULT_FIRST_COLUMN_NAME] ?? item.fields.Key;
        if (k) existingKeys.set(k, item.record_id);
      });
      pageToken = res.data.page_token;
    } while (pageToken);

    // 4. 准备新增和更新的数据（顺序：auto 全部在前，extra 全部在后，其余按前缀再按 key 排序）
    const toCreate = [];
    const toUpdate = [];

    const keyOrder = (k: string) =>
      k.startsWith('auto.') ? 0 : k.startsWith('extra.') ? 1 : 2;
    const sortedKeys = Object.keys(masterData).sort((a, b) => {
      if (keyOrder(a) !== keyOrder(b)) return keyOrder(a) - keyOrder(b);
      // 同组内：auto.1, auto.2, auto.10 按数字排，避免 auto.10 排在 auto.2 前
      const numA = a.match(/\.(\d+)$/)?.[1];
      const numB = b.match(/\.(\d+)$/)?.[1];
      if (numA != null && numB != null) {
        const nA = parseInt(numA, 10);
        const nB = parseInt(numB, 10);
        if (nA !== nB) return nA - nB;
      }
      return a.localeCompare(b);
    });

    const localKeySet = new Set(sortedKeys);
    sortedKeys.forEach((key) => {
      const fields: any = { [KEY_FIELD_NAME]: key };
      languages.forEach((lang) => {
        const fieldName = fieldMap[lang] || lang;
        fields[fieldName] = masterData[key][lang] || '';
      });

      if (existingKeys.has(key)) {
        fields[STATUS_FIELD_NAME] = '待处理';
        toUpdate.push({ record_id: existingKeys.get(key), fields });
      } else {
        fields[STATUS_FIELD_NAME] = '待处理';
        toCreate.push({ fields });
      }
    });

    // 本地没有的 key：从飞书删除，使表格与本地完全一致（全量同步）
    const toDeleteRecordIds: string[] = [];
    existingKeys.forEach((recordId, key) => {
      if (!localKeySet.has(key)) toDeleteRecordIds.push(recordId);
    });

    const BATCH_SIZE = 100;
    const DELETE_BATCH_SIZE = 500; // 飞书单次最多删除 500 条

    if (toDeleteRecordIds.length > 0) {
      const deleteBatchCount = Math.ceil(toDeleteRecordIds.length / DELETE_BATCH_SIZE);
      console.log(`🗑️  正在删除 ${toDeleteRecordIds.length} 条云端多余记录（共 ${deleteBatchCount} 批）...`);
      for (let i = 0; i < toDeleteRecordIds.length; i += DELETE_BATCH_SIZE) {
        const batch = toDeleteRecordIds.slice(i, i + DELETE_BATCH_SIZE);
        const res = await client.bitable.appTableRecord.batchDelete({
          path: { app_token: fc.appToken, table_id: fc.tableId },
          data: { records: batch },
        });
        if (res.code !== 0) {
          console.error(`\n❌ 批量删除失败: ${res.msg}`);
          console.error(JSON.stringify((res as { error?: unknown }).error, null, 2));
        } else {
          const done = Math.min(i + DELETE_BATCH_SIZE, toDeleteRecordIds.length);
          process.stdout.write(`\r   已删除 ${done}/${toDeleteRecordIds.length}`);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      console.log('');
    }

    // 5. 批量操作飞书 (每批次限制 100 条，约 1～2 秒/批，1.8 万条约 3～6 分钟)
    if (toCreate.length > 0) {
      const batchCount = Math.ceil(toCreate.length / BATCH_SIZE);
      console.log(`🚀 正在上传 ${toCreate.length} 个新词条（共 ${batchCount} 批，约 ${Math.ceil((batchCount * 1.5) / 60)} 分钟）...`);
      const createStart = Date.now();
      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        const batch = toCreate.slice(i, i + BATCH_SIZE);
        const res = await client.bitable.appTableRecord.batchCreate({
          path: { app_token: fc.appToken, table_id: fc.tableId },
          data: { records: batch },
        });
        if (res.code !== 0) {
          console.error(`\n❌ 批量上传失败 [${i + 1}-${i + batch.length}]: ${res.msg}`);
          console.error(JSON.stringify((res as { error?: unknown }).error, null, 2));
        } else {
          const done = Math.min(i + BATCH_SIZE, toCreate.length);
          process.stdout.write(`\r   已上传 ${done}/${toCreate.length}`);
        }
        await new Promise((r) => setTimeout(r, 120)); // 适当间隔，降低被限频概率
      }
      console.log(`\n   新增完成，耗时 ${((Date.now() - createStart) / 1000).toFixed(1)} 秒`);
    }

    // 默认脚本也自动覆盖云端已有的翻译
    if (toUpdate.length > 0) {
      const batchCount = Math.ceil(toUpdate.length / BATCH_SIZE);
      console.log(`♻️  正在更新 ${toUpdate.length} 个现有词条（共 ${batchCount} 批）...`);
      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE);
        const res = await client.bitable.appTableRecord.batchUpdate({
          path: { app_token: fc.appToken, table_id: fc.tableId },
          data: { records: batch },
        });
        if (res.code !== 0) {
          console.error(`\n❌ 批量更新失败 [${i + 1}-${i + batch.length}]: ${res.msg}`);
          console.error(JSON.stringify((res as { error?: unknown }).error, null, 2));
        } else {
          const done = Math.min(i + BATCH_SIZE, toUpdate.length);
          process.stdout.write(`\r   已更新 ${done}/${toUpdate.length}`);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      console.log('');
    }

    console.log('\n✨ 同步完成！本地与飞书已一致（全量同步）');
    console.log(`   - 新增: ${toCreate.length} 条`);
    console.log(`   - 更新: ${toUpdate.length} 条`);
    console.log(`   - 删除: ${toDeleteRecordIds.length} 条（云端多余）`);
  } catch (error) {
    console.error('\n❌ 同步失败:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error);
    }
  }
}

syncToFeishu();
