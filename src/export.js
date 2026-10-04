/**
 * 导出流程（PROJECT-PLAN §6.1 / SCOPE-PHASE1 §2.1）。
 *
 * 步骤固定：采集 → 剥离 → 自查扫描 → 生成文档 → 落盘到**用户自选目录** →（可选）打包成 zip → 报告。
 * 本期没有上传步骤；除了用户选定目录与插件工作目录，不写任何位置。
 *
 * 压缩（体验优化项 2）：先把产物写成目录，再打成同名 zip，**zip 成功后才删掉目录**；
 * 打包失败就抛出 ZIP_FAILED，临时目录保留供手工取回，不会把这次记成目录交付成功。
 */
import { basename, join } from 'node:path'
import { collectAll, degradationNotes } from './collect/index.js'
import { renderFallbackDoc } from './doc.js'
import { buildArtifact, writeArtifact } from './artifact.js'
import { scanForSecrets, scanTextForSecrets } from './redact.js'
import { fallbackExportRoot, isWithin, skillsRoot, workDir } from './paths.js'
import { listNames, removeTree } from './nodefs.js'
import { zipDirectory } from './zip.js'
import { contentOptions, saveSettings } from './settings.js'
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
 * @param options 勾选项（含运输层的 `compress`）
 * @returns 报告对象（含交付物路径、打包形态、写入清单、警告、降级说明）
 */
export async function runExport({ ctx, env = process.env, targetDir = null, options, task = null, logger = null } = {}) {
  // 即使宿主/调用方没有传完整 options，也遵守产品默认：压缩开启；只有显式 false 才保留目录。
  const compress = options?.compress !== false
  task?.setPhase?.('collect', '正在采集 profile / 插件 / 模型 / skills', 10)
  const collected = await collectAll({ ctx, env, options, logger })
  for (const warning of collected.warnings) task?.addWarning?.(warning)
  logger?.info?.(`采集完成：${collected.items.stats.entryCount} 个配置条目、${collected.items.plugins.length} 个插件、${collected.items.models.length} 个 provider、${collected.items.skills.length} 个 skill`)

  task?.setPhase?.('redact', '正在做密钥自查', 35)
  const hits = scanForSecrets(collected.items)
  if (hits.length > 0) {
    throw new ExportError('SECRET_SCAN', `产物自查发现 ${hits.length} 处疑似密钥，已拦截导出（未写任何文件）`, hits)
  }

  const credential = await credentialStates(ctx, collected.items.requiredCredentials)
  const credentialStatus = credentialStatusLabels(credential.state)

  let docText = null
  if (collected.options.doc) {
    task?.setPhase?.('redact', '正在生成兜底文档', 45)
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
  // 产物里的 options 只记**内容项**：compress 是运输层选项，不进 backup.json（FORMAT.md §1）。
  const artifact = buildArtifact({ options: contentOptions(collected.options), producer: collected.producer, items })

  const fallback = fallbackExportRoot(env)
  const usedFallback = targetDir === null || targetDir === ''
  const destination = usedFallback ? fallback : targetDir
  const wroteIntoWorkDir = destination === fallback || destination === workDir(env) || isWithin(workDir(env), destination)
  if (wroteIntoWorkDir) {
    task?.addWarning?.(`产物写到了插件工作目录：${destination}。这里不是备份库，重装或清理可能丢掉。`)
  }

  task?.setPhase?.('write', '正在写入产物', 60)
  task?.throwIfCanceled?.()
  const sources = collected.options.skillFiles ? await skillSourcesFor(env, skills) : []
  const written = await writeArtifact({ targetRoot: destination, artifact, docText, options: collected.options, skillSources: sources })
  for (const skipped of written.skillCopy.skipped) task?.addWarning?.(`skill 文件跳过：${skipped.skill}/${skipped.rel}（${skipped.reason}）`)
  // 防线③拦下的文件必须**点名告知**：用户要知道哪个文件没被备份，不能静默少一个。
  for (const hold of written.skillCopy.withheld ?? []) {
    task?.addWarning?.(`skill 文件未写入产物：${hold.skill}/${hold.rel}（扫描到疑似密钥：${hold.patterns.join('、')}）。产物里不会有这个文件，需要的话请自己另存一份。`)
  }

  // ---- 打包（默认开）----
  const packagingWarnings = []
  let packaging = { kind: 'dir', deliverable: written.dir, zip: null, unpackedDir: written.dir, zipBytes: null }
  if (compress) {
    task?.setPhase?.('zip', '正在打包成 zip', 80)
    task?.throwIfCanceled?.()
    const zipPath = `${written.dir}.zip`
    try {
      const zipped = await zipDirectory(written.dir, zipPath)
      let unpackedDir = null
      try {
        await removeTree(written.dir)
      } catch (error) {
        // 目录删不掉不算失败：zip 已经是交付物，只是多留了一份临时目录。
        packagingWarnings.push(`已生成 zip，但临时目录没能删除：${written.dir}（${error?.message ?? String(error)}）`)
        unpackedDir = written.dir
      }
      packaging = { kind: 'zip', deliverable: zipPath, zip: zipPath, zipBytes: zipped.bytes, unpackedDir }
      logger?.info?.(`已打包：${zipPath}（${zipped.bytes} 字节）`)
    } catch (error) {
      // 用户明确勾选 zip 时不能悄悄降级成目录，否则界面会显示"成功"但交付形态不符合选择。
      // 临时目录仍保留，方便用户重试或手工取回；任务本身标记失败。
      const failure = new ExportError('ZIP_FAILED', `打包 zip 失败，未生成目录交付物：${error?.message ?? String(error)}`, { dir: written.dir, cause: error })
      failure.detail = { dir: written.dir, cause: error }
      throw failure
    }
  }
  for (const warning of packagingWarnings) task?.addWarning?.(warning)

  // 工作目录不是用户保管的备份，不能覆盖「上次成功导出的目录」。
  if (!wroteIntoWorkDir) await saveSettings({ lastExportDir: destination }, env)

  const degradation = degradationNotes(collected.meta)
  const report = {
    direction: 'export',
    /** 交付物：zip 路径（默认）或未压缩目录。 */
    dir: packaging.deliverable,
    packaging: packaging.kind,
    zip: packaging.zip,
    unpackedDir: packaging.unpackedDir,
    zipBytes: packaging.zipBytes,
    files: written.written,
    bytes: Buffer.byteLength(JSON.stringify(artifact), 'utf8'),
    warnings: [
      ...collected.warnings,
      ...packagingWarnings,
      ...(written.skillCopy.withheld ?? []).map(hold => `skill 文件未写入产物：${hold.skill}/${hold.rel}（扫描到疑似密钥）`),
    ],
    redactionCount: collected.items.redactions.length,
    options: collected.options,
    credentialStatus,
    degradation,
    skillCopy: written.skillCopy,
    restartRequired: false,
    artifactName: basename(written.dir),
  }
  logger?.info?.(`导出完成：${report.dir}`)
  return report
}
