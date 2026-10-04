/**
 * 产物（FORMAT.md 的唯一实现侧权威）：组装、校验、落盘、定位、读取。
 *
 * 产物 = 一个目录：
 *   dsh-brittle-backup-<ts>\
 *     backup.json      权威产物
 *     兜底文档.md       附件（自包含可分享）
 *     skills\          附件（勾选时，逐字节）
 *
 * 导出时默认把该目录**打成同名 zip**（运输层选项 `options.compress`，见 export.js）；
 * 导入时 `locateArtifact` 既能认目录，也能认这个 zip（自动解压后走完全相同的校验路径）。
 */
import { basename, join } from 'node:path'
import {
  ARTIFACT_FORMAT,
  ARTIFACT_PREFIX,
  ARTIFACT_VERSION,
  ARTIFACT_ZIP_SUFFIX,
  BACKUP_FILE,
  DOC_FILE,
  EXTRACTED_KEEP,
  SKILLS_DIRNAME,
  assertWithin,
  checkArtifactPath,
  checkNameSegment,
  extractedRoot,
  isArtifactArchiveName,
  timestamp,
} from './paths.js'
import { copyTree, ensureDir, listNames, pathExists, readBytes, readJsonFile, readTextFile, removeTree, writeJsonAtomic, writeTextAtomic } from './nodefs.js'
import { extractZip } from './zip.js'
import { scanTextForSecrets } from './redact.js'

/** 宽松防爆上限（FORMAT.md §7）——本地模式没有远端限额，只防异常产物撑爆磁盘。 */
export const LIMITS = Object.freeze({
  backupBytes: 64 * 1024 * 1024,
  fileEntries: 20000,
  skillFileBytes: 16 * 1024 * 1024,
  skillFileCount: 10000,
})

export function artifactDirName(date = new Date()) {
  return `${ARTIFACT_PREFIX}${timestamp(date)}`
}

/** 目标位置已存在同名目录时派生 `-2` / `-3` 后缀，绝不覆盖既有数据。 */
export function uniqueArtifactDirName(root, date = new Date()) {
  const base = artifactDirName(date)
  return { base, candidates: [base, `${base}-2`, `${base}-3`], root }
}

