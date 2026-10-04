/**
 * 采集 profile 配置（U32 / U36）。
 *
 * 读取路径：`configEditor.configuration()` 的**原始 override**（完整，不受 schema 投影
 * 丢字段影响）+ `settings.describe({ redactSecrets: true })` 的**密钥路径图**。
 * 收录规则（FORMAT.md "字段语义要点"）：只收 `override` 非空的条目；`entries[].id` 用
 * **patch 目标 id**（实测 loader 内部 id 形如 `include:llm-pi-ai`，profile patch 用 `llm-pi-ai`）。
 */
import { join } from 'node:path'
import { service, hasMethod, readTextPreferService } from '../services.js'
import { secretPointersForEntry, stripSecrets } from '../redact.js'

/** loader 内部 id → patch 目标 id（`include:` 前缀是 loader 的，不是用户的）。 */
export function patchIdOf(entry) {
  const raw = entry?.patchId ?? entry?.id
  if (typeof raw !== 'string' || raw === '') return ''
  return raw.replace(/^include:/, '')
}

export function isNonEmptyObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

/**
 * @param configuration `configEditor.configuration()` 的返回值
 * @returns {{entries:Array, warnings:Array}}
 */
export function collectConfigEntries(configuration, { secretMap } = {}) {
  const entries = []
  const warnings = []
  for (const record of Array.isArray(configuration) ? configuration : []) {
    const entry = record?.entry ?? record
    const id = patchIdOf(entry)
    if (id === '') {
      warnings.push('有一个配置条目没有可用的 patch id，已跳过')
      continue
    }
    const override = record?.override
    if (!isNonEmptyObject(override)) continue
    const inherited = isNonEmptyObject(record?.inherited) ? record.inherited : {}
    const secretPointers = secretPointersForEntry(secretMap, id)
    const { value, redactions } = stripSecrets(override, { secretPointers, prefix: '/override' })
    // 宿主默认值（inherited）同样可能内联密钥，必须走同一条剥离路径；指针前缀用 /inherited 区分。
    const strippedInherited = stripSecrets(inherited, { secretPointers, prefix: '/inherited' })
    const hostSecrets = secretMap?.entries?.get(id) ?? secretMap?.entries?.get(id.replace(/^include:/, '')) ?? []
    entries.push({
      id,
      name: typeof entry?.name === 'string' ? entry.name : '',
      override: value,
      inherited: strippedInherited.value,
      secrets: hostSecrets.map(item => ({ path: [...item.path], set: item.set === true })),
      redactions: [...redactions, ...strippedInherited.redactions],
    })
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { entries, warnings }
}

/**
 * 读 `configEditor.configuration()`；服务缺失返回 null（调用方走降级分支）。
 */
export async function readConfiguration(ctx) {
  const configEditor = service(ctx, 'configEditor')
  if (!hasMethod(configEditor, 'configuration')) return { ok: false, reason: '宿主没有可用的 configEditor.configuration()' }
  try {
    return { ok: true, configuration: await configEditor.configuration() }
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) }
  }
}

/**
 * 读"无法走结构化服务"的两个文件：package.json（JSON）与 pnpm-workspace.yaml（原文）。
 * 读取优先走宿主 `fs` 服务，缺失则退回 `node:fs` 并记警告（读取不写盘）。
 */
export async function collectProfileFiles({ ctx, profileDirectory, warnings }) {
  const files = []
  const absent = []
  const redactions = []

  const packageJsonPath = join(profileDirectory, 'package.json')
  let pkg = null
  try {
    const { text, via } = await readTextPreferService(ctx, packageJsonPath)
    if (via === 'node-fs') warnings.push('宿主没有 fs 服务，profile 文件由 node:fs 直接读取')
    pkg = JSON.parse(text)
    const stripped = stripSecrets(pkg, { prefix: '/json' })
    files.push({ path: 'package.json', json: stripped.value })
    for (const item of stripped.redactions) redactions.push({ kind: 'file', ref: 'package.json', ...item })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'FS_NOT_FOUND') absent.push('package.json')
    else throw error
  }

  const workspacePath = join(profileDirectory, 'pnpm-workspace.yaml')
  try {
    const { text, via } = await readTextPreferService(ctx, workspacePath)
    if (via === 'node-fs' && !warnings.some(item => item.includes('node:fs 直接读取'))) {
      warnings.push('宿主没有 fs 服务，profile 文件由 node:fs 直接读取')
    }
    files.push({ path: 'pnpm-workspace.yaml', text })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'FS_NOT_FOUND') absent.push('pnpm-workspace.yaml')
    else warnings.push(`pnpm-workspace.yaml 读取失败：${error?.message ?? String(error)}`)
  }

  return { files, absent, redactions, pkg }
}

/** 兜底文档与 pnpm-workspace 还原都要用到的 allowBuilds 提取（只读、只取名字）。 */
export function readAllowBuilds(workspaceText) {
  if (typeof workspaceText !== 'string') return []
  const lines = workspaceText.split(/\r?\n/)
  const out = []
  let inSection = false
  for (const line of lines) {
    if (/^\s*allowBuilds\s*:/.test(line)) {
      inSection = true
      const inline = line.split(':').slice(1).join(':').trim()
      if (inline.startsWith('[')) {
        for (const item of inline.replace(/^\[|\]$/g, '').split(',')) {
          const name = item.trim().replace(/^['"]|['"]$/g, '')
          if (name !== '') out.push(name)
        }
      }
      continue
    }
    if (!inSection) continue
    const item = /^\s*-\s*(.+?)\s*$/.exec(line)
    if (item) {
      out.push(item[1].replace(/^['"]|['"]$/g, ''))
      continue
    }
    if (/^\S/.test(line)) inSection = false
  }
  return [...new Set(out)]
}
