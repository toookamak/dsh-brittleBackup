/**
 * 凭据状态（U33）：**只问"有没有配"，永不读值**。
 *
 * `credentials.describe(ref)` 的返回值形状随宿主版本变化，所以这里只做结构化解读：
 * 见到布尔字段就按它判断，见到对象就当"已配置"，`undefined` / null 当"缺失"，
 * 服务不可用则明确回答"未检测"而不是猜。
 */
import { hasMethod, service } from './services.js'

export const CREDENTIAL_STATES = Object.freeze({
  configured: '已配置',
  missing: '缺失',
  undetected: '未检测',
})

const BOOLEAN_HINTS = ['configured', 'set', 'present', 'exists', 'available', 'hasValue']

export function interpretCredentialInfo(info) {
  if (info === undefined || info === null) return 'missing'
  if (typeof info === 'boolean') return info ? 'configured' : 'missing'
  if (typeof info === 'object') {
    for (const hint of BOOLEAN_HINTS) {
      if (typeof info[hint] === 'boolean') return info[hint] ? 'configured' : 'missing'
    }
    return 'configured'
  }
  return 'configured'
}

/**
 * @param refs 只有名字（例如 `XIUXIAN_API_KEY`）
 * @returns {Promise<{available:boolean, state:Record<string,'configured'|'missing'|'undetected'>}>}
 */
export async function credentialStates(ctx, refs) {
  const names = [...new Set((Array.isArray(refs) ? refs : []).filter(name => typeof name === 'string' && name !== ''))]
  const credentials = service(ctx, 'credentials')
  if (!hasMethod(credentials, 'describe')) {
    return { available: false, state: Object.fromEntries(names.map(name => [name, 'undetected'])) }
  }
  const state = {}
  for (const name of names) {
    try {
      state[name] = interpretCredentialInfo(await credentials.describe(name))
    } catch {
      state[name] = 'undetected'
    }
  }
  return { available: true, state }
}

/** 给兜底文档用的中文状态表。 */
export function credentialStatusLabels(states) {
  const out = {}
  for (const [name, value] of Object.entries(states ?? {})) out[name] = CREDENTIAL_STATES[value] ?? CREDENTIAL_STATES.undetected
  return out
}

/** 恢复报告的"需要补的 key"清单。 */
export function missingCredentialList(states) {
  return Object.entries(states ?? {})
    .filter(([, value]) => value === 'missing')
    .map(([name]) => name)
}
