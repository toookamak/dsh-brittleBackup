/**
 * 「打开备份路径」（体验优化项 1）：
 *   1. `openInFileManager` 只拉起系统文件管理器，参数是原样路径（不经 shell）；
 *   2. 不支持的平台 / spawn 抛错都返回结构化结果，绝不抛给宿主；
 *   3. `POST /open`：存在的绝对目录才放行，非 loopback / 跨源照样被硬化挡下。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { openInFileManager, resolveOpenCommand } from '../src/open.js'
import { mountRoutes, ROUTE_PREFIX } from '../src/routes.js'
import { TaskRegistry } from '../src/task.js'
import { makeFakeHost } from './helpers/fake-host.js'

function makeRequest({ method = 'POST', headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}

function makeResponse() {
  const state = { statusCode: 200, headers: null, body: '', ended: false }
  return {
    state,
    writeHead(status, headers) { state.statusCode = status; state.headers = headers },
    end(chunk) { if (chunk !== undefined) state.body += chunk; state.ended = true },
  }
}

test('open：每个平台的命令与参数都是"路径原样一个参数"', () => {
  const target = 'F:\\Git\\dsh brittle backup\\backups'
  assert.deepEqual(resolveOpenCommand('win32', target), { command: 'explorer.exe', args: [target] })
  assert.deepEqual(resolveOpenCommand('darwin', target), { command: 'open', args: [target] })
  assert.deepEqual(resolveOpenCommand('linux', target), { command: 'xdg-open', args: [target] })
  assert.equal(resolveOpenCommand('freebsd', target), null)
})

test('open：detached + stdio ignore + unref，绝不阻塞宿主', async () => {
  const calls = []
  const spawned = { unrefCalled: false, listeners: {}, unref() { this.unrefCalled = true }, on(name, handler) { this.listeners[name] = handler; return this } }
  const result = await openInFileManager('F:\\backups', {
    platform: 'win32',
    spawnImpl: (command, args, options) => { calls.push({ command, args, options }); return spawned },
  })
  assert.equal(result.ok, true)
  assert.equal(result.command, 'explorer.exe')
  assert.deepEqual(calls[0].args, ['F:\\backups'])
  assert.equal(calls[0].options.detached, true)
  assert.equal(calls[0].options.stdio, 'ignore')
  assert.equal(spawned.unrefCalled, true)
  assert.equal(typeof spawned.listeners.error, 'function', '必须挂 error 监听，否则 spawn 失败会变成未捕获异常')
})

test('open：不支持的平台与 spawn 抛错都返回结构化失败', async () => {
  const unsupported = await openInFileManager('F:\\backups', { platform: 'aix', spawnImpl: () => { throw new Error('不该被调用') } })
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.code, 'OPEN_UNSUPPORTED')

  const failed = await openInFileManager('F:\\backups', {
    platform: 'linux',
    spawnImpl: () => { throw new Error('xdg-open 不存在') },
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'OPEN_FAILED')
  assert.ok(failed.reason.includes('xdg-open'))
})

async function setupOpen({ openResult = { ok: true, path: 'F:\\backups', command: 'explorer.exe' } } = {}) {
  const host = await makeFakeHost({})
  const routes = []
  const opened = []
  const ctx = {
    get(key) {
      if (key === 'webServer') return { register: route => { routes.push(route); return () => {} } }
      return host.ctx.get(key)
    },
    logger: host.ctx.logger,
  }
  mountRoutes({
    ctx,
    tasks: new TaskRegistry(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, once: () => {} },
    env: host.env,
    openDirectory: async (target) => { opened.push(target); return openResult },
  })
  const call = async (suffix, options) => {
    const route = routes.find(item => item.path === `${ROUTE_PREFIX}${suffix}`)
    assert.ok(route, `路由 ${suffix} 未注册`)
    const response = makeResponse()
    await route.handler(makeRequest(options), response)
    return { status: response.state.statusCode, payload: response.state.body === '' ? null : JSON.parse(response.state.body) }
  }
  return { host, call, opened, routes }
}

const ORIGIN = { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }

test('路由 /open：只接受存在的绝对目录，并把真实路径交给打开函数', async () => {
  const { host, call, opened } = await setupOpen()
  const ok = await call('/open', { headers: ORIGIN, body: { path: host.root } })
  assert.equal(ok.status, 200, JSON.stringify(ok.payload))
  assert.equal(ok.payload.opened, true)
  assert.deepEqual(opened, [host.root])

  const missing = await call('/open', { headers: ORIGIN, body: { path: join(host.root, 'nope') } })
  assert.equal(missing.status, 400)
  assert.equal(missing.payload.error.code, 'PATH_UNSAFE')

  const relative = await call('/open', { headers: ORIGIN, body: { path: 'relative/dir' } })
  assert.equal(relative.status, 400)

  assert.equal(opened.length, 1, '被拒的请求不能触发打开动作')
})

test('路由 /open：打开失败返回 503，且照样受 loopback / 同源硬化保护', async () => {
  const { host, call } = await setupOpen({ openResult: { ok: false, code: 'OPEN_UNSUPPORTED', reason: '当前平台没有文件管理器' } })
  const failed = await call('/open', { headers: ORIGIN, body: { path: host.root } })
  assert.equal(failed.status, 503)
  assert.equal(failed.payload.error.code, 'OPEN_UNSUPPORTED')

  const crossOrigin = await call('/open', { headers: { host: '127.0.0.1:19387', origin: 'http://evil.example', 'content-type': 'application/json' }, body: { path: host.root } })
  assert.equal(crossOrigin.status, 403)
  assert.equal(crossOrigin.payload.error.code, 'BAD_ORIGIN')

  const remote = await call('/open', { headers: ORIGIN, body: { path: host.root }, remoteAddress: '10.0.0.5' })
  assert.equal(remote.status, 403)
  assert.equal(remote.payload.error.code, 'NOT_LOOPBACK')
})
