/**
 * 服务探测：**任何服务缺失都只是降级，绝不是加载失败**（PROJECT-PLAN §8.3 统一写法）。
 *
 * 宿主的每个服务访问契约都是 optional（`ctx.get('x')`），所以插件从不在 loader 阶段
 * 因为有 / 没有某个服务而抛错；调用点每次自行探测。
 */
import { readTextFile } from './nodefs.js'

/** 取服务；`ctx.get` 抛错或缺失都算"没有"。 */
export function service(ctx, key) {
  try {
    const value = ctx?.get?.(key)
    return value === null ? undefined : value
  } catch {
    return undefined
  }
}

export function hasMethod(target, method) {
  return Boolean(target) && typeof target?.[method] === 'function'
}

/** 一次探测多个服务，返回 {key: boolean}，供 UI / 报告展示降级原因。 */
export function probeServices(ctx, keys) {
  const out = {}
  for (const key of keys) out[key] = service(ctx, key) !== undefined
  return out
}

/**
 * 读文本：**优先宿主 `fs` 服务**（可移植），不可用时退回 `node:fs` 并让调用方记警告。
 * 读取不写盘，但仍受调用方的路径策略约束。
 * @returns {Promise<{text:string, via:'fs-service'|'node-fs'}>}
 */
export async function readTextPreferService(ctx, absolutePath, { signal } = {}) {
  const fsService = service(ctx, 'fs')
  if (hasMethod(fsService, 'resolve') && hasMethod(fsService, 'readText')) {
    try {
      const target = await fsService.resolve(absolutePath, signal === undefined ? {} : { signal })
      const text = await fsService.readText(target, signal)
      return { text, via: 'fs-service' }
    } catch (error) {
      if (error?.code !== 'FS_NOT_FOUND' && error?.code !== 'ENOENT') {
        // 服务存在但读失败：交回调用方记警告，不静默改成另一条路径
        throw error
      }
      throw error
    }
  }
  const text = await readTextFile(absolutePath)
  return { text, via: 'node-fs' }
}

/** 调服务方法，异常转成结果对象（降级矩阵要求"失败只记警告"）。 */
export async function tryCall(receiver, method, ...args) {
  if (!hasMethod(receiver, method)) return { ok: false, reason: `服务没有 ${method}()` }
  try {
    return { ok: true, value: await receiver[method](...args) }
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error), error }
  }
}
