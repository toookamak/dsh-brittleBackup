/**
 * 从结构化配置条目派生模型信息（FORMAT.md §2 items.models / items.defaultModel）。
 *
 * 只读派生：provider 结构与 `llm-pi-ai` 的 config 形状一致；默认模型来自
 * `agent-default-model`。**不含任何密钥值**，`apiKeyEnv` 是名字指针，必须保留。
 */

const MODEL_FIELDS = ['id', 'name', 'contextWindow', 'maxTokens', 'input']

export function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object') return null
  const model = {}
  for (const field of MODEL_FIELDS) {
    const value = raw[field]
    if (value === undefined || value === null) continue
    if (field === 'input') {
      if (Array.isArray(value)) model.input = value.filter(item => typeof item === 'string')
      continue
    }
    model[field] = value
  }
  return typeof model.id === 'string' && model.id !== '' ? model : null
}

export function normalizeProvider(key, raw) {
  const provider = raw && typeof raw === 'object' ? raw : {}
  const models = Array.isArray(provider.models) ? provider.models.map(normalizeModel).filter(Boolean) : []
  return {
    provider: key,
    displayName: typeof provider.displayName === 'string' ? provider.displayName : null,
    api: typeof provider.api === 'string' ? provider.api : null,
    baseURL: typeof provider.baseURL === 'string' ? provider.baseURL : null,
    apiKeyEnv: typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv : null,
    models,
  }
}

/**
 * @param entries 采集到的结构化条目（`override` 已脱敏）
 */
export function collectModels(entries) {
  const providers = []
  const warnings = []
  let defaultModel = null

  for (const entry of Array.isArray(entries) ? entries : []) {
    const config = entry?.override
    if (!config || typeof config !== 'object') continue
    if (config.providers !== undefined) {
      if (config.providers === null || typeof config.providers !== 'object' || Array.isArray(config.providers)) {
        warnings.push(`条目 ${entry.id} 的 providers 不是对象，模型信息未采集`)
      } else {
        for (const [key, raw] of Object.entries(config.providers)) {
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            warnings.push(`provider ${key} 的结构不是对象，已跳过`)
            continue
          }
          providers.push(normalizeProvider(key, raw))
        }
      }
    }
    if (typeof config.provider === 'string' && typeof config.model === 'string') {
      defaultModel = {
        provider: config.provider,
        model: config.model,
        reasoningEffort: typeof config.reasoningEffort === 'string' ? config.reasoningEffort : null,
      }
    }
  }

  providers.sort((a, b) => a.provider.localeCompare(b.provider))
  const requiredCredentials = [...new Set(providers.map(item => item.apiKeyEnv).filter(value => typeof value === 'string' && value !== ''))].sort()
  return { providers, defaultModel, requiredCredentials, warnings }
}

/** §7-#11：模型配置结构是否符合当前 `llm-pi-ai` 形状。 */
export function validateModelStructure(providers) {
  const problems = []
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (typeof provider?.provider !== 'string' || provider.provider === '') problems.push('provider 缺少 key')
    if (provider?.api !== null && provider?.api !== undefined && typeof provider.api !== 'string') problems.push(`provider ${provider?.provider} 的 api 不是字符串`)
    if (provider?.baseURL !== null && provider?.baseURL !== undefined && !/^https?:\/\//.test(String(provider.baseURL))) {
      problems.push(`provider ${provider?.provider} 的 baseURL 不是 http(s) URL`)
    }
    for (const model of Array.isArray(provider?.models) ? provider.models : []) {
      if (typeof model?.id !== 'string' || model.id === '') problems.push(`provider ${provider?.provider} 有模型缺少 id`)
    }
  }
  return problems
}
