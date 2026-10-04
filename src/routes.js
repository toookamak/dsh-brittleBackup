/**
 * 本机 HTTP 路由（PROJECT-PLAN §17.2 / SECURITY.md §4）。
 *
 * 这是"可以被浏览器触发"的攻击面，所以：
 *   只接受 loopback 直连；拒绝一切转发头；POST 必须同源；GET 一律无副作用；
 *   导出落点 / 导入来源只能来自"选择器白名单"（一次性，用后失效）。
 */
import { dirname, isAbsolute } from 'node:path'
import { inspectImport, runImport } from './restore/import.js'
import { runExport } from './export.js'
import { buildQueryReport } from './query.js'
import { DEFAULT_OPTIONS, loadSettings, saveSettings } from './settings.js'
import { degradationNotes } from './collect/index.js'
import { openInFileManager } from './open.js'
import { probeServices, service } from './services.js'
import { ownVersion } from './collect/index.js'
import { PLUGIN_ID } from './paths.js'
import { stat } from 'node:fs/promises'

export const ROUTE_PREFIX = `/${PLUGIN_ID}`
const BODY_LIMIT = 256 * 1024

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function normalizePath(value) {
  const resolved = isAbsolute(value) ? value : null
  if (resolved === null) return null
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 选择器白名单：只放行"选择器刚刚返回的"路径，用掉即失效。 */
export class PickerAllowlist {
  #paths = new Set()

  allow(path) {
    const normalized = normalizePath(path)
    if (normalized === null) return false
    this.#paths.add(normalized)
    return true
  }

  consume(path) {
    const normalized = normalizePath(path)
    if (normalized === null) return false
    if (!this.#paths.has(normalized)) return false
    this.#paths.delete(normalized)
    return true
  }

  size() {
    return this.#paths.size
  }
}

function isLoopback(request) {
  const address = request?.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function hasForwardedHeaders(request) {
  return ['forwarded', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-host'].some(name => request.headers?.[name] !== undefined)
}

function hostIsLoopback(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return false
  const withoutPort = hostHeader.replace(/:\d+$/, '')
  return LOOPBACK_NAMES.has(withoutPort.toLowerCase())
}

function headerContains(request, name, needle) {
  const value = request.headers?.[name]
  return typeof value === 'string' && value.toLowerCase().includes(needle)
}

/**
 * "这条请求看起来是我们自己的页面发的吗"：只要有 JSON 的 content-type 或 accept 之一即可。
 * 容忍宿主/Electron 的 fetch 包装只保留其中一个头的情况。
 */
function looksLikePageRequest(request) {
  return headerContains(request, 'content-type', 'application/json') || headerContains(request, 'accept', 'application/json')
}

/**
 * 同源判定（2026-10-02 修订）。
 *
 * 真正的 CSRF 防护是**"带 Origin 时必须同源"**，而不是"必须带 Origin"：
 * 浏览器对跨源 POST 一定会带 Origin，所以少了这一条不会放过攻击者；
 * 反过来，同一个页面在 Electron / 被宿主 fetch 包装 的情况下**可能不带 Origin**，
 * 硬要求它只会把用户自己挡在外面（实测：填本地路径时被 403「缺少 Origin」挡住）。
 *
 * 因此：
 *   - `Host` 必须是 loopback（防 DNS rebinding）；
 *   - `Origin` **存在**时必须能解析、必须与 Host 同源、必须也是 loopback；`Origin: null`
 *     （file:// / 沙箱 iframe 之类的不透明来源）一律拒绝；
 *   - `Origin` 缺失时放行，但要求请求"看起来像页面请求"（JSON 的 content-type 或 accept）。
 *     我们自己发的请求永远满足；而浏览器不会给跨源请求去掉 Origin，所以这条不构成新的放行面。
 */
function sameOrigin(request) {
  const host = request.headers?.host
  const origin = request.headers?.origin
  if (!hostIsLoopback(host)) return { ok: false, reason: 'Host 不是 loopback（防 rebinding）' }
  if (origin === undefined || origin === null || origin === '') {
    if (!looksLikePageRequest(request)) {
      return { ok: false, reason: '没有 Origin 时必须带 JSON 的 content-type 或 accept' }
    }
    return { ok: true, originAbsent: true }
  }
  if (typeof origin !== 'string' || origin === 'null') return { ok: false, reason: `Origin 是不透明来源：${String(origin)}` }
  try {
    const parsed = new URL(origin)
    if (parsed.host !== host) return { ok: false, reason: 'Origin 与 Host 不同源' }
    if (!hostIsLoopback(parsed.host)) return { ok: false, reason: 'Origin 不是 loopback' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'Origin 不是合法 URL' }
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function sendError(response, status, code, message, detail = undefined) {
  sendJson(response, status, { error: { code, message, ...(detail === undefined ? {} : { detail }) } })
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) throw Object.assign(new Error('请求体过大'), { code: 'BODY_TOO_LARGE' })
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' })
  }
}

function normalizeOptions(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const out = {}
  for (const key of Object.keys(DEFAULT_OPTIONS)) out[key] = source[key] === undefined ? DEFAULT_OPTIONS[key] : source[key] === true
  return out
}

function normalizeSelection(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const off = source.off !== null && typeof source.off === 'object' ? source.off : {}
  const rawOverrides = source.overrides !== null && typeof source.overrides === 'object' ? source.overrides : {}
  const list = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : [])
  return {
    // `overrides` 是三态勾选通道：缺省 = 听计划默认值，显式布尔 = 用户改过。
    overrides: Object.fromEntries(Object.entries(rawOverrides).filter(([, value]) => typeof value === 'boolean')),
    off: Object.fromEntries(Object.entries(off).filter(([, value]) => value === true)),
    overwriteSkills: list(source.overwriteSkills),
    overwritePlugins: list(source.overwritePlugins),
    ackBuildScripts: source.ackBuildScripts === true,
  }
}

async function requirePath(path, { mustExist = true } = {}) {
  if (typeof path !== 'string' || path.trim() === '') return null
  const resolved = path.trim()
  if (!isAbsolute(resolved)) return null
  if (mustExist && (await stat(resolved).catch(() => null)) === null) return null
  return resolved
}

/**
 * 「打开备份路径」要把哪个目录交给文件管理器（PROJECT-PLAN 体验优化项 1）。
 *
 * **为什么存在**（这是配合客户端 zip 选择流程的服务端落点）：客户端的「选择 ZIP…」
 * 会把选中的**文件**路径写进同一个输入框，而同一个输入框旁边的「打开备份路径」按钮
 * 照旧可点、提示语也写着"打开来源目录或 zip 所在位置"。客户端半不能改，所以这里
 * 把这条语义补上：**路径存在但不是目录时，改开它所在的目录**（dirname）。
 *
 * 目录的行为不变；路径为空 / 不是绝对路径 / 不存在一律拒绝，并给出对应原因。
 * @returns {Promise<{path:string}|{error:string}>}
 */
async function resolveOpenableDirectory(path) {
  if (typeof path !== 'string' || path.trim() === '') return { error: '要打开的路径不能为空' }
  const resolved = path.trim()
  if (!isAbsolute(resolved)) return { error: '要打开的路径必须是绝对路径，不能是相对路径' }
  const info = await stat(resolved).catch(() => null)
  if (info === null) return { error: '要打开的路径不存在' }
  if (info.isDirectory()) return { path: resolved }
  const parent = dirname(resolved)
  const parentInfo = await stat(parent).catch(() => null)
  if (parentInfo?.isDirectory() !== true) return { error: '要打开的路径所在目录也不存在，无法打开' }
  return { path: parent }
}

/**
 * 挂载路由。
 * @param openDirectory 可注入：测试用假实现替掉"真的拉起文件管理器"
 * @returns disposer（把所有注册过的路由一起摘掉）
 */
export function mountRoutes({ ctx, tasks, logger, env = process.env, openDirectory = openInFileManager }) {
  const allowlist = new PickerAllowlist()
  const webServer = service(ctx, 'webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') {
    logger?.once?.('no-web-server', 'warn', '宿主没有 webServer 服务：本插件无 UI，仅宿主侧能力可用')
    return () => {}
  }

  const guards = request => {
    if (!isLoopback(request)) return { status: 403, code: 'NOT_LOOPBACK', message: '只接受 loopback 直连' }
    if (hasForwardedHeaders(request)) return { status: 403, code: 'FORWARDED_HEADER', message: '带转发头的请求一律拒绝' }
    return null
  }

  const register = (suffix, handler, { method = 'POST' } = {}) => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}${suffix}`,
    handler: async (request, response) => {
      const guard = guards(request)
      if (guard !== null) return sendError(response, guard.status, guard.code, guard.message)
      if (request.method !== method) {
        response.writeHead(405, { allow: method })
        return response.end()
      }
      if (method !== 'GET') {
        const origin = sameOrigin(request)
        if (!origin.ok) return sendError(response, 403, 'BAD_ORIGIN', origin.reason)
        if (origin.originAbsent === true) {
          logger?.once?.('origin-absent', 'info', `${suffix}：请求没有 Origin（宿主 fetch 包装 / Electron 常见），已按"页面请求"放行`)
        }
      } else if (!hostIsLoopback(request.headers?.host)) {
        return sendError(response, 403, 'BAD_HOST', 'Host 不是 loopback')
      }
      try {
        await handler(request, response)
      } catch (error) {
        logger?.error?.(`路由 ${suffix} 失败：${error?.message ?? String(error)}`)
        const status = error?.code === 'BUSY' ? 409 : response.statusCode === 200 ? 500 : response.statusCode
        sendError(response, status, error?.code ?? 'INTERNAL', error?.message ?? String(error), error?.detail)
      }
    },
  })

  const disposers = []

  // ---- 状态（GET 无副作用） ----
  disposers.push(register('/state', async (request, response) => {
    const settings = await loadSettings(env)
    const services = probeServices(ctx, ['settings', 'configEditor', 'pluginManager', 'credentials', 'skills', 'agents', 'fs', 'directoryPicker'])
    const notes = degradationNotes({
      services: {
        configEditor: services.configEditor === true,
        settings: services.settings === true,
        pluginManager: services.pluginManager === true,
        skills: services.skills === true,
      },
    })
    sendJson(response, 200, {
      plugin: { id: PLUGIN_ID, version: await ownVersion(), artifactVersion: 1 },
      services,
      degradation: notes,
      settings: { options: settings.settings.options, lastExportDir: settings.settings.lastExportDir, lastImportDir: settings.settings.lastImportDir, degraded: settings.degraded },
      picker: { allowlistSize: allowlist.size() },
      ...tasks.view(),
    })
  }, { method: 'GET' }))

  // ---- 目录选择（宿主侧优先；客户端选择器可登记一次） ----
  disposers.push(register('/pick', async (request, response) => {
    const body = await readJsonBody(request)
    if (typeof body.path === 'string' && body.path !== '') {
      const selected = await requirePath(body.path)
      if (selected === null) return sendError(response, 400, 'PATH_UNSAFE', '登记的路径必须是存在的绝对目录或 zip 文件路径')
      allowlist.allow(selected)
      return sendJson(response, 200, { path: selected, via: 'registered' })
    }
    const controller = service(ctx, 'directoryPickerController')
    if (controller !== undefined && typeof controller.pick === 'function') {
      const picked = await controller.pick(new AbortController().signal).catch(() => null)
      if (typeof picked === 'string' && picked !== '') {
        allowlist.allow(picked)
        return sendJson(response, 200, { path: picked, via: 'host-picker' })
      }
      return sendJson(response, 200, { path: null, via: 'host-picker' })
    }
    return sendError(response, 503, 'SERVICE_UNAVAILABLE', '宿主没有可用的目录选择器；可把路径登记一次（POST /pick {path}）', { pickerService: false })
  }))

  // ---- 配置查询（只读：生成可复制的安全文本，不写任何用户配置） ----
  disposers.push(register('/query', async (request, response) => {
    const body = await readJsonBody(request)
    const sourceDir = typeof body.sourceDir === 'string' && body.sourceDir !== '' ? body.sourceDir : null
    if (sourceDir === null || !allowlist.consume(sourceDir)) {
      return sendError(response, 403, 'PICKER_NOT_ALLOWED', '查询来源必须来自目录选择器（白名单一次性有效）')
    }
    const report = await buildQueryReport({ sourceDir, env, detail: body.detail === true })
    if (!report.ok) return sendError(response, 400, report.code, report.reason, { candidates: report.candidates, errors: report.errors })
    sendJson(response, 200, report)
  }))

  // ---- 打开目录（体验优化项 1；只拉起系统文件管理器，不改任何文件） ----
  disposers.push(register('/open', async (request, response) => {
    const body = await readJsonBody(request)
    const target = await resolveOpenableDirectory(body.path)
    if (target.path === undefined) return sendError(response, 400, 'PATH_UNSAFE', target.error)
    const opened = await openDirectory(target.path, { logger })
    if (opened?.ok !== true) {
      return sendError(response, 503, opened?.code ?? 'OPEN_FAILED', opened?.reason ?? '打开目录失败')
    }
    sendJson(response, 200, { opened: true, path: opened.path ?? target.path, via: opened.command ?? null })
  }))

  // ---- 导出 ----
  disposers.push(register('/export', async (request, response) => {
    const body = await readJsonBody(request)
    const options = normalizeOptions(body.options)
    let targetDir = typeof body.targetDir === 'string' && body.targetDir !== '' ? body.targetDir : null
    if (targetDir === null) {
      return sendError(response, 400, 'TARGET_REQUIRED', '还没选落点，不能导出。请选一个你自己保管的目录；插件工作目录不是备份库。')
    }
    if (!allowlist.consume(targetDir)) {
      return sendError(response, 403, 'PICKER_NOT_ALLOWED', '导出目录必须来自目录选择器（白名单一次性有效）')
    }
    // 落点必须是本次用户显式选择，不复用上一次的目录，也不再把空落点写进插件工作目录。
    const task = tasks.begin('export')
    runExport({ ctx, env, targetDir, options, task, logger })
      .then(async report => {
        await saveSettings({ options }, env)
        tasks.finish(task, report)
      })
      .catch(error => {
        logger?.error?.(`导出失败：${error?.message ?? String(error)}`)
        tasks.fail(task, error)
      })
    sendJson(response, 202, { taskId: task.id })
  }))

  // ---- 只读预览 ----
  disposers.push(register('/inspect', async (request, response) => {
    const body = await readJsonBody(request)
    const sourceDir = typeof body.sourceDir === 'string' && body.sourceDir !== '' ? body.sourceDir : null
    if (sourceDir === null || !allowlist.consume(sourceDir)) {
      return sendError(response, 403, 'PICKER_NOT_ALLOWED', '导入来源必须来自目录选择器（白名单一次性有效）')
    }
    await saveSettings({ lastImportDir: sourceDir }, env)
    const inspected = await inspectImport({ ctx, env, sourceDir, selection: body.selection ?? null, logger })
    if (!inspected.ok) return sendError(response, 400, inspected.code, inspected.reason, { errors: inspected.errors, warnings: inspected.warnings, candidates: inspected.candidates })
    const { internal, ...view } = inspected
    sendJson(response, 200, view)
  }))

  // ---- 导入 ----
  disposers.push(register('/import', async (request, response) => {
    const body = await readJsonBody(request)
    const sourceDir = typeof body.sourceDir === 'string' && body.sourceDir !== '' ? body.sourceDir : null
    if (sourceDir === null || !allowlist.consume(sourceDir)) {
      return sendError(response, 403, 'PICKER_NOT_ALLOWED', '导入来源必须来自目录选择器（白名单一次性有效）')
    }
    const selection = normalizeSelection(body.selection)
    const task = tasks.begin('import')
    runImport({ ctx, env, sourceDir, selection, task, logger })
      .then(report => tasks.finish(task, report))
      .catch(error => {
        logger?.error?.(`导入失败：${error?.message ?? String(error)}`)
        tasks.fail(task, error)
      })
    sendJson(response, 202, { taskId: task.id })
  }))

  // ---- 取消 ----
  disposers.push(register('/cancel', async (request, response) => {
    const body = await readJsonBody(request)
    const canceled = tasks.cancel(typeof body.taskId === 'string' ? body.taskId : undefined)
    sendJson(response, 200, canceled)
  }))

  logger?.info?.(`已挂载路由：${ROUTE_PREFIX}/*`)
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* 摘路由失败不影响卸载 */
      }
    }
  }
}
