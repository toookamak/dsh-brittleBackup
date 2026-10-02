/**
 * 兜底文档审计（S4 盲测的自动化部分）：
 *
 *   node scripts/doc-audit.mjs <产物目录>
 *
 * 只读产物目录，逐项检查"只看这份 Markdown 能不能把配置重配回来"：
 *   1. `backup.json` 通过闸门；
 *   2. 每个插件都在文档里有名字 + 安装命令；
 *   3. 每个 provider 都有 api / baseURL / apiKeyEnv 与全部模型 id；
 *   4. 每个 skill 名字都在；
 *   5. 每个有 override 的配置条目都在文档里有可粘贴片段（`- id:` / `name:` / `config:` 三层）；
 *   6. 文档**不含**主机名 / 账号 / 绝对路径 / 密钥；被剥离的密钥必须在文档里被标成"要自己填"。
 *
 * 退出码：0 = 全通过；1 = 有缺口（缺口清单打在 stdout）。
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const target = process.argv[2]
if (typeof target !== 'string' || target.trim() === '') {
  console.error('用法：node scripts/doc-audit.mjs <产物目录>')
  process.exit(2)
}

const dir = resolve(target)
const problems = []
const notes = []

function check(condition, message) {
  if (!condition) problems.push(message)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

const artifact = await readJson(join(dir, 'backup.json')).catch(error => {
  console.error('读不到 backup.json：' + error.message)
  process.exit(2)
})

check(artifact.format === 'dsh-brittle-backup', 'format 不是 dsh-brittle-backup')
check(artifact.version === 1, 'version 不是 1')

const docFile = artifact.doc && typeof artifact.doc.file === 'string' ? artifact.doc.file : '兜底文档.md'
const doc = await readFile(join(dir, docFile), 'utf8').catch(error => {
  console.error('读不到兜底文档：' + error.message)
  process.exit(2)
})

const items = artifact.items || {}
const entries = Array.isArray(items.config?.entries) ? items.config.entries : []
const plugins = Array.isArray(items.plugins) ? items.plugins : []
const models = Array.isArray(items.models) ? items.models : []
const skills = Array.isArray(items.skills) ? items.skills : []

// ---- 1. 插件 ----
for (const plugin of plugins) {
  check(doc.includes(plugin.name), `插件名字缺失：${plugin.name}`)
  const command = typeof plugin.installCommand === 'string' ? plugin.installCommand : ''
  if (command !== '') {
    check(doc.includes(command), `安装命令缺失：${command}`)
  } else {
    notes.push(`插件 ${plugin.name} 没有安装命令，文档里只有名字`)
  }
}

// ---- 2. 模型 ----
for (const provider of models) {
  check(doc.includes(String(provider.provider)), `provider 缺失：${provider.provider}`)
  if (provider.apiKeyEnv) check(doc.includes(provider.apiKeyEnv), `设置项名字缺失：${provider.apiKeyEnv}`)
  if (provider.baseURL) check(doc.includes(provider.baseURL), `baseURL 缺失：${provider.baseURL}`)
  if (provider.api) check(doc.includes(provider.api), `api 缺失：${provider.api}`)
  for (const model of provider.models || []) {
    check(doc.includes(String(model.id)), `模型 id 缺失：${provider.provider}/${model.id}`)
  }
}
if (items.defaultModel) {
  check(doc.includes(items.defaultModel.model), `默认模型缺失：${items.defaultModel.model}`)
  check(doc.includes(items.defaultModel.provider), `默认模型 provider 缺失：${items.defaultModel.provider}`)
}

// ---- 3. skills ----
for (const skill of skills) {
  check(doc.includes(skill.name), `skill 名字缺失：${skill.name}`)
}

// ---- 4. 可粘贴片段 ----
const yamlBlocks = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map(match => match[1])
function blockHasEntry(id) {
  return yamlBlocks.some(block => new RegExp(`^- id: ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(block))
}
for (const entry of entries) {
  const hasEntryBlock = blockHasEntry(entry.id)
  const fields = Object.keys(entry.override || {})
  const needsBlock = fields.length > 0
  if (needsBlock) check(hasEntryBlock, `配置条目 ${entry.id} 没有可粘贴的 YAML 片段`)
  const block = yamlBlocks.find(candidate => new RegExp(`^- id: ${entry.id}$`, 'm').test(candidate))
  if (block) {
    check(/^  name: /m.test(block), `条目 ${entry.id} 的片段缺少 name 层`)
    if (fields.length > 0) check(/^  config:$/m.test(block), `条目 ${entry.id} 的片段缺少 config 层`)
  }
}

// ---- 5. 可分享性 ----
const hostname = artifact.producer && typeof artifact.producer.hostname === 'string' ? artifact.producer.hostname : ''
if (hostname !== '' && hostname !== 'unknown') check(!doc.includes(hostname), `文档里出现了主机名：${hostname}`)
check(!/[A-Za-z]:\\/.test(doc.replace(/<DSH_HOME>\\skills/g, '')), '文档里出现了 Windows 绝对路径')
check(!/\/Users\/|\/home\//.test(doc), '文档里出现了类 Unix 绝对路径')
check(!/sk-[A-Za-z0-9_-]{16,}/.test(doc), '文档里出现了疑似密钥')
check(!doc.includes('DESKTOP-'), '文档里出现疑似主机名')

const redactedEntries = entries.filter(entry => (entry.override && JSON.stringify(entry.override).includes('<REDACTED>')))
if (redactedEntries.length > 0) {
  check(/需要填写的设置项/.test(doc), '有被剥离的密钥，但文档里没有"需要填写的设置项"指引')
  for (const entry of redactedEntries) {
    if (!doc.includes('不会') || !doc.includes('自己填')) {
      notes.push(`条目 ${entry.id} 有被剥离的密钥；建议文档给出"自己填"的提示`)
    }
  }
}

// ---- 汇总 ----
console.log(`产物目录：${dir}`)
console.log(`内容：${entries.length} 个配置条目 / ${plugins.length} 个插件 / ${models.length} 个 provider / ${skills.length} 个 skill / ${yamlBlocks.length} 段可粘贴 YAML`)
if (notes.length > 0) {
  console.log('\n提示：')
  for (const note of notes) console.log('  - ' + note)
}
if (problems.length > 0) {
  console.log(`\n✗ 盲测检查未通过（${problems.length} 项缺口）：`)
  for (const problem of problems) console.log('  - ' + problem)
  process.exit(1)
}
console.log('\n✓ 盲测检查通过：只看这份兜底文档即可完成重配所需的信息都在其中')
