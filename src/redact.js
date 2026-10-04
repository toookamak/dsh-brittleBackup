/**
 * 脱敏：三道防线（SECURITY.md §2.3）
 *   ① 权威来源：`settings.describe({ redactSecrets: true })` 的 `secrets[].path`
 *   ② 结构化剥离：字段名启发式（`apiKey` / `token` / `password` / `secret` / …）
 *   ③ 导出前自查：正则扫描产物，命中即拦截
 *
 * 铁律：
 *   - 只处理"值"，从不读取 / 记录被剥离的具体内容；
 *   - 剥离**幂等**：已经剥离过的值再扫一次不报错、不重复记录；
 *   - `apiKeyEnv` 一类的**名字指针不得被剥离**。
 */

/** 被剥离后写入产物的占位符。 */
export const REDACTED = '<REDACTED>'

/** 字段名启发式：命中即剥离。 */
const SECRET_WORDS = new Set([
  'apikey', 'accesskey', 'privatekey', 'authtoken', 'token', 'password', 'passwd', 'secret', 'credential', 'authorization', 'cookie',
])

/**
 * 例外后缀：这些字段是**名字 / 位置 / 元数据**，不是值。
 * 例：`apiKeyEnv`（指向凭据 ref 的名字）、`tokenPath`、`secretRef`。
 */
const NAME_LIKE_SUFFIX_RE = /(env|name|ref|id|path|url|file|header|prefix|scheme|type|mode|length|count|expires|at|set|s)$/i

/** 公钥限定词：`publicKey` / `sshPublicKey` 可以公开，不算密钥。 */
const PUBLIC_WORDS = new Set(['public', 'pub'])

/**
 * 公钥例外**只认 `publicKey` / `pubKey` 这一种形态**。
 *
 * 不能写成"名字里出现 public 就放行"：`publicApiKey` 这种命名会因此漏掉，
 * 而它存的完全可能是一把真密钥。宁可把公钥也脱敏掉（用户自己再补一次），
 * 也不能因为一个词就放过整类字段。
 */
const isPublicKeyName = (parts) => parts.length === 2 && PUBLIC_WORDS.has(parts[0]) && parts[1] === 'key'

/** camelCase / snake_case / kebab-case 都要能切词。 */
function keyTokens(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(token => token.toLowerCase())
}

/**
 * 字段名是不是"看起来像密钥"。
 *
 * 用**切词后按词判定**而不是子串匹配：`apiKey` / `refreshToken` / `clientSecret` 命中，
 * 而 `maxTokens`（数字上限，复数词）、`tokens`、`requiredCredentials` 不命中 ——
 * 早期版本用子串匹配，把 `maxTokens: 256000` 当成密钥剥掉了（真 bug，已修）。
 *
 * 末位词是 `key` 也算密钥：`secretKey` / `signingKey` / `encryptionKey` /
 * `AWS_SECRET_ACCESS_KEY` / `appKey` 这类**没有 `sk-` 前缀也没有长 hex 形状**的明文密钥，
 * 防线 ③ 兜不住，只能靠防线 ② 拦住。名字指针（`keyId` / `keyName` / `apiKeyEnv`）
 * 与公钥（`publicKey`）由上面的例外规则放行。
 */
export function isSecretKey(key) {
  if (typeof key !== 'string' || key === '') return false
  if (NAME_LIKE_SUFFIX_RE.test(key)) return false
  const parts = keyTokens(key)
  if (parts.length === 0) return false
  if (SECRET_WORDS.has(parts.join(''))) return true
  if (SECRET_WORDS.has(parts[parts.length - 1])) return true
  if (parts[parts.length - 1] === 'key') return !isPublicKeyName(parts)
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === 'api' && parts[index + 1] === 'key') return true
  }
  return false
}

const escapePointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * 从 `settings.describe({ redactSecrets: true })` 的结果建立"密钥路径图"。
 * @returns {{ byEntry: Map<string, Set<string>>, entries: Map<string, Array<{path:string[],set:boolean}>> }}
 */
export function secretMapFromDescriptors(descriptors) {
  const byEntry = new Map()
  const entries = new Map()
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    const ns = typeof descriptor?.ns === 'string' ? descriptor.ns : ''
    if (ns === '') continue
    const list = Array.isArray(descriptor?.secrets) ? descriptor.secrets : []
    const pointerSet = new Set()
    const shaped = []
    for (const secret of list) {
      const segments = Array.isArray(secret?.path) ? secret.path.filter(part => typeof part === 'string' && part !== '') : []
      if (segments.length === 0) continue
      pointerSet.add(`/${segments.map(escapePointer).join('/')}`)
      shaped.push({ path: [...segments], set: secret?.set === true })
    }
    byEntry.set(ns, pointerSet)
    entries.set(ns, shaped)
  }
  return { byEntry, entries }
}