export function buildArtifact({ options, producer, items, docFile = DOC_FILE }) {
  return {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    createdAt: new Date().toISOString(),
    producer,
    options,
    items,
    doc: { file: docFile, format: 'markdown', title: '# DSH 配置兜底文档（dsh-BrittleBackup 生成）' },
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * 严格校验（FORMAT.md §5 第 1–5 条 + §2 关键约束）。
 * 只校验，不改写；返回规范化副本，缺失的可选字段补默认值并记警告。
 */
export function validateArtifact(input) {
  const errors = []
  const warnings = []
  if (!isObject(input)) return { ok: false, errors: ['产物不是 JSON 对象'], warnings, value: null }

  if (input.format !== ARTIFACT_FORMAT) errors.push(`format 不是 "${ARTIFACT_FORMAT}"（实际 ${JSON.stringify(input.format)}）`)
  if (input.version !== ARTIFACT_VERSION) errors.push(`version 不是 ${ARTIFACT_VERSION}（实际 ${JSON.stringify(input.version)}）`)
  if (typeof input.createdAt !== 'string' || input.createdAt === '') errors.push('createdAt 缺失或不是字符串')

  const producer = isObject(input.producer) ? input.producer : {}
  if (producer.plugin !== ARTIFACT_FORMAT) warnings.push(`producer.plugin 不是 "${ARTIFACT_FORMAT}"`)
  if (typeof producer.dshVersion !== 'string' || producer.dshVersion === '') warnings.push('producer.dshVersion 缺失，DSH 版本差异检查会降级为信息级')

  const options = isObject(input.options) ? input.options : {}
  for (const key of ['profile', 'plugins', 'models', 'skills', 'skillFiles', 'doc']) {
    if (typeof options[key] !== 'boolean') warnings.push(`options.${key} 缺失或不是布尔值，按 false 处理`)
  }

  const items = isObject(input.items) ? input.items : {}
  const config = isObject(items.config) ? items.config : {}
  const entries = Array.isArray(config.entries) ? config.entries : []
  if (!Array.isArray(config.entries)) warnings.push('items.config.entries 缺失，按空数组处理')
  const seenEntryIds = new Set()
  const normalizedEntries = []
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '') {
      errors.push('有一个配置条目缺少 id')
      continue
    }
    if (seenEntryIds.has(entry.id)) {
      errors.push(`配置条目 id 重复：${entry.id}`)
      continue
    }
    seenEntryIds.add(entry.id)
    normalizedEntries.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      override: isObject(entry.override) ? entry.override : {},
      inherited: isObject(entry.inherited) ? entry.inherited : {},
      secrets: Array.isArray(entry.secrets) ? entry.secrets : [],
      redactions: Array.isArray(entry.redactions) ? entry.redactions : [],
    })
  }

  const files = Array.isArray(items.files) ? items.files : []
  const seenPaths = new Set()
  const normalizedFiles = []
  for (const file of files) {
    if (!isObject(file)) {
      errors.push('items.files 里有一个条目不是对象')
      continue
    }
    const checked = checkArtifactPath(file.path)
    if (!checked.ok) {
      errors.push(`文件路径不安全（${file.path}）：${checked.reason}`)
      continue
    }
    if (seenPaths.has(checked.relative)) {
      errors.push(`文件路径重复：${checked.relative}`)
      continue
    }
    seenPaths.add(checked.relative)
    if (file.json === undefined && typeof file.text !== 'string') {
      warnings.push(`文件 ${checked.relative} 既没有 json 也没有 text`)
    }
    normalizedFiles.push({
      path: checked.relative,
      ...(file.json === undefined ? {} : { json: file.json }),
      ...(typeof file.text === 'string' ? { text: file.text } : {}),
    })
  }
  if (normalizedFiles.length > LIMITS.fileEntries) errors.push(`文件条目数 ${normalizedFiles.length} 超过上限 ${LIMITS.fileEntries}`)

  if (!Array.isArray(items.redactions)) warnings.push('items.redactions 缺失（必填字段，可为空数组）')

  const plugins = Array.isArray(items.plugins) ? items.plugins : []
  const normalizedPlugins = []
  for (const plugin of plugins) {
    if (!isObject(plugin) || typeof plugin.name !== 'string' || plugin.name === '') {
      errors.push('插件清单里有一个条目缺少 name')
      continue
    }
    if (typeof plugin.spec !== 'string' || plugin.spec === '') warnings.push(`插件 ${plugin.name} 缺少 spec`)
    normalizedPlugins.push({
      name: plugin.name,
      spec: typeof plugin.spec === 'string' ? plugin.spec : '',
      resolvedVersion: typeof plugin.resolvedVersion === 'string' ? plugin.resolvedVersion : null,
      source: typeof plugin.source === 'string' ? plugin.source : 'unknown',
      commit: typeof plugin.commit === 'string' ? plugin.commit : null,
      bundle: plugin.bundle === true,
      enabled: plugin.enabled !== false,
      description: typeof plugin.description === 'string' ? plugin.description : '',
      installCommand: typeof plugin.installCommand === 'string' ? plugin.installCommand : `dsh plugin add ${plugin.spec ?? plugin.name}`,
      unportable: plugin.unportable === true,
    })
  }

  const skills = Array.isArray(items.skills) ? items.skills : []
  const normalizedSkills = []
  const seenSkillNames = new Set()
  for (const skill of skills) {
    if (!isObject(skill) || typeof skill.name !== 'string' || skill.name === '') {
      errors.push('skills 清单里有一个条目缺少 name')
      continue
    }
    // name 会被 restore/apply.js 拿去 join(skillsRoot, name) 再 removeTree，
    // 所以必须先当成"单段名"校验：只查 path 是挡不住 `{name:'..', path:'skills/x'}` 的。
    const nameChecked = checkNameSegment(skill.name)
    if (!nameChecked.ok) {
      errors.push(`skill 名称不安全（${JSON.stringify(skill.name)}）：${nameChecked.reason}`)
      continue
    }
    if (seenSkillNames.has(skill.name)) {
      errors.push(`skills 名称重复：${skill.name}`)
      continue
    }
    seenSkillNames.add(skill.name)
    const expected = `${SKILLS_DIRNAME}/${skill.name}`
    const declared = typeof skill.path === 'string' ? skill.path.replace(/\\/g, '/') : expected
    const checked = checkArtifactPath(declared)
    if (!checked.ok) {
      errors.push(`skill 路径不安全（${declared}）：${checked.reason}`)
      continue
    }
    if (checked.relative !== expected) warnings.push(`skill ${skill.name} 的 path 不是 ${expected}（实际 ${checked.relative}）`)
    normalizedSkills.push({
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : '',
      path: expected,
      scope: skill.scope === 'project' ? 'project' : 'user',
      files: Number.isInteger(skill.files) ? skill.files : 0,
      included: skill.included === true,
    })
  }

  const doc = isObject(input.doc) ? input.doc : {}
  const docFile = typeof doc.file === 'string' && doc.file !== '' ? doc.file : DOC_FILE
  const docChecked = checkArtifactPath(docFile)
  if (!docChecked.ok) errors.push(`doc.file 不安全：${docChecked.reason}`)

  const value = {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    createdAt: String(input.createdAt ?? ''),
    producer: {
      plugin: typeof producer.plugin === 'string' ? producer.plugin : ARTIFACT_FORMAT,
      pluginVersion: typeof producer.pluginVersion === 'string' ? producer.pluginVersion : 'unknown',
      dshVersion: typeof producer.dshVersion === 'string' ? producer.dshVersion : 'unknown',
      hostRuntime: isObject(producer.hostRuntime) ? producer.hostRuntime : {},
      hostname: typeof producer.hostname === 'string' ? producer.hostname : 'unknown',
    },
    options: {
      profile: options.profile === true,
      plugins: options.plugins === true,
      models: options.models === true,
      skills: options.skills === true,
      skillFiles: options.skillFiles === true,
      doc: options.doc === true,
    },
    items: {
      config: { source: typeof config.source === 'string' ? config.source : 'config-editor', entries: normalizedEntries },
      files: normalizedFiles,
      absent: Array.isArray(items.absent) ? items.absent.filter(item => typeof item === 'string') : [],
      redactions: Array.isArray(items.redactions) ? items.redactions : [],
      plugins: normalizedPlugins,
      models: Array.isArray(items.models) ? items.models : [],
      defaultModel: isObject(items.defaultModel) ? items.defaultModel : null,
      requiredCredentials: Array.isArray(items.requiredCredentials) ? items.requiredCredentials.filter(item => typeof item === 'string') : [],
      skills: normalizedSkills,
      stats: isObject(items.stats) ? items.stats : { entryCount: normalizedEntries.length, fileCount: normalizedFiles.length, bytes: 0, itemCounts: {} },
    },
    doc: { file: docChecked.ok ? docChecked.relative : DOC_FILE, format: 'markdown', title: typeof doc.title === 'string' ? doc.title : '' },
  }

  return { ok: errors.length === 0, errors, warnings, value }
}

