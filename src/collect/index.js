/**
 * 采集总编排（M1）：把 profile / 插件 / 模型 / skills 汇总成产物的 `items`。
 *
 * 硬规则（PROJECT-PLAN §6.1）：逐项 try/catch，**任何单项失败都只变成一条警告**；
 * 唯一的硬失败是读不到 `package.json`（它是恢复的最低要求）。
 * 本函数只读，不写任何文件。
 */
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'
import { profileDir, workDir } from '../paths.js'
import { readJsonFile } from '../nodefs.js'
import { hasMethod, service, tryCall, readTextPreferService } from '../services.js'
import { secretMapFromDescriptors } from '../redact.js'
import { collectConfigEntries, collectProfileFiles, readConfiguration, readAllowBuilds } from './profile.js'
import { collectPlugins, hostVersionFromBundles, readPluginInventory } from './plugins.js'
import { collectModels, validateModelStructure } from './models.js'
import { collectSkills } from './skills.js'

let cachedVersion = null

/** 本插件自己的版本（读自己的 package.json；读不到写 "unknown"）。 */
export async function ownVersion() {
  if (cachedVersion !== null) return cachedVersion
  try {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url))
    const pkg = await readJsonFile(path)
    cachedVersion = typeof pkg?.version === 'string' ? pkg.version : 'unknown'
  } catch {
    cachedVersion = 'unknown'
  }
  return cachedVersion
}

async function readSettingsDescriptors(ctx) {
  const settings = service(ctx, 'settings')
  if (!hasMethod(settings, 'describe')) return { ok: false, descriptors: [], reason: '宿主没有可用的 settings.describe()' }
  try {
    const descriptors = await settings.describe({ redactSecrets: true })
    return { ok: true, descriptors: Array.isArray(descriptors) ? descriptors : [] }
  } catch (error) {
    return { ok: false, descriptors: [], reason: error?.message ?? String(error) }
  }
}

/**
 * @param options 勾选项（六项，见 FORMAT.md `options`）
 * @returns 产物的 items 草稿 + 警告；写入由 artifact.js 负责
 */
