/**
 * 结构化 diff（恢复预览 / §7-#12 配置条目冲突判定用）。
 * 只比较 JSON 值，输出"路径 → before/after"，不做任何写入。
 */
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
  }
  return false
}

const escapePointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * @returns {Array<{pointer:string, before:unknown, after:unknown}>}
 */
export function diffObjects(before, after, pointer = '') {
  const out = []
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) {
      const childPointer = `${pointer}/${escapePointer(key)}`
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key)
      if (hasBefore && !hasAfter) out.push({ pointer: childPointer, before: before[key], after: undefined })
      else if (!hasBefore && hasAfter) out.push({ pointer: childPointer, before: undefined, after: after[key] })
      else out.push(...diffObjects(before[key], after[key], childPointer))
    }
    return out
  }
  if (!deepEqual(before, after)) out.push({ pointer: pointer === '' ? '/' : pointer, before, after })
  return out
}

/** 浅层合并：备份里的键覆盖目标，**不删除**目标独有的键（合并语义）。 */
export function mergeObjects(target, patch) {
  const out = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch ?? {})) out[key] = value
  return out
}

/**
 * 深度合并（恢复时使用）：对象递归合并，数组整体替换，标量覆盖。
 *
 * 比浅合并更保守：**备份里没有的键一个都不动**。例如产物里 `apiKey` 已被剥离，
 * 深度合并不会顺手把目标机原有的 `apiKey` 抹掉。
 */
export function mergeDeep(target, patch) {
  const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!isPlain(patch)) return patch
  const out = isPlain(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlain(value) && isPlain(out[key]) ? mergeDeep(out[key], value) : value
  }
  return out
}