/**
 * 逐文件密钥扫描（防线③，SECURITY.md §2.3）。
 *
 * 用 latin1 解码：字节一一对应，既不会因为非法 UTF-8 抛错，也不会把二进制
 * 悄悄换成 U+FFFD 让密钥特征消失 —— 对二进制资产来说这才是安全的一侧。
 * @returns 命中列表（空数组 = 干净）
 */
async function scanFileForSecrets(absolutePath) {
  let bytes
  try {
    bytes = await readBytes(absolutePath)
  } catch {
    // 读不出来就当不通过：宁可漏一个文件，也不能把没看过的文件放进产物。
    return [{ pattern: 'unreadable' }]
  }
  return scanTextForSecrets(bytes.toString('latin1'))
}

/** 落盘：目录 + backup.json + 兜底文档 + （勾选时）skills\。 */
export async function writeArtifact({
  targetRoot,
  artifact,
  docText = null,
  options,
  skillSources = [],
  date = new Date(),
}) {
  /** 因扫描到疑似密钥而被拒绝写入产物的文件（不静默：报告与任务警告都会点名）。 */
  const withheld = []
  const name = uniqueArtifactDirName(targetRoot, date).candidates
  let dir = null
  for (const candidate of name) {
    const path = join(targetRoot, candidate)
    if (!(await pathExists(path))) {
      dir = path
      break
    }
  }
  if (dir === null) throw new Error('同一秒内已有 3 份同名产物，请稍后重试')

  await writeJsonAtomic(join(dir, BACKUP_FILE), artifact)
  const written = [BACKUP_FILE]

  if (options?.doc !== false && typeof docText === 'string') {
    await writeTextAtomic(join(dir, artifact.doc.file), docText)
    written.push(artifact.doc.file)
  }

  const copyReport = { copied: 0, skipped: [] }
  if (options?.skillFiles === true) {
    const names = artifact.items.skills.map(skill => skill.name)
    for (const source of skillSources) {
      if (!names.includes(source.name)) continue
      const result = await copyTree(source.dir, join(dir, SKILLS_DIRNAME, source.name), {
        maxFileBytes: LIMITS.skillFileBytes,
        // 防线③对 skills 文件的唯一防线（SECURITY.md §2.3）：复制前逐文件扫描。
        // 命中就**不写这个文件**并如实报告 —— 宁可少备一个文件，
        // 也不能让"产物里绝不会出现密钥"这句承诺在勾了 skills 文件时失效。
        shouldCopy: async (rel, absolutePath) => {
          const hits = await scanFileForSecrets(absolutePath)
          if (hits.length === 0) return true
          withheld.push({ skill: source.name, rel, patterns: hits.map(hit => hit.pattern) })
          return false
        },
      })
      copyReport.copied += result.copied
      for (const item of result.skipped) copyReport.skipped.push({ skill: source.name, ...item })
    }
    if (copyReport.copied > 0) written.push(`${SKILLS_DIRNAME}\\`)
  }

  copyReport.withheld = withheld
  return { dir, written, skillCopy: copyReport }
}

