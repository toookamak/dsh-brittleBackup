/**
 * 配置查询文本：给插件失效或需要人工排障时复制使用。
 * 只输出恢复所需的名字、版本、结构和环境变量名；不输出密钥值、主机名或绝对路径。
 */
import { locateArtifact, readArtifact } from './artifact.js'
import { isSecretKey } from './redact.js'

const ABSOLUTE_PATH = /(?:^[a-zA-Z]:[\\/]|^[/\\]{2}|^\/(?:Users|home|var|tmp|mnt)\/)/

function safeText(value) {
  if (typeof value !== 'string') return value
  if (ABSOLUTE_PATH.test(value)) return '[本机路径已隐藏]'
  return value.replace(/[A-Za-z]:\\[^\s"']+/g, '[本机路径已隐藏]')
}

function safeValue(value, key = '') {
  // 名字不是秘密：apiKeyEnv / tokenName 等字段用于人工重新配置，必须保留。
  // 字段名判定复用 redact.js 的 isSecretKey（防线 ② 的同一套切词规则）：
  // 这里再写一份子串正则会让 maxTokens / tokenPath 被误抹，又漏掉 signingKey 这类 *Key。
  const isSecretName = /(env|name|ref|id)$/i.test(key)
  if (isSecretKey(key) && !isSecretName) return '<已隐藏>'
  if (Array.isArray(value)) return value.map(item => safeValue(item, key))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = safeValue(childValue, childKey)
    return out
  }
  return safeText(value)
}

function line(value = '') {
  return `${value}\n`
}

function renderReport(collected, detail) {
  const { items, producer, warnings } = collected
  const out = []
  out.push('# DSH 配置查询文本')
  out.push(line('用途：插件失效时用于查询插件名、版本和必要配置名，密钥值不会出现在这里。').trimEnd())
  out.push(line(`生成时间：${new Date().toISOString()}`).trimEnd())
  out.push(line(`DSH 版本：${safeText(producer.dshVersion)}`).trimEnd())
  out.push(line(`备份插件版本：${safeText(producer.pluginVersion)}`).trimEnd())
  out.push('')

  out.push('## 已安装插件')
  if (items.plugins.length === 0) out.push('（没有采集到插件）')
  for (const plugin of items.plugins) {
    const source = plugin.source === 'local-path' ? '本地路径依赖（路径已隐藏）' : plugin.source
    out.push(`- ${safeText(plugin.name)} | 版本：${safeText(plugin.resolvedVersion ?? 'unknown')} | ${plugin.enabled === false ? '已禁用' : '已启用'} | 来源：${source}`)
    if (detail) out.push(`  安装提示：${safeText(plugin.installCommand).replace(/file:[^\s]+/gi, 'file:[本机路径已隐藏]')}`)
  }
  out.push('')

  out.push('## 配置条目')
  if (items.config.entries.length === 0) out.push('（没有采集到可导出的配置条目）')
  for (const entry of items.config.entries) {
    const secretNames = entry.secrets.map(secret => secret.path.join('.')).filter(Boolean)
    out.push(`- ${safeText(entry.id)}${entry.name ? ` | ${safeText(entry.name)}` : ''}`)
    if (secretNames.length) out.push(`  需要补齐的配置名：${secretNames.join('、')}`)
    if (detail) {
      out.push('  配置结构（已脱敏）：')
      out.push('```json')
      out.push(JSON.stringify(safeValue(entry.override), null, 2))
      out.push('```')
    }
  }
  out.push('')

  out.push('## 模型与必要环境变量')
  if (items.models.length === 0) out.push('（没有采集到模型配置）')
  for (const model of items.models) {
    const names = Array.isArray(model.models) ? model.models.map(item => item.id || item.name).filter(Boolean).join('、') : ''
    out.push(`- ${safeText(model.provider)}${model.displayName ? `（${safeText(model.displayName)}）` : ''} | API：${safeText(model.api ?? 'unknown')}${names ? ` | 模型：${safeText(names)}` : ''}`)
    if (model.apiKeyEnv) out.push(`  环境变量：${safeText(model.apiKeyEnv)}`)
    if (detail && model.baseURL) out.push(`  服务地址：${safeText(model.baseURL)}`)
  }
  if (items.requiredCredentials.length) out.push(`- 需要检查的密钥名：${items.requiredCredentials.map(safeText).join('、')}`)
  out.push('')

  out.push('## Skills')
  out.push(items.skills.length ? items.skills.map(skill => `- ${safeText(skill.name)}${skill.description ? `：${safeText(skill.description)}` : ''}`).join('\n') : '（没有采集到 skills）')
  out.push('')

  if (detail) {
    out.push('## 说明')
    out.push('- 以上内容已隐藏 API Key、Token、密码、主机名和本机绝对路径；不会显示密钥值。')
    out.push('- 配置结构仅用于定位条目和字段，不代表其中包含可直接使用的密钥值。')
    out.push('- 需要恢复时，请根据环境变量名重新配置密钥。')
  }
  if (warnings.length) {
    out.push('')
    out.push(`## 采集提示（${warnings.length} 条）`)
    out.push(...warnings.map(warning => `- ${safeText(warning)}`))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export async function buildQueryReport({ sourceDir, env = process.env, detail = false } = {}) {
  try {
    if (typeof sourceDir !== 'string' || sourceDir === '') return { ok: false, code: 'QUERY_SOURCE_REQUIRED', reason: '请先选择包含备份文件或 zip 的来源目录' }
    const located = await locateArtifact(sourceDir, { env })
    if (!located.ok) return { ok: false, code: located.code, reason: located.reason, candidates: located.candidates }
    const read = await readArtifact(located.dir)
    if (!read.ok) return { ok: false, code: 'ARTIFACT_INVALID', reason: '备份文件未通过校验，无法生成查询文本', errors: read.errors, warnings: read.warnings }
    const artifact = read.value
    const items = artifact.items
    const collected = {
      items,
      producer: artifact.producer,
      warnings: read.warnings || [],
    }
    const text = renderReport(collected, detail === true)
    return {
      ok: true,
      text,
      source: located.source ?? 'dir',
      zip: located.zip ?? null,
      summary: {
        detail: detail === true,
        plugins: items.plugins.length,
        entries: items.config.entries.length,
        models: items.models.length,
        skills: items.skills.length,
        credentials: items.requiredCredentials.length,
      },
    }
  } catch (error) {
    return { ok: false, code: error?.code ?? 'QUERY_FAILED', reason: error?.message ?? String(error) }
  }
}