export async function collectAll({ ctx, env = process.env, options, logger } = {}) {
  const warnings = []
  const want = {
    profile: options?.profile !== false,
    plugins: options?.plugins !== false,
    models: options?.models !== false,
    skills: options?.skills !== false,
    skillFiles: options?.skillFiles === true,
    doc: options?.doc !== false,
  }

  const directory = profileDir(env)
  const inventory = await readPluginInventory(ctx)
  if (!inventory.available) warnings.push(`宿主插件管理不可用（${inventory.reason ?? '未知原因'}），插件清单只能记录、不能自动安装`)

  const descriptors = await readSettingsDescriptors(ctx)
  if (!descriptors.ok) warnings.push(`密钥路径图不可用（${descriptors.reason}），脱敏退化为字段名启发式`)
  const secretMap = secretMapFromDescriptors(descriptors.descriptors)

  const profileFiles = await collectProfileFiles({ ctx, profileDirectory: directory, warnings })
  if (profileFiles.pkg === null && profileFiles.absent.includes('package.json')) {
    const error = new Error(`读不到 ${directory}\\package.json：那是恢复的最低要求，导出中止`)
    error.code = 'PACKAGE_JSON_MISSING'
    throw error
  }
  // package.json 总是要读（插件清单与"最低要求"判定都依赖它），但只有勾选了 profile 才进产物。
  if (!want.profile) {
    warnings.push('未勾选 profile 配置：cordis.patch.yml 条目、package.json、pnpm-workspace.yaml 都不进产物')
  }
  if (!want.plugins) warnings.push('未勾选插件清单：产物里没有 plugins[]')
  if (!want.models) warnings.push('未勾选模型配置：产物里没有 models[] / defaultModel')
  if (!want.skills) warnings.push('未勾选 skills 清单：产物里没有 skills[]')

  const lock = await readTextPreferService(ctx, `${directory}\\pnpm-lock.yaml`).catch(() => ({ text: '' }))

  const configuration = want.profile ? await readConfiguration(ctx) : { ok: false, reason: '未勾选 profile 配置' }
  let entries = []
  const redactions = want.profile ? [...profileFiles.redactions] : []
  if (configuration.ok) {
    const collected = collectConfigEntries(configuration.configuration, { secretMap })
    entries = collected.entries
    warnings.push(...collected.warnings)
    // items.redactions[] 是契约字段：条目级剥离记录汇总到这里（ref = patch 目标 id）。
    for (const entry of entries) {
      for (const item of entry.redactions) redactions.push({ kind: 'entry', ref: entry.id, pointer: item.pointer, reason: item.reason, note: '恢复后请在设置中补 key（原为内联值）' })
    }
    if (!descriptors.ok) {
      for (const entry of entries) warnings.push(`条目 ${entry.id} 的密钥路径图不可用，仅靠字段名剥离`)
    }
  } else if (want.profile) {
    warnings.push(configuration.reason)
  }

  const pluginCollection = collectPlugins({
    pkg: profileFiles.pkg,
    lockText: lock.text,
    bundles: inventory.bundles,
    plugins: inventory.plugins,
  })
  warnings.push(...pluginCollection.warnings)

  const modelCollection = want.models ? collectModels(entries) : { providers: [], defaultModel: null, requiredCredentials: [], warnings: [] }
  if (want.models) {
    warnings.push(...modelCollection.warnings)
    const modelProblems = validateModelStructure(modelCollection.providers)
    for (const problem of modelProblems) warnings.push(`模型配置结构可疑：${problem}`)
  }

  let skills = []
  let skillsRootPath = null
  let skillSource = 'dir'
  if (want.skills) {
    const collected = await collectSkills({ ctx, env })
    skills = collected.skills
    skillsRootPath = collected.root
    skillSource = collected.source
    warnings.push(...collected.warnings)
  }

  const packages = inventory.bundles.length > 0 ? inventory.bundles : []
  const workspaceText = profileFiles.files.find(item => item.path === 'pnpm-workspace.yaml')?.text ?? ''

  const items = {
    config: { source: configuration.ok ? 'config-editor' : 'unavailable', entries },
    files: want.profile ? profileFiles.files : [],
    absent: want.profile ? profileFiles.absent : [],
    redactions,
    plugins: want.plugins ? pluginCollection.plugins : [],
    models: modelCollection.providers,
    defaultModel: modelCollection.defaultModel,
    requiredCredentials: modelCollection.requiredCredentials,
    skills,
    stats: {
      entryCount: entries.length,
      fileCount: want.profile ? profileFiles.files.length : 0,
      bytes: 0,
      itemCounts: {
        plugins: want.plugins ? pluginCollection.plugins.length : 0,
        models: modelCollection.providers.length,
        skills: skills.length,
      },
    },
  }

  const producer = {
    plugin: 'dsh-brittle-backup',
    pluginVersion: await ownVersion(),
    dshVersion: hostVersionFromBundles(packages),
    hostRuntime: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    hostname: safeHostname(),
  }

  const meta = {
    profileDirectory: directory,
    workDirectory: workDir(env),
    lockAvailable: lock.text !== '',
    allowBuilds: readAllowBuilds(workspaceText),
    skillsRoot: skillsRootPath,
    skillSource,
    bundlesOrder: pluginCollection.bundlesOrder,
    services: {
      // 这里只回答"**宿主有没有**这个服务"，即**可用性**，由宿主探测单独决定。
      // 刻意不用 `configuration.ok` / `skillSource !== 'dir'`：那两个标志混进了"用户这次勾没勾"
      // （不勾 profile 时根本不会去读配置），于是用户主动不勾就被说成"服务不可用"。
      // 用户的选择由 warnings 里的"未勾选…"如实告知，不混进 degradation。
      configEditor: serviceAvailable(ctx, 'configEditor', 'configuration'),
      settings: descriptors.ok,
      pluginManager: inventory.available,
      skills: serviceAvailable(ctx, 'skills', 'list'),
    },
  }

  return { options: want, items, producer, warnings, meta }
}

function safeHostname() {
  try {
    const value = hostname()
    return typeof value === 'string' && value !== '' ? value : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 给报告用：哪些**能力**在降级（UI 必须明示）。
 *
 * 只依据 `meta.services` 里的**服务可用性**产出 —— 那几个标志现在只由宿主探测决定。
 * 用户这次没勾选某项是**选择**而不是能力缺失，所以绝不能出现在这里：
 * 它由 collectAll 的 warnings（"未勾选 profile 配置：…"）如实告知。
 */
export function degradationNotes(meta) {
  const services = meta?.services ?? {}
  const notes = []
  if (!services.configEditor) notes.push('当前 DSH 版本不支持配置的自动还原（configEditor 不可用）。这次只处理插件、模型和 skills；配置请打开兜底文档.md 手工重配。')
  if (!services.settings) notes.push('密钥路径图不可用，脱敏退化为字段名启发式。导出后用②里的查询自己核对。')
  if (!services.pluginManager) notes.push('插件管理不可用，插件不能自动安装。打开这份产物里的兜底文档.md，按里面的安装命令做。')
  if (!services.skills) notes.push('skills 服务不可用，元数据来自目录扫描。名单可能不全，导出前请自己核对 skills 目录。')
  return notes
}

/** 测试与调试用：判断某个服务是否可用（不改状态）。 */
export function serviceAvailable(ctx, key, method) {
  const target = service(ctx, key)
  return hasMethod(target, method)
}

export { tryCall }