/** 取某个 entry 的密钥指针集合；`include:` 前缀自动去掉（loader id vs patch id）。 */
export function secretPointersForEntry(secretMap, entryId) {
  if (!secretMap) return new Set()
  if (typeof entryId !== 'string' || entryId === '') return new Set()
  const direct = secretMap.byEntry?.get(entryId)
  if (direct) return direct
  // loader id（`include:x`）与 patch id（`x`）两种写法都认。
  const stripped = entryId.replace(/^include:/, '')
  return secretMap.byEntry?.get(stripped) ?? secretMap.byEntry?.get(`include:${stripped}`) ?? new Set()
}

/**
 * 结构化剥离：返回新对象 + 剥离记录。
 * @param input 任意 JSON 值
 * @param options.secretPointers 该 entry 的密钥路径（相对 config 根，形如 `/providers/x/apiKey`）
 * @param options.prefix 记录用的指针前缀（entry 场景是 `/override`）
 */
export function stripSecrets(input, { secretPointers = new Set(), prefix = '' } = {}) {
  const redactions = []
  const walk = (value, pointer) => {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${pointer}/${index}`))
    if (value === null || typeof value !== 'object') return value
    const out = {}
    for (const [key, child] of Object.entries(value)) {
      const childPointer = `${pointer}/${escapePointer(key)}`
      const byHostMap = secretPointers.has(childPointer)
      // 启发式只吃"非空字符串"：数字 / 布尔 / 对象永远不是密钥值（否则 maxTokens 这类会被误剥）。
      const byHeuristic = !byHostMap && isSecretKey(key) && typeof child === 'string' && child !== ''
      if (byHostMap || byHeuristic) {
        if (child === REDACTED) {
          out[key] = child
          continue
        }
        if (child === null || child === undefined || child === '' || child === false) {
          out[key] = child
          continue
        }
        redactions.push({
          pointer: `${prefix}${childPointer}`,
          reason: byHostMap ? 'host-secret-path' : 'inline-secret',
        })
        out[key] = REDACTED
        continue
      }
      out[key] = walk(child, childPointer)
    }
    return out
  }
  return { value: walk(input, ''), redactions }
}

const SCAN_PATTERNS = [
  { id: 'openai-key', re: /sk-[A-Za-z0-9_-]{16,}/, hashLikeSkippable: true },
  { id: 'authorization-header', re: /authorization:\s*(?:bearer|basic)\s+\S+/i },
  { id: 'url-userinfo', re: /\/\/[^\s/@:]+:[^\s/@]+@/ },
  { id: 'long-hex', re: /(?<![0-9a-z])[0-9a-f]{32,}(?![0-9a-z])/i, hashLikeSkippable: true },
  { id: 'long-base64', re: /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/, hashLikeSkippable: true },
]

/**
 * 已知安全的指针：git commit / 版本串命中 `long-hex` 是必然的，不算密钥。
 * 这是**避免假阳性阻塞导出**的必要规则，写在代码里而不是靠运气。
 */
const HASH_LIKE_POINTER_RE = /\/(commit|resolvedVersion|dshVersion|pluginVersion|createdAt|hostname|arch|platform|node)$/

/**
 * 防线 ③：扫描任意 JSON 值，返回命中位置（**不返回命中的内容**）。
 * @returns {Array<{pointer:string, pattern:string}>}
 */
export function scanForSecrets(input, { prefix = '' } = {}) {
  const hits = []
  const walk = (value, pointer) => {
    if (typeof value === 'string') {
      if (value === REDACTED || value.includes(REDACTED)) return
      const hashLike = HASH_LIKE_POINTER_RE.test(pointer)
      for (const { id, re, hashLikeSkippable } of SCAN_PATTERNS) {
        if (hashLike === true && hashLikeSkippable === true) continue
        if (id === 'long-base64' && /^[0-9a-f]+$/i.test(value)) continue
        if (re.test(value)) hits.push({ pointer: `${prefix}${pointer}`, pattern: id })
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${pointer}/${index}`))
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${escapePointer(key)}`)
    }
  }
  walk(input, '')
  return hits
}

/**
 * 去掉所有已剥离的占位符（恢复 / 文档渲染用）。
 *
 * **绝不能把 `<REDACTED>` 写回配置、也不能让它出现在"可粘贴片段"里** ——
 * 那会把一个假值当成真值。返回被去掉的指针，让调用方去提示"这一项要自己补"。
 */
export function stripRedacted(input, { prefix = '' } = {}) {
  const removed = []
  const walk = (value, pointer) => {
    if (Array.isArray(value)) return value.map((item, index) => walk(item, `${pointer}/${index}`))
    if (value === null || typeof value !== 'object') return value
    const out = {}
    for (const [key, child] of Object.entries(value)) {
      const childPointer = `${pointer}/${escapePointer(key)}`
      if (child === REDACTED) {
        removed.push(`${prefix}${childPointer}`)
        continue
      }
      out[key] = walk(child, childPointer)
    }
    return out
  }
  return { value: walk(input, ''), removed }
}

/** 对任意文本（例如兜底文档）做同样的扫描，用于"文档里也不许出现密钥"。 */
export function scanTextForSecrets(text) {
  const hits = []
  if (typeof text !== 'string') return hits
  for (const { id, re } of SCAN_PATTERNS) {
    if (re.test(text)) hits.push({ pointer: '(text)', pattern: id })
  }
  return hits
}
