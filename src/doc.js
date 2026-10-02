/**
 * 兜底文档生成器（FORMAT 之外的第二个产物，PROJECT-PLAN §5.2）。
 *
 * 铁律：**自包含、可单独分享** —— 零密钥、零主机名 / 账号名、零配置原文、零本机路径。
 * 只给"照着重配"需要的名字、命令与可粘贴的配置片段。
 */
import { ARTIFACT_VERSION } from './paths.js'
import { stripRedacted } from './redact.js'

export const DOC_TITLE = '# DSH 配置兜底文档（dsh-BrittleBackup 生成）'

/**
 * YAML 标量：能裸写就裸写，否则用双引号（合法的 YAML 双引号标量）。
 *
 * 必须加引号的情形：首字符是 YAML 保留指示符（`@` `` ` `` `-` `?` `:` 等）、
 * 含 `: ` 或 ` #`、是布尔/空值字面量、纯数字（否则类型会从字符串变成数字/布尔）。
 */
const PLAIN_SAFE = /^[A-Za-z0-9._/+][A-Za-z0-9@._/:+-]*$/
export function yamlScalar(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  if (text === '') return '""'
  const reserved = /^(true|false|null|yes|no|on|off|~)$/i.test(text)
  const numeric = /^[-+]?\d+(?:\.\d+)?$/.test(text)
  const unsafeSequence = /: | #/.test(text)
  if (PLAIN_SAFE.test(text) && !reserved && !numeric && !unsafeSequence) return text
  return JSON.stringify(text)
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map(line => (line === '' ? '' : `${pad}${line}`)).join('\n')
}

/** 把一个纯 JSON 值渲染成 YAML 片段（对象 / 数组 / 标量）。 */
export function toYaml(value, level = 0) {
  const pad = '  '.repeat(level)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value.map(item => {
      if (item !== null && typeof item === 'object') {
        const rendered = toYaml(item, level + 1)
        return `${pad}- ${rendered.trimStart()}`
      }
      return `${pad}- ${yamlScalar(item)}`
    }).join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined)
    if (entries.length === 0) return `${pad}{}`
    return entries.map(([key, child]) => {
      if (child !== null && typeof child === 'object') {
        const nested = toYaml(child, level + 1)
        if (nested.trimStart().startsWith('-')) return `${pad}${key}:\n${nested}`
        return `${pad}${key}:\n${nested}`
      }
      return `${pad}${key}: ${yamlScalar(child)}`
    }).join('\n')
  }
  return `${pad}${yamlScalar(value)}`
}

/** 把一个结构化条目渲染成"可以直接粘回 cordis.patch.yml"的条目。 */
export function renderEntryYaml(entry) {
  const lines = [`- id: ${yamlScalar(entry.id)}`]
  if (typeof entry.name === 'string' && entry.name !== '') lines.push(`  name: ${yamlScalar(entry.name)}`)
  const config = entry.override && typeof entry.override === 'object' ? entry.override : {}
  if (Object.keys(config).length > 0) {
    lines.push('  config:')
    lines.push(indent(toYaml(config, 0), 4))
  }
  return lines.join('\n')
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const divider = `|${headers.map(() => '---').join('|')}|`
  const body = rows.map(row => `| ${row.map(cell => String(cell ?? '')).join(' | ')} |`)
  return [head, divider, ...body].join('\n')
}

const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * @param input.items 采集结果
 * @param input.entries 结构化条目（模型条目的 id/name 要用来渲染可粘贴片段）
 * @param input.options 实际勾选
 * @param input.credentialStatus 可选：{ NAME: '已配置' | '缺失' }
 * @param input.createdAt ISO 时间
 */
