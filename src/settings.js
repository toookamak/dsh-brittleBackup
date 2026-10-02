/**
 * 本插件自己的设置。
 *
 * 决策记录（与文档的偏差，见 README 的"实现说明"）：设置**不写进 profile 的
 * `cordis.patch.yml`**，而是落在插件工作目录的 `settings.json`。原因有三：
 *   1. 写 profile 需要 `settings.update(ns, …)` 且 ns 必须对应一个已存在的 entry；
 *      宿主 0.2 代不再提供 `settings.register`，命名空间由插件 Config schema 派生 ——
 *      为了一个"上次导出目录"去引 `@deepseek-ai/schemastery` 静态依赖，代价是
 *      "依赖缺失 = 宿主起不来"，与"loader 阶段零副作用"冲突。
 *   2. 导出目录是本机路径，写进 profile 配置就会被备份带走（SECURITY §2.4 记过这个风险）。
 *   3. 零依赖是本项目的硬目标。
 */
import { workDir, settingsFile } from './paths.js'
import { pathExists, readJsonFile, writeJsonAtomic } from './nodefs.js'

export const DEFAULT_OPTIONS = Object.freeze({
  profile: true,
  plugins: true,
  models: true,
  skills: true,
  skillFiles: false,
  doc: true,
  /**
   * 打包成 zip（体验优化项 2，默认开）。注意它是**运输层**选项，不是产物内容：
   * 它不进 `backup.json` 的 `options`（见 FORMAT.md §1），只进设置与导出请求。
   */
  compress: true,
})

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  lastExportDir: '',
  lastImportDir: '',
  options: DEFAULT_OPTIONS,
  snapshotKeep: 10,
  /** `pnpm-workspace.yaml`（allowBuilds）还原必须显式确认，不静默应用。 */
  ackBuildScripts: false,
})

const asBoolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const asText = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

/** 把任意输入收敛成合法设置（未知字段丢弃，类型不符用默认值）。 */
export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const options = input.options && typeof input.options === 'object' ? input.options : {}
  const keep = Number.isInteger(input.snapshotKeep) && input.snapshotKeep >= 1 && input.snapshotKeep <= 100
    ? input.snapshotKeep
    : DEFAULT_SETTINGS.snapshotKeep
  return {
    version: 1,
    lastExportDir: asText(input.lastExportDir),
    lastImportDir: asText(input.lastImportDir),
    options: {
      profile: asBoolean(options.profile, DEFAULT_OPTIONS.profile),
      plugins: asBoolean(options.plugins, DEFAULT_OPTIONS.plugins),
      models: asBoolean(options.models, DEFAULT_OPTIONS.models),
      skills: asBoolean(options.skills, DEFAULT_OPTIONS.skills),
      skillFiles: asBoolean(options.skillFiles, DEFAULT_OPTIONS.skillFiles),
      doc: asBoolean(options.doc, DEFAULT_OPTIONS.doc),
      compress: asBoolean(options.compress, DEFAULT_OPTIONS.compress),
    },
    snapshotKeep: keep,
    ackBuildScripts: asBoolean(input.ackBuildScripts, DEFAULT_SETTINGS.ackBuildScripts),
  }
}

export function settingsPath(env = process.env) {
  return settingsFile(env)
}

/**
 * 产物的 `options`（FORMAT.md §2 的那六个内容项）。
 * `compress` 是运输层选项，写进 `backup.json` 只会让 schema 无意义地膨胀，所以在这里剥掉。
 */
export const CONTENT_OPTION_KEYS = Object.freeze(['profile', 'plugins', 'models', 'skills', 'skillFiles', 'doc'])

export function contentOptions(options) {
  const source = options !== null && typeof options === 'object' ? options : {}
  const out = {}
  for (const key of CONTENT_OPTION_KEYS) out[key] = source[key] === true
  return out
}

export async function loadSettings(env = process.env) {
  const path = settingsPath(env)
  if (!(await pathExists(path))) return { settings: normalizeSettings(undefined), path, degraded: false }
  try {
    return { settings: normalizeSettings(await readJsonFile(path)), path, degraded: false }
  } catch (error) {
    return { settings: normalizeSettings(undefined), path, degraded: true, reason: error?.message ?? String(error) }
  }
}

/** 局部更新：只覆盖 patch 里出现的字段（`options` 整体替换，避免半更新）。 */
export async function saveSettings(patch, env = process.env) {
  const { settings } = await loadSettings(env)
  const next = normalizeSettings({
    ...settings,
    ...patch,
    options: patch?.options === undefined ? settings.options : { ...settings.options, ...patch.options },
  })
  await writeJsonAtomic(settingsPath(env), next)
  return next
}

export function describeWorkDir(env = process.env) {
  return workDir(env)
}
