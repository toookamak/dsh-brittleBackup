/**
 * 日志：只走宿主 logger（缺失则 console），并且**永远先脱敏**。
 *
 * 本插件的日志规则（SECURITY.md §7）：密码 / Token 从不出现在日志里；本机路径只允许
 * 以 `<DSH_HOME>` / `<PROFILE_DIR>` / `~` 的形式出现。
 */
import { homedir } from 'node:os'
import { dshHome, profileDir, PLUGIN_ID } from './paths.js'

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAuthorization:\s*\S+/gi,
  /\/\/[^\s/@:]+:[^\s/@]+@/g,
]

export function maskText(input, env = process.env) {
  let text = typeof input === 'string' ? input : String(input)
  const replacements = [
    [profileDir(env), '<PROFILE_DIR>'],
    [dshHome(env), '<DSH_HOME>'],
    [homedir(), '~'],
  ]
  for (const [from, to] of replacements) {
    if (typeof from === 'string' && from !== '') {
      text = text.split(from).join(to)
      if (process.platform === 'win32') text = text.split(from.toLowerCase()).join(to)
    }
  }
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '<REDACTED>')
  return text
}

function emit(level, args) {
  const text = args.map(value => (typeof value === 'string' ? value : safeStringify(value))).join(' ')
  const masked = maskText(text)
  if (level === 'error') console.error(`[${PLUGIN_ID}] ${masked}`)
  else if (level === 'warn') console.warn(`[${PLUGIN_ID}] ${masked}`)
  else console.log(`[${PLUGIN_ID}] ${masked}`)
}

function safeStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * @param ctx 宿主上下文（可缺 logger）。
 * @returns 带 info/warn/error/debug 的日志器；所有输出都经过 maskText。
 */
export function createLogger(ctx) {
  let host = undefined
  try {
    if (typeof ctx?.logger === 'function') {
      const candidate = ctx.logger(PLUGIN_ID)
      if (candidate && typeof candidate === 'object') host = candidate
    }
  } catch {
    host = undefined
  }

  const call = (level, args) => {
    const maskedArgs = args.map(value => (typeof value === 'string' ? maskText(value) : value))
    const fn = host?.[level]
    if (typeof fn === 'function') {
      try {
        fn.apply(host, maskedArgs)
        return
      } catch {
        /* 宿主 logger 抛错不是本插件的失败 */
      }
    }
    emit(level, args)
  }

  return {
    info: (...args) => call('info', args),
    warn: (...args) => call('warn', args),
    error: (...args) => call('error', args),
    /** 同一个 key 只警告一次，避免 loader 阶段刷屏。 */
    once(key, level, ...args) {
      if (warned.has(key)) return
      warned.add(key)
      call(level, args)
    },
  }
}

const warned = new Set()
