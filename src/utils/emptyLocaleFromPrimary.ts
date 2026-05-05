export type JsonObject = Record<string, unknown>;

export function isPlainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 与主文件结构一致，所有叶子值为空字符串。 */
export function emptyFromPrimary(primary: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const key of Object.keys(primary)) {
    const pv = primary[key];
    if (isPlainObject(pv)) {
      result[key] = emptyFromPrimary(pv);
    } else {
      result[key] = '';
    }
  }
  return result;
}
