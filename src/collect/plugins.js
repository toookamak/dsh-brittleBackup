/**
 * 采集插件清单（FORMAT.md §2 items.plugins）。
 *
 * 只读来源：profile `package.json` 的 `dependencies`（spec 的唯一权威）+ `dsh.profile.bundles`
 * （顺序）+ `pluginManager.listBundles()/listPlugins()`（实际版本 / 启用状态 / 用途）+ 
 * `pnpm-lock.yaml`（git commit，纯文本启发式）。
 *
 * 写入归属（U37）：本插件**从不写** `package.json` / lock / bundles 顺序；安装与启停
 * 全部交给 `pluginManager`。
 */
import { isAbsolute } from 'node:path'
import { hasMethod, tryCall } from '../services.js'

/** spec → 来源类型（FORMAT 枚举：registry | github | local-path | unknown）。 */
export function classifySpec(spec) {
  if (typeof spec !== 'string' || spec.trim() === '') return { source: 'unknown', path: null }
  const value = spec.trim()
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(value)
  if (protocol !== null) {
    const scheme = protocol[1].toLowerCase()
    if (scheme === 'link' || scheme === 'file') return { source: 'local-path', path: value.slice(protocol[0].length) }
    if (scheme === 'github') return { source: 'github', path: null }
    if (scheme === 'git' || scheme.startsWith('git+')) return { source: 'github', path: null }
    if (scheme === 'http' || scheme === 'https') return { source: 'github', path: null }
    if (scheme === 'npm') return { source: 'registry', path: null }
    return { source: 'unknown', path: null }
  }
  // 裸 semver / 范围（`^1.66.7`、`~0.2.0`、`1.2.3`、`latest`、`*`）都是 registry 依赖。
  return { source: 'registry', path: null }
}

/** 兜底文档里的安装命令：registry 优先用解析到的精确版本。 */
export function installCommandFor(name, spec, source, resolvedVersion) {
  if (source === 'registry') {
    if (typeof resolvedVersion === 'string' && resolvedVersion !== '') return `dsh plugin add ${name}@${resolvedVersion}`
    if (/^\d/.test(spec)) return `dsh plugin add ${name}@${spec}`
    return `dsh plugin add ${name}`
  }
  return `dsh plugin add ${spec}`
}

/**
 * 从 pnpm-lock 文本里取某个包的解析版本与 git commit（启发式：表头行 + 其后 12 行内找 commit）。
 * 取不到就是 `null` —— 不猜。
 */
export function readLockInfo(lockText, name) {
  if (typeof lockText !== 'string' || lockText === '' || typeof name !== 'string' || name === '') {
    return { version: null, commit: null }
  }
  const lines = lockText.split(/\r?\n/)
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const header = new RegExp(`^\\s{2,}/?${escaped}@([^\\s():]+):\\s*$`)
  for (let index = 0; index < lines.length; index += 1) {
    const matched = header.exec(lines[index])
    if (!matched) continue
    let commit = null
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 12); cursor += 1) {
      const line = lines[cursor]
      if (/^\S/.test(line) || /^\s{2}\S/.test(line)) break
      const found = /commit:\s*([0-9a-f]{7,40})/i.exec(line)
      if (found) {
        commit = found[1]
        break
      }
    }
    return { version: matched[1], commit }
  }
  return { version: null, commit: null }
}

/**
 * @param pkg 已解析的 profile package.json
 * @param lockText pnpm-lock.yaml 原文（可为空）
 * @param bundles `pluginManager.listBundles()` 的结果
 * @param plugins `pluginManager.listPlugins()` 的结果
 */
export function collectPlugins({ pkg, lockText = '', bundles = [], plugins = [] }) {
  const warnings = []
  const dependencies = pkg && typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {}
  const order = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  const bundleList = Array.isArray(bundles) ? bundles : []
  const pluginList = Array.isArray(plugins) ? plugins : []

  const items = []
  for (const [name, spec] of Object.entries(dependencies)) {
    const { source, path } = classifySpec(spec)
    const bundle = bundleList.find(item => item?.name === name)
    const plugin = pluginList.find(item => item?.moduleName === name)
    const lock = readLockInfo(lockText, name)
    const resolvedVersion = bundle?.version ?? lock.version ?? null
    if (resolvedVersion === null) warnings.push(`拿不到 ${name} 的实际版本（listBundles / lockfile 都没有）`)
    const finalSource = source === 'local-path' && typeof path === 'string' && isAbsolute(path) ? 'local-path' : source
    items.push({
      name,
      spec: String(spec),
      resolvedVersion: resolvedVersion === null ? null : String(resolvedVersion),
      source: finalSource,
      commit: lock.commit ?? null,
      bundle: order.includes(name),
      enabled: bundle?.enabled ?? plugin?.enabled ?? true,
      description: typeof bundle?.description === 'string' ? bundle.description : '',
      installCommand: installCommandFor(name, String(spec), finalSource, resolvedVersion === null ? null : String(resolvedVersion)),
      unportable: finalSource === 'local-path' && typeof path === 'string' && isAbsolute(path),
    })
  }

  const dependenciesNames = new Set(Object.keys(dependencies))
  for (const name of order) {
    if (!dependenciesNames.has(name)) {
      warnings.push(`${name} 在 dsh.profile.bundles 里但不在 dependencies 里（由安装提供），只记录不装`)
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name))
  return { plugins: items, bundlesOrder: order, warnings }
}

/** 读取宿主插件清单；服务缺失时返回空数组并让调用方记警告。 */
export async function readPluginInventory(ctx) {
  const manager = ctx?.get?.('pluginManager')
  const bundles = hasMethod(manager, 'listBundles') ? await tryCall(manager, 'listBundles') : { ok: false, reason: 'no pluginManager' }
  const plugins = hasMethod(manager, 'listPlugins') ? await tryCall(manager, 'listPlugins') : { ok: false, reason: 'no pluginManager' }
  return {
    bundles: bundles.ok && Array.isArray(bundles.value) ? bundles.value : [],
    plugins: plugins.ok && Array.isArray(plugins.value) ? plugins.value : [],
    available: hasMethod(manager, 'installBundle'),
    reason: bundles.ok ? null : bundles.reason,
  }
}

/** DSH 宿主版本：取核心 bundle 的版本；取不到写 "unknown"（不猜、不省略字段）。 */
export function hostVersionFromBundles(bundles) {
  const list = Array.isArray(bundles) ? bundles : []
  const core = list.find(item => item?.name === '@deepseek-ai/dsh-base')
    ?? list.find(item => typeof item?.name === 'string' && item.name.startsWith('@deepseek-ai/dsh'))
  return typeof core?.version === 'string' && core.version !== '' ? core.version : 'unknown'
}
