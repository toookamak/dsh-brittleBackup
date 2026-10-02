/**
 * 路径、命名常量与"包含关系"守卫。
 *
 * 这里的取值是 [docs/PROJECT-PLAN.md](../../docs/PROJECT-PLAN.md) 命名约定表的实现侧副本：
 * 产物格式 / 目录前缀 / entry id / 工作目录。改一处必须同时改文档。
 */
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const PLUGIN_ID = 'brittle-backup'
export const PACKAGE_NAME = 'dsh-brittlebackup'
export const ARTIFACT_FORMAT = 'dsh-brittle-backup'
export const ARTIFACT_VERSION = 1
export const ARTIFACT_PREFIX = 'dsh-brittle-backup-'
export const BACKUP_FILE = 'backup.json'
export const DOC_FILE = '兜底文档.md'
export const SKILLS_DIRNAME = 'skills'
export const SETTINGS_FILE = 'settings.json'
export const SNAPSHOT_KEEP = 10

/** 导入侧永不写入 / 永不删除的路径段（见 SECURITY.md §6）。 */
export const EXCLUDED_SEGMENTS = Object.freeze([
  'node_modules',
  '.credentials.yaml',
  '.dsh-market',
  '.plugin-manager',
  'cordis.yml',
])

export function dshHome(env = process.env) {
  const value = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return value === '' ? join(homedir(), '.dsh') : resolve(value)
}

export function profileDir(env = process.env) {
  const value = typeof env?.DSH_PROFILE_DIR === 'string' ? env.DSH_PROFILE_DIR.trim() : ''
  if (value !== '') return resolve(value)
  const profile = typeof env?.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim() !== '' ? env.DSH_PROFILE.trim() : 'desktop'
  return join(dshHome(env), 'profiles', profile)
}

/** 插件内部工作目录：快照与临时文件，**不是**导出落点。 */
export function workDir(env = process.env) {
  return join(dshHome(env), 'dsh-brittle-backup')
}

export function snapshotsDir(env = process.env) {
  return join(workDir(env), 'snapshots')
}

export function settingsFile(env = process.env) {
  return join(workDir(env), SETTINGS_FILE)
}

export function skillsRoot(env = process.env) {
  return join(dshHome(env), 'skills')
}

export function fallbackExportRoot(env = process.env) {
  return join(workDir(env), 'exports')
}

function comparable(path) {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** child 是否位于 parent 之内（含相等）。 */
export function isWithin(parent, child) {
  const rel = relative(comparable(parent), comparable(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function assertWithin(parent, child, what) {
  if (!isWithin(parent, child)) {
    throw new Error(`${what} 越出允许范围：${child} 不在 ${parent} 之内`)
  }
  return child
}

const pad = (value, width = 2) => String(value).padStart(width, '0')

/** 目录名用的本地时间戳 `YYYYMMDD-HHmmss`。 */
export function timestamp(date = new Date()) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const clock = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${stamp}-${clock}`
}

export function isoNow(date = new Date()) {
  return date.toISOString()
}

/**
 * 产物内路径的合法性（FORMAT.md §2 关键约束）：
 * 相对路径、无 `..`、无盘符 / 前导斜杠、未命中排除名单。
 */
export function checkArtifactPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, reason: 'path 为空或不是字符串' }
  const raw = value.replace(/\\/g, '/')
  if (raw.startsWith('/')) return { ok: false, reason: 'path 是绝对路径' }
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, reason: 'path 带盘符' }
  const segments = raw.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return { ok: false, reason: 'path 为空' }
  if (segments.some(segment => segment === '..')) return { ok: false, reason: 'path 含 ".."' }
  const hit = segments.find(segment => EXCLUDED_SEGMENTS.includes(segment))
  if (hit !== undefined) return { ok: false, reason: `path 命中排除名单：${hit}` }
  return { ok: true, relative: segments.join('/') }
}

/** 把产物内的相对路径解析成 root 下的绝对路径；越界即抛错。 */
export function resolveArtifactPath(root, relativePath) {
  const checked = checkArtifactPath(relativePath)
  if (!checked.ok) throw new Error(`非法产物路径 ${relativePath}：${checked.reason}`)
  const target = resolve(root, ...checked.relative.split('/'))
  assertWithin(root, target, '产物路径')
  return target
}
