import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mountRoutes, ROUTE_PREFIX } from '../src/routes.js'
import { TaskRegistry } from '../src/task.js'
import { makeFakeHost } from './helpers/fake-host.js'

function makeRequest({ method = 'GET', headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeResponse() {
  const state = { statusCode: 200, headers: null, body: '', ended: false }
  return {
    state,
    writeHead(status, headers) {
      state.statusCode = status
      state.headers = headers
    },
    end(chunk) {
      if (chunk !== undefined) state.body += chunk
      state.ended = true
    },
  }
}

async function setup() {
  const host = await makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: {} } }],
    bundles: [{ name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true }],
  })
  const routes = []
  const tasks = new TaskRegistry()
  const logger = { info: () => {}, warn: () => {}, error: () => {}, once: () => {} }
  const ctx = {
    get(key) {
      if (key === 'webServer') return { register: route => { routes.push(route); return () => {} } }
      return host.ctx.get(key)
    },
    logger: host.ctx.logger,
  }
  const dispose = mountRoutes({ ctx, tasks, logger, env: host.env })
  const call = async (suffix, options) => {
    const route = routes.find(item => item.path === `${ROUTE_PREFIX}${suffix}`)
    assert.ok(route, `路由 ${suffix} 未注册`)
    const response = makeResponse()
    await route.handler(makeRequest(options), response)
    return response.state
  }
  return { host, routes, tasks, call, dispose }
}

const ORIGIN = { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }

test('路由：五个端点都按 exact 注册', async () => {
  const { routes } = await setup()
  assert.deepEqual(routes.map(route => route.path).sort(), [
    `${ROUTE_PREFIX}/cancel`,
    `${ROUTE_PREFIX}/export`,
    `${ROUTE_PREFIX}/import`,
    `${ROUTE_PREFIX}/inspect`,
    `${ROUTE_PREFIX}/pick`,
    `${ROUTE_PREFIX}/state`,
  ].sort())
  assert.equal(routes.every(route => route.kind === 'exact'), true)
})

test('路由硬化：非 loopback / 转发头 / 跨源 / 缺 Origin 一律拒绝', async () => {
  const { call } = await setup()

  const remote = await call('/state', { method: 'GET', headers: { host: '127.0.0.1:19387' }, remoteAddress: '10.0.0.5' })
  assert.equal(remote.statusCode, 403)
  assert.equal(JSON.parse(remote.body).error.code, 'NOT_LOOPBACK')

  const forwarded = await call('/state', { method: 'GET', headers: { host: '127.0.0.1:19387', 'x-forwarded-for': '1.2.3.4' } })
  assert.equal(forwarded.statusCode, 403)
  assert.equal(JSON.parse(forwarded.body).error.code, 'FORWARDED_HEADER')

  const noOrigin = await call('/export', { method: 'POST', headers: { host: '127.0.0.1:19387' }, body: {} })
  assert.equal(noOrigin.statusCode, 403)
  assert.equal(JSON.parse(noOrigin.body).error.code, 'BAD_ORIGIN')

  const crossOrigin = await call('/export', { method: 'POST', headers: { host: '127.0.0.1:19387', origin: 'http://evil.example' }, body: {} })
  assert.equal(crossOrigin.statusCode, 403)
  assert.equal(JSON.parse(crossOrigin.body).error.code, 'BAD_ORIGIN')

  const badHost = await call('/state', { method: 'GET', headers: { host: 'rebind.example' } })
  assert.equal(badHost.statusCode, 403)
  assert.equal(JSON.parse(badHost.body).error.code, 'BAD_HOST')
})

test('路由：GET /state 无副作用，返回服务探测与任务视图', async () => {
  const { call } = await setup()
  const ok = await call('/state', { method: 'GET', headers: { host: '127.0.0.1:19387' } })
  assert.equal(ok.statusCode, 200)
  const payload = JSON.parse(ok.body)
  assert.equal(payload.plugin.id, 'brittle-backup')
  assert.equal(typeof payload.services.configEditor, 'boolean')
  assert.equal(payload.task, null)
  assert.equal(Array.isArray(payload.degradation), true)
})

test('路由：方法不匹配 → 405，且 GET 不能触发写动作', async () => {
  const { call } = await setup()
  const wrongMethod = await call('/export', { method: 'GET', headers: { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' } })
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.headers.allow, 'POST')
})

test('路由：导出目录必须来自选择器白名单（一次性）', async () => {
  const { call, host } = await setup()

  const denied = await call('/export', { method: 'POST', headers: ORIGIN, body: { targetDir: join(host.root, 'nope') } })
  assert.equal(denied.statusCode, 403)
  assert.equal(JSON.parse(denied.body).error.code, 'PICKER_NOT_ALLOWED')

  const pick = await call('/pick', { method: 'POST', headers: ORIGIN, body: { path: host.root } })
  assert.equal(pick.statusCode, 200)
  assert.equal(JSON.parse(pick.body).via, 'registered')

  const accepted = await call('/export', { method: 'POST', headers: ORIGIN, body: { targetDir: host.root, options: { skills: false } } })
  assert.equal(accepted.statusCode, 202)
  assert.ok(JSON.parse(accepted.body).taskId)

  // 白名单一次性：第二次直接用同一个目录必须被拒
  const reused = await call('/export', { method: 'POST', headers: ORIGIN, body: { targetDir: host.root } })
  assert.equal(reused.statusCode, 403)
})

test('路由：/pick 拒绝不存在的路径与相对路径', async () => {
  const { call, host } = await setup()
  const missing = await call('/pick', { method: 'POST', headers: ORIGIN, body: { path: join(host.root, 'does-not-exist') } })
  assert.equal(missing.statusCode, 400)
  const relative = await call('/pick', { method: 'POST', headers: ORIGIN, body: { path: 'relative/dir' } })
  assert.equal(relative.statusCode, 400)
})

test('路由：inspect / import 同样要白名单，取消返回状态', async () => {
  const { call, tasks } = await setup()
  const denied = await call('/inspect', { method: 'POST', headers: ORIGIN, body: { sourceDir: 'F:\\nope' } })
  assert.equal(denied.statusCode, 403)

  const canceled = await call('/cancel', { method: 'POST', headers: ORIGIN, body: { taskId: 'nope' } })
  assert.equal(canceled.statusCode, 200)
  assert.equal(JSON.parse(canceled.body).canceled, false)
  assert.equal(tasks.current, null)
})

test('路由：已有任务在跑时第二个写请求 → 409 BUSY', async () => {
  const { call, tasks, host } = await setup()
  tasks.begin('import') // 手工占住任务位
  const pick = await call('/pick', { method: 'POST', headers: ORIGIN, body: { path: host.root } })
  assert.equal(pick.statusCode, 200)
  const busy = await call('/export', { method: 'POST', headers: ORIGIN, body: { targetDir: host.root } })
  assert.equal(busy.statusCode, 409)
  assert.equal(JSON.parse(busy.body).error.code, 'BUSY')
})

test('路由：宿主没有 webServer 时不抛错，只记一次警告', async () => {
  let warned = 0
  const dispose = mountRoutes({
    ctx: { get: () => undefined, logger: () => ({}) },
    tasks: new TaskRegistry(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, once: () => { warned += 1 } },
    env: {},
  })
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.equal(warned, 1)
})
