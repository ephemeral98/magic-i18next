/**
 * 是否为空
 * @param target
 * @returns true是空 false有值
 */
export const isEmpty = <T>(target: T): boolean => {
  const targetType = typeof target;
  if (targetType === 'object') {
    if (Array.isArray(targetType)) {
      return !targetType.length;
    }
    return !Object.keys(target).length;
  }

  return !target;
};