/**
 * 定位产物：目录自身含 backup.json 直接用；否则在其直接子目录里找匹配前缀的候选；
 * 再否则找 `dsh-brittle-backup-*.zip` 并**自动解压到插件工作目录**（体验优化项 2）。
 * @returns {{ok:true,dir:string,source:'dir'|'zip',zip?:string}|{ok:false,code:string,candidates:string[],reason:string}}
 */
export async function locateArtifact(inputDir, { readDir = listNames, env = process.env, extract = extractArtifactZip } = {}) {
  // 导入选择器也允许直接选中一个 zip 文件；目录逻辑保持原有兼容性。
  if (typeof inputDir === 'string' && isArtifactArchiveName(basename(inputDir))) {
    if (!(await pathExists(inputDir))) return { ok: false, code: 'ARTIFACT_NOT_FOUND', candidates: [], reason: '所选 zip 文件不存在' }
    const extracted = await extract(inputDir, { env })
    if (!extracted.ok) return { ok: false, code: extracted.code ?? 'ARCHIVE_INVALID', candidates: [inputDir], reason: `压缩包无法解压：${extracted.reason}` }
    await pruneExtracted(env, EXTRACTED_KEEP).catch(() => [])
    return { ok: true, dir: extracted.dir, source: 'zip', zip: inputDir }
  }
  if (await pathExists(join(inputDir, BACKUP_FILE))) return { ok: true, dir: inputDir, source: 'dir' }
  const children = await readDir(inputDir)
  const found = []
  for (const child of children) {
    if (child.directory) {
      if (child.name.startsWith(ARTIFACT_PREFIX) && await pathExists(join(inputDir, child.name, BACKUP_FILE))) {
        found.push({ kind: 'dir', path: join(inputDir, child.name) })
      }
      continue
    }
    if (isArtifactArchiveName(child.name)) found.push({ kind: 'zip', path: join(inputDir, child.name) })
  }
  if (found.length === 0) {
    return {
      ok: false,
      code: 'ARTIFACT_NOT_FOUND',
      candidates: [],
      reason: `所选目录里没有 ${BACKUP_FILE}，也没有匹配 ${ARTIFACT_PREFIX}* 的子目录或 ${ARTIFACT_ZIP_SUFFIX} 压缩包`,
    }
  }
  if (found.length > 1) {
    return {
      ok: false,
      code: 'ARTIFACT_AMBIGUOUS',
      candidates: found.map(item => item.path),
      reason: `所选目录里有 ${found.length} 个候选产物（目录或压缩包），请把它们分开后只指向其中一个`,
    }
  }

  const only = found[0]
  if (only.kind === 'dir') return { ok: true, dir: only.path, source: 'dir' }
  const extracted = await extract(only.path, { env })
  if (!extracted.ok) {
    return {
      ok: false,
      code: extracted.code ?? 'ARCHIVE_INVALID',
      candidates: [only.path],
      reason: `压缩包无法解压：${extracted.reason}`,
    }
  }
  await pruneExtracted(env, EXTRACTED_KEEP).catch(() => [])
  return { ok: true, dir: extracted.dir, source: 'zip', zip: only.path }
}

