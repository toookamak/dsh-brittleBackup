/**
 * 恢复前的"宿主现状"快照：一切判定（§7 的 14 项、diff、计划）都基于它。
 *
 * 这个模块只读：读配置条目、读插件清单、读已装 bundle 的 patch 与 package.json、
 * 读 skills 目录名、问 agent 是否忙碌、问凭据是否有值。**任何读取失败都降级成
 * `unknown`**，绝不因为服务缺失而中断导入。
 */
import { join } from 'node:path'
import { profileDir, skillsRoot } from '../paths.js'
import { hasMethod, readTextPreferService, service, tryCall } from '../services.js'
import { listNames, readJsonFile } from '../nodefs.js'
import { readConfiguration, patchIdOf } from '../collect/profile.js'
import { hostVersionFromBundles, readLockInfo } from '../collect/plugins.js'
import { credentialStates } from '../credentials.js'

export function nodeModulesDir(env = process.env) {
  return join(profileDir(env), 'node_modules')
}

/** 从 patch 文本里取所有 `- id: xxx`（含 insert 块内的条目）。 */
export function readPatchIds(text) {
  const out = []
  if (typeof text !== 'string') return out
  const matcher = /^\s*-\s*id:\s*['"]?([^'"\s#]+)['"]?\s*$/gm
  let matched = matcher.exec(text)
  while (matched !== null) {
    out.push(matched[1])
    matched = matcher.exec(text)
  }
  return out
}

async function readInstalled(bundleName, env) {
  const dir = join(nodeModulesDir(env), ...bundleName.split('/'))
  let manifest = null
  let patchIds = []
  try {
    manifest = await readJsonFile(join(dir, 'package.json'))
  } catch {
    manifest = null
  }
  try {
    const patch = await readTextPreferService(null, join(dir, 'cordis.patch.yml'))
    patchIds = readPatchIds(patch.text)
  } catch {
    patchIds = []
  }
  return {
    name: bundleName,
    version: typeof manifest?.version === 'string' ? manifest.version : null,
    description: typeof manifest?.description === 'string' ? manifest.description : '',
    peerDependencies: manifest && typeof manifest.peerDependencies === 'object' && manifest.peerDependencies !== null ? manifest.peerDependencies : {},
    patchIds,
    /** 出现在宿主的 listBundles / listPlugins 里就是"已安装"。 */
    installed: true,
    /** 读到了它的 package.json（peer / 版本判定才可靠）。 */
    manifestFound: manifest !== null,
  }
}

/**
 * @returns 宿主现状（尽力而为；缺失字段是 null / []，不是异常）
 */
export async function gatherHostState({ ctx, env = process.env, logger = null } = {}) {
  const manager = service(ctx, 'pluginManager')
  const bundleResult = hasMethod(manager, 'listBundles') ? await tryCall(manager, 'listBundles') : { ok: false }
  const pluginResult = hasMethod(manager, 'listPlugins') ? await tryCall(manager, 'listPlugins') : { ok: false }
  const bundles = bundleResult.ok && Array.isArray(bundleResult.value) ? bundleResult.value : []
  const plugins = pluginResult.ok && Array.isArray(pluginResult.value) ? pluginResult.value : []

  const configuration = await readConfiguration(ctx)
  const configEntries = new Map()
  const liveEntryIds = new Set()
  if (configuration.ok) {
    for (const record of configuration.configuration) {
      const entry = record?.entry ?? record
      const id = patchIdOf(entry)
      if (id === '') continue
      liveEntryIds.add(typeof entry?.id === 'string' ? entry.id : id)
      configEntries.set(id, {
        id,
        name: typeof entry?.name === 'string' ? entry.name : '',
        entry,
        override: record?.override !== null && typeof record?.override === 'object' ? record.override : {},
      })
    }
  }

  const installed = new Map()
  for (const bundle of bundles) {
    if (typeof bundle?.name !== 'string') continue
    const info = await readInstalled(bundle.name, env)
    info.enabled = bundle.enabled !== false
    info.bundle = true
    installed.set(bundle.name, info)
  }
  for (const plugin of plugins) {
    const name = typeof plugin?.moduleName === 'string' ? plugin.moduleName : ''
    if (name === '' || installed.has(name)) continue
    const info = await readInstalled(name, env)
    info.enabled = plugin.enabled !== false
    info.bundle = false
    info.entryId = typeof plugin.entryId === 'string' ? plugin.entryId : undefined
    installed.set(name, info)
  }

  const profilePatchText = await readTextPreferService(ctx, join(profileDir(env), 'cordis.patch.yml'))
    .then(result => result.text)
    .catch(() => textOrEmpty())
  const profilePatchIds = readPatchIds(profilePatchText)

  const bundlePatchIds = new Map()
  for (const [name, info] of installed) {
    if (info.patchIds.length > 0) bundlePatchIds.set(name, info.patchIds)
  }

  const lockText = await readTextPreferService(ctx, join(profileDir(env), 'pnpm-lock.yaml'))
    .then(result => result.text)
    .catch(() => '')
  const lockVersions = new Map()
  for (const bundle of bundles) {
    if (typeof bundle?.name !== 'string') continue
    lockVersions.set(bundle.name, readLockInfo(lockText, bundle.name))
  }

  let agentBusy = null
  const agents = service(ctx, 'agents')
  if (hasMethod(agents, 'list')) {
    const listed = await tryCall(agents, 'list')
    if (listed.ok && Array.isArray(listed.value)) {
      agentBusy = listed.value.some(agent => agent?.status === 'running')
    }
  }

  const root = skillsRoot(env)
  const skillNames = new Set()
  for (const entry of await listNames(root)) if (entry.directory) skillNames.add(entry.name)

  const credentials = await credentialStates(ctx, [])

  return {
    profileDirectory: profileDir(env),
    skillsRoot: root,
    dshVersion: hostVersionFromBundles(bundles),
    services: {
      configEditor: configuration.ok,
      configEditorReason: configuration.ok ? null : configuration.reason,
      pluginManager: hasMethod(manager, 'installBundle'),
      pluginManagerReason: hasMethod(manager, 'installBundle') ? null : '宿主没有可用的 pluginManager.installBundle()',
      agents: hasMethod(agents, 'list'),
      credentials: credentials.available,
    },
    bundles,
    plugins,
    installed,
    bundlePatchIds,
    profilePatchIds,
    liveEntryIds: [...liveEntryIds],
    configEntries,
    lockVersions,
    agentBusy,
    skillNames: [...skillNames],
    logger,
  }
}

function textOrEmpty() {
  return ''
}