export function renderFallbackDoc({ items, options, producer, credentialStatus = {}, createdAt = new Date().toISOString() }) {
  const entries = Array.isArray(items?.config?.entries) ? items.config.entries : []
  const plugins = Array.isArray(items?.plugins) ? items.plugins : []
  const models = Array.isArray(items?.models) ? items.models : []
  const skills = Array.isArray(items?.skills) ? items.skills : []
  const defaultModel = items?.defaultModel ?? null
  const required = Array.isArray(items?.requiredCredentials) ? items.requiredCredentials : []
  const lines = []

  lines.push(DOC_TITLE)
  lines.push('')
  lines.push(`生成时间：${createdAt}　DSH 版本：${producer?.dshVersion ?? 'unknown'}　备份格式：v${ARTIFACT_VERSION}`)
  lines.push('本文件包含：插件清单、模型供应商与模型、skills 清单、手工重建步骤。')
  lines.push('本文件不包含：任何 API Key / Token / 密码，也不包含主机名与本机路径。请自备密钥。')
  lines.push('')

  lines.push('## 0. 这份备份包含什么')
  lines.push('')
  lines.push(table(['项目', '本次是否包含'], [
    ['profile 配置（cordis.patch.yml 结构化条目）', options?.profile === false ? '未包含' : '包含'],
    ['插件清单', options?.plugins === false ? '未包含' : '包含'],
    ['模型配置', options?.models === false ? '未包含' : '包含'],
    ['skills 清单', options?.skills === false ? '未包含' : '包含'],
    ['skills 文件（同目录 `skills\\`）', options?.skillFiles === true ? '包含' : '未包含'],
    ['本兜底文档', '包含（就是本文件）'],
  ]))
  lines.push('')
  lines.push('> 未包含的项目意味着这一份备份补不回来，需要你自己记得当时的设置。')
  lines.push('')

  lines.push('## 1. 手工重建步骤（照这个顺序做）')
  lines.push('')
  lines.push('1. 安装插件：按 §2 的 `安装命令` 列逐条执行（或在本插件的"导入"里勾选自动安装）。')
  lines.push('2. 填密钥：见 §3 的"需要填写的设置项"，在 设置 → 模型 / 凭据 中填写。')
  lines.push('3. 粘贴模型配置：把 §3 的 ```yaml 片段原样粘进 profile 的 `cordis.patch.yml`。')
  lines.push('4. 恢复 skills：把 §4 的 skill 目录放回 `<DSH_HOME>\\skills\\<name>\\`。')
  lines.push('5. 重启 DSH（配置变更是重启 / 热加载级别的事，不会即时生效）。')
  lines.push('')

  lines.push(`## 2. 插件（共 ${plugins.length} 个）`)
  lines.push('')
  if (plugins.length === 0) {
    lines.push('未采集到插件清单。')
  } else {
    lines.push(table(
      ['插件名', '版本', '用途', '安装命令'],
      plugins.map(item => [
        escapeCell(item.name),
        escapeCell(item.resolvedVersion ?? '未知'),
        escapeCell(item.description ?? ''),
        `\`${escapeCell(item.installCommand ?? `dsh plugin add ${item.spec}`)}\``,
      ]),
    ))
    const unportable = plugins.filter(item => item.unportable === true)
    if (unportable.length > 0) {
      lines.push('')
      lines.push('> ⚠️ 本地路径依赖（跨机器不可用，需要你自己准备同样的目录）：')
      for (const item of unportable) lines.push(`> - \`${item.name}\` → \`${item.spec}\``)
    }
    const disabled = plugins.filter(item => item.enabled === false)
    if (disabled.length > 0) {
      lines.push('')
      lines.push(`> 注意：备份时这些插件处于**被禁用**状态：${disabled.map(item => `\`${item.name}\``).join('、')}`)
    }
  }
  lines.push('')

  lines.push('## 3. 模型供应商与模型')
  lines.push('')
  if (models.length === 0) {
    lines.push('未采集到模型供应商配置。')
  } else {
    for (const provider of models) {
      lines.push(`### 3.${models.indexOf(provider) + 1} ${provider.provider}${provider.displayName ? `（${provider.displayName}）` : ''}`)
      lines.push('')
      lines.push(`- api：\`${provider.api ?? '未设置'}\`　baseURL：\`${provider.baseURL ?? '未设置'}\``)
      const envName = provider.apiKeyEnv ?? null
      const status = envName === null ? '不需要' : (credentialStatus[envName] ?? '导出时未检测')
      lines.push(`- **需要填写的设置项**：${envName === null ? '（该 provider 没有声明 apiKeyEnv）' : `\`${envName}\`（当前状态：${status}）`}`)
      lines.push('')
      if (provider.models.length > 0) {
        lines.push(table(
          ['模型 id', '名称', '上下文', '最大输出', '能力'],
          provider.models.map(model => [
            escapeCell(model.id),
            escapeCell(model.name ?? ''),
            escapeCell(model.contextWindow ?? ''),
            escapeCell(model.maxTokens ?? ''),
            escapeCell(Array.isArray(model.input) ? model.input.join(', ') : ''),
          ]),
        ))
        lines.push('')
      }
      const entry = entries.find(item => item.override?.providers?.[provider.provider] !== undefined)
      if (entry) {
        const safe = stripRedacted(entry.override, { prefix: '/override' })
        if (safe.removed.length > 0) {
          lines.push(`> 这个条目原本内联了 ${safe.removed.length} 处密钥，备份时已剥离 —— 它们**不会**出现在下面的片段里；`)
          lines.push('> 请按上面的"需要填写的设置项"在本机的 设置 → 模型 / 凭据 里填写。')
          lines.push('')
        }
        lines.push('可直接粘贴的配置（贴进 profile 的 `cordis.patch.yml`）：')
        lines.push('')
        lines.push('```yaml')
        lines.push(renderEntryYaml({ ...entry, override: safe.value }))
        lines.push('```')
        lines.push('')
      }
    }
  }
  if (required.length > 0) {
    lines.push('**本备份需要的设置项总表**（只有名字，没有值）：')
    lines.push('')
    lines.push(table(['设置项名称', '状态'], required.map(name => [`\`${name}\``, credentialStatus[name] ?? '导出时未检测'])))
    lines.push('')
  }

  lines.push('## 4. 默认模型')
  lines.push('')
  if (defaultModel === null) {
    lines.push('未采集到默认模型设置。')
  } else {
    lines.push(`provider \`${defaultModel.provider}\` / model \`${defaultModel.model}\` / reasoningEffort \`${defaultModel.reasoningEffort ?? '（未设置）'}\``)
    lines.push('')
    const entry = entries.find(item => item.override?.provider === defaultModel.provider && item.override?.model === defaultModel.model)
    if (entry) {
      const safe = stripRedacted(entry.override, { prefix: '/override' })
      lines.push('```yaml')
      lines.push(renderEntryYaml({ ...entry, override: safe.value }))
      lines.push('```')
    } else {
      // 条目不在产物里（例如那次没勾 profile 配置）也要给出可粘贴的片段。
      lines.push('```yaml')
      lines.push(renderEntryYaml({
        id: 'agent-default-model',
        name: '@deepseek-ai/dsh-agent-default-model',
        override: {
          provider: defaultModel.provider,
          model: defaultModel.model,
          ...(defaultModel.reasoningEffort === null ? {} : { reasoningEffort: defaultModel.reasoningEffort }),
        },
      }))
      lines.push('```')
    }
  }
  lines.push('')

  lines.push(`## 5. skills（共 ${skills.length} 个）`)
  lines.push('')
  if (skills.length === 0) {
    lines.push('本机未发现 user 级 skills。')
  } else {
    lines.push(table(
      ['名称', '描述', '本备份是否含文件'],
      skills.map(skill => [
        escapeCell(skill.name),
        escapeCell(skill.description ?? ''),
        skill.included === true ? '是' : '否（仅清单）',
      ]),
    ))
    if (options?.skillFiles !== true) {
      lines.push('')
      lines.push('> 本次导出**没有**勾选"连文件一起"，所以本文件只列了名字与描述；skill 文件需要你另行准备。')
    } else {
      lines.push('')
      lines.push('> skill 文件在同目录的 `skills\\` 子目录中，整份拷贝即可。')
    }
  }
  lines.push('')

  lines.push('---')
  lines.push('')
  lines.push('> 本文件由 dsh-BrittleBackup 生成，刻意不含配置原文与任何本机信息（U5），可以安全地单独分享。')
  return `${lines.join('\n')}\n`
}