/**
 * 把产物 zip 解压到 `<DSH_HOME>\dsh-brittle-backup\extracted\<包名>\`（U34 允许的三处范围之一）。
 * 解压前先清空同名目录：绝不让上一次的残留文件混进这次校验。
 */
export async function extractArtifactZip(zipPath, { env = process.env } = {}) {
  const root = extractedRoot(env)
  const destination = join(root, basename(zipPath).replace(/\.zip$/i, ''))
  assertWithin(root, destination, 'zip 解压目录')
  await removeTree(destination)
  await ensureDir(destination)
  try {
    const result = await extractZip(zipPath, destination, { stripSingleRoot: true })
    if (!(await pathExists(join(destination, BACKUP_FILE)))) {
      await removeTree(destination)
      return { ok: false, code: 'ARCHIVE_INVALID', reason: `压缩包里没有 ${BACKUP_FILE}` }
    }
    return { ok: true, dir: destination, files: result.files.length }
  } catch (error) {
    await removeTree(destination).catch(() => {})
    return { ok: false, code: error?.code ?? 'ARCHIVE_INVALID', reason: error?.message ?? String(error) }
  }
}

/** 只保留最近 `keep` 份解压结果（目录名带时间戳 → 字典序即时间序）。 */
export async function pruneExtracted(env = process.env, keep = EXTRACTED_KEEP) {
  const root = extractedRoot(env)
  const names = (await listNames(root)).filter(entry => entry.directory).map(entry => entry.name).sort()
  const stale = names.slice(0, Math.max(0, names.length - keep))
  for (const name of stale) await removeTree(join(root, name))
  return stale
}

/** 读取 + 校验（先查体积上限，再解析）。 */
export async function readArtifact(dir) {
  const backupPath = join(dir, BACKUP_FILE)
  const text = await readTextFile(backupPath)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > LIMITS.backupBytes) {
    return { ok: false, errors: [`backup.json 有 ${bytes} 字节，超过上限 ${LIMITS.backupBytes}`], warnings: [], value: null, bytes }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`backup.json 不是合法 JSON：${error.message}`], warnings: [], value: null, bytes }
  }
  const validated = validateArtifact(parsed)
  return { ...validated, bytes, dir }
}

export async function readArtifactJson(dir) {
  return await readJsonFile(join(dir, BACKUP_FILE))
}
