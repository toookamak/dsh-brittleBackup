/**
 * 导出流程（PROJECT-PLAN §6.1 / SCOPE-PHASE1 §2.1）。
 *
 * 步骤固定：采集 → 剥离 → 自查扫描 → 生成文档 → 落盘到**用户自选目录** → 报告。
 * 本期没有上传步骤；除了用户选定目录与插件工作目录，不写任何位置。
 */
import { join } from 'node:path'
import { collectAll, degradationNotes } from './collect/index.js'
import { renderFallbackDoc } from './doc.js'
import { buildArtifact, writeArtifact } from './artifact.js'
import { scanForSecrets, scanTextForSecrets } from './redact.js'
import { fallbackExportRoot, isWithin, skillsRoot, workDir } from './paths.js'
import { listNames } from './nodefs.js'
import { saveSettings } from './settings.js'
import { credentialStates, credentialStatusLabels } from './credentials.js'

export class ExportError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** 勾选 skill 文件时，找出要复制的 user 级 skill 目录。 */
async function skillSourcesFor(env, skills) {
  const root = skillsRoot(env)
  const names = new Set(skills.map(skill => skill.name))
  const out = []
  for (const entry of await listNames(root)) {
    if (!entry.directory || !names.has(entry.name)) continue
    out.push({ name: entry.name, dir: join(root, entry.name) })
  }
  return out
}

/**
 * @param targetDir 用户自选目录（必须来自选择器白名单，路由层负责校验）；空则退回内部目录
 * @returns 报告对象（含产物目录、写入清单、警告、降级说明）
 */
export async function runExport({ ctx, env = process.env, targetDir = null, options, task = null, logger = null } = {}) {
  task?.setPhase?.('collect', '正在采集 profile / 插件 / 模型 / skills')
  const collected = await collectAll({ ctx, env, options, logger })
  for (const warning of collected.warnings) task?.addWarning?.(warning)
  logger?.info?.(`采集完成：${collected.items.stats.entryCount} 个配置条目、${collected.items.plugins.length} 个插件、${collected.items.models.length} 个 provider、${collected.items.skills.length} 个 skill`)

  task?.setPhase?.('redact', '正在做密钥自查')
  const hits = scanForSecrets(collected.items)
  if (hits.length > 0) {
    throw new ExportError('SECRET_SCAN', `产物自查发现 ${hits.length} 处疑似密钥，已拦截导出（未写任何文件）`, hits)
  }

  const credential = await credentialStates(ctx, collected.items.requiredCredentials)
  const credentialStatus = credentialStatusLabels(credential.state)

  let docText = null
  if (collected.options.doc) {
    docText = renderFallbackDoc({
      items: collected.items,
      options: collected.options,
      producer: collected.producer,
      credentialStatus,
    })
    const docHits = scanTextForSecrets(docText)
    if (docHits.length > 0) {
      throw new ExportError('SECRET_SCAN', `兜底文档自查发现 ${docHits.length} 处疑似密钥，已拦截导出（未写任何文件）`, docHits)
    }
  }

  const skills = collected.items.skills.map(skill => ({ ...skill, included: collected.options.skillFiles === true }))
  const items = {
    ...collected.items,
    skills,
    stats: { ...collected.items.stats, itemCounts: { ...collected.items.stats.itemCounts, skills: skills.length } },
  }
  const artifact = buildArtifact({ options: collected.options, producer: collected.producer, items })

  const fallback = fallbackExportRoot(env)
  const destination = targetDir === null || targetDir === '' ? fallback : targetDir
  if (destination === fallback || destination === workDir(env) || isWithin(workDir(env), destination)) {
    task?.addWarning?.(`没有目录选择器可用，产物写到了插件工作目录：${fallback}`)
  }

  task?.setPhase?.('write', '正在写入产物')
  task?.throwIfCanceled?.()
  const sources = collected.options.skillFiles ? await skillSourcesFor(env, skills) : []
  const written = await writeArtifact({ targetRoot: destination, artifact, docText, options: collected.options, skillSources: sources })
  for (const skipped of written.skillCopy.skipped) task?.addWarning?.(`skill 文件跳过：${skipped.skill}/${skipped.rel}（${skipped.reason}）`)

  await saveSettings({ lastExportDir: destination }, env)

  const degradation = degradationNotes(collected.meta)
  const report = {
    direction: 'export',
    dir: written.dir,
    files: written.written,
    bytes: Buffer.byteLength(JSON.stringify(artifact), 'utf8'),
    warnings: [...collected.warnings],
    redactionCount: collected.items.redactions.length,
    options: collected.options,
    credentialStatus,
    degradation,
    skillCopy: written.skillCopy,
    restartRequired: false,
  }
  logger?.info?.(`导出完成：${written.dir}`)
  return report
}
