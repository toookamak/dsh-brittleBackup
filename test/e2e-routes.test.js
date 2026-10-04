/**
 * 端到端：完全走本机路由（浏览器会走的那条路）把"导出 → 预览 → 导入"跑一遍。
 * 这是没有浏览器时，对用户真实操作路径最接近的验证。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mountRoutes, ROUTE_PREFIX } from '../src/routes.js'
import { TaskRegistry } from '../src/task.js'
import { DEFAULT_OPTIONS } from '../src/settings.js'
import { ensureDir, pathExists, readTextFile } from '../src/nodefs.js'
import { listSnapshots } from '../src/restore/snapshot.js'
import { makeFakeHost } from './helpers/fake-host.js'

const SECRET = 'sk-live-abcdefghijklmnopqrstuvwx'

function makeRequest({ method = 'GET', headers = {}, body = null, remoteAddress = '127.0.0.1' } = {}) {
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

async function setup() {
  const host = await makeFakeHost({
    records: [
      {
        id: 'llm-pi-ai',
        name: '@deepseek-ai/dsh-llm-pi-ai',
        override: {
          providers: {
            xiuxian: {
              apiKeyEnv: 'XIUXIAN_API_KEY',
              apiKey: SECRET,
              api: 'openai-completions',
              baseURL: 'https://xiuxian.pro/v1',
              models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }],
            },
          },
        },
      },
      { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', override: { provider: 'deepseek-account', model: 'deepseek-flash' } },
    ],
    secretsByEntry: { 'llm-pi-ai': [{ path: ['providers', 'xiuxian', 'apiKey'], set: true }] },
    bundles: [
      { name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true },
      { name: 'dshmarket', version: '1.66.7', enabled: true, description: '可视化插件市场', patchIds: ['dsh-market'] },
    ],
    plugins: [{ entryId: 'dsh-market', moduleName: 'dshmarket', enabled: true }],
    skills: { 'skill-a': { 'SKILL.md': '# Skill A\n', 'assets/logo.bin': 'binary-content-a' } },
    credentialConfigured: [],
    packageJson: { name: 'dsh-profile-desktop', private: true, dsh: { profile: { bundles: ['dshmarket'] } }, dependencies: { dshmarket: '^1.66.7' } },
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
  mountRoutes({ ctx, tasks, logger, env: host.env })
  const call = async (suffix, options) => {
    const route = routes.find(item => item.path === `${ROUTE_PREFIX}${suffix}`)
    assert.ok(route, `路由 ${suffix} 未注册`)
    const response = makeResponse()
    await route.handler(makeRequest(options), response)
    const payload = response.state.body === '' ? null : JSON.parse(response.state.body)
    return { status: response.state.statusCode, payload }
  }
  const headers = { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }
  const waitForTask = async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const state = await call('/state', { method: 'GET', headers: { host: '127.0.0.1:19387' } })
      const task = state.payload.task
      if (task && task.finishedAt) return task
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('任务没有在预期时间内结束')
  }
  return { host, call, headers, tasks, waitForTask }
}

test('端到端（走路由）：导出（默认压成 zip）→ 预览 → 导入，并留下快照', async () => {
  const { host, call, headers, waitForTask } = await setup()
  const exportRoot = join(host.root, 'backups')
  await ensureDir(exportRoot)

  // ① 选落点（登记一次）→ 导出（不传 compress，走默认 = 压缩）
  assert.equal((await call('/pick', { method: 'POST', headers, body: { path: exportRoot } })).status, 200)
  const exportStart = await call('/export', { method: 'POST', headers, body: { options: { ...DEFAULT_OPTIONS, skillFiles: true }, targetDir: exportRoot } })
  assert.equal(exportStart.status, 202)
  const exportTask = await waitForTask()
  assert.equal(exportTask.error, null, JSON.stringify(exportTask.error))
  assert.equal(exportTask.result.direction, 'export')
  assert.equal(exportTask.result.packaging, 'zip', '默认必须压成 zip')
  assert.equal(exportTask.percent, 100, '任务成功后进度必须是 100')
  const archive = exportTask.result.dir
  assert.match(archive, /dsh-brittle-backup-\d{8}-\d{6}\.zip$/)
  assert.equal(await pathExists(archive), true)
  assert.equal(exportTask.result.unpackedDir, null, '打包成功后不留未压缩目录')

  // ② 选来源 → 只读预览（从 zip 自动解压）
  assert.equal((await call('/pick', { method: 'POST', headers, body: { path: exportRoot } })).status, 200)
  const inspect = await call('/inspect', { method: 'POST', headers, body: { sourceDir: exportRoot } })
  assert.equal(inspect.status, 200)
  assert.equal(inspect.payload.source, 'zip')
  assert.equal(inspect.payload.checks.length, 14)
  assert.equal(inspect.payload.blocked, false)
  assert.equal(await pathExists(join(inspect.payload.dir, 'backup.json')), true)
  assert.equal((await readTextFile(join(inspect.payload.dir, 'backup.json'))).includes(SECRET), false)
  assert.ok(inspect.payload.plan.some(item => item.kind === 'config' && item.action === 'merge'))
  assert.ok(inspect.payload.plan.some(item => item.kind === 'skill' && item.action === 'copy'))

  // ③ 选来源（白名单一次性，所以再登记一次）→ 导入
  assert.equal((await call('/pick', { method: 'POST', headers, body: { path: exportRoot } })).status, 200)
  const importStart = await call('/import', { method: 'POST', headers, body: { sourceDir: exportRoot, selection: { ackBuildScripts: true, overwriteSkills: ['skill-a'], overrides: { 'config:llm-pi-ai': true } } } })
  assert.equal(importStart.status, 202)
  const importTask = await waitForTask()
  assert.equal(importTask.error, null, JSON.stringify(importTask.error))
  const report = importTask.result
  assert.equal(report.direction, 'import')
  assert.equal(report.source, 'zip')
  assert.ok(report.applied.some(item => item.kind === 'config' && item.ref === 'llm-pi-ai'))
  assert.ok(report.applied.some(item => item.kind === 'file' && item.ref === 'pnpm-workspace.yaml'))
  assert.ok(report.applied.some(item => item.kind === 'skill' && item.ref === 'skill-a'))
  assert.equal(report.restartRequired, true)
  assert.ok(report.redactedSkipped.includes('/override/providers/xiuxian/apiKey'), '被剥离的密钥必须报出来且不写回')

  // 目标机原有的内联密钥没有被占位符覆盖（深度合并）
  const stored = host.store.find(item => item.entry.patchId === 'llm-pi-ai')
  assert.equal(stored.override.providers.xiuxian.apiKey, SECRET)
  assert.equal(await readTextFile(join(host.env.DSH_HOME, 'skills', 'skill-a', 'assets', 'logo.bin')), 'binary-content-a')

  // ④ 快照留下了
  assert.equal((await listSnapshots(host.env)).length >= 1, true)
})

test('端到端（走路由）：关掉压缩时落点里是未压缩目录', async () => {
  const { host, call, headers, waitForTask } = await setup()
  const exportRoot = join(host.root, 'backups-plain')
  await ensureDir(exportRoot)
  await call('/pick', { method: 'POST', headers, body: { path: exportRoot } })
  const start = await call('/export', { method: 'POST', headers, body: { options: { ...DEFAULT_OPTIONS, compress: false }, targetDir: exportRoot } })
  assert.equal(start.status, 202)
  const task = await waitForTask()
  assert.equal(task.error, null, JSON.stringify(task.error))
  assert.equal(task.result.packaging, 'dir')
  assert.equal(await pathExists(join(task.result.dir, 'backup.json')), true)
  assert.equal(await pathExists(join(task.result.dir, '兜底文档.md')), true)
  assert.equal(task.result.unpackedDir, task.result.dir)
  assert.equal((await readTextFile(join(task.result.dir, 'backup.json'))).includes(SECRET), false)
})

test('端到端（走路由）：拦截级检查项存在时，导入请求被拒绝且不建快照', async () => {
  const { host, call, headers, waitForTask } = await setup()
  const exportRoot = join(host.root, 'backups-2')
  await ensureDir(exportRoot)
  await call('/pick', { method: 'POST', headers, body: { path: exportRoot } })
  await call('/export', { method: 'POST', headers, body: { options: { ...DEFAULT_OPTIONS }, targetDir: exportRoot } })
  await waitForTask()

  // 让 agent 忙碌：换一个 host 视图即可（同一份产物）
  const busyHost = await makeFakeHost({ agentBusy: true })
  const routes = []
  const tasks = new TaskRegistry()
  const ctx = {
    get(key) {
      if (key === 'webServer') return { register: route => { routes.push(route); return () => {} } }
      return busyHost.ctx.get(key)
    },
    logger: busyHost.ctx.logger,
  }
  mountRoutes({ ctx, tasks, logger: { info: () => {}, warn: () => {}, error: () => {}, once: () => {} }, env: busyHost.env })
  const route = routes.find(item => item.path === `${ROUTE_PREFIX}/pick`)
  const pickResponse = makeResponse()
  await route.handler(makeRequest({ method: 'POST', headers, body: { path: exportRoot } }), pickResponse)
  assert.equal(pickResponse.state.statusCode, 200)

  const importRoute = routes.find(item => item.path === `${ROUTE_PREFIX}/import`)
  const response = makeResponse()
  await importRoute.handler(makeRequest({ method: 'POST', headers, body: { sourceDir: exportRoot, selection: {} } }), response)
  assert.equal(response.state.statusCode, 202)
  const state = await (async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const stateRoute = routes.find(item => item.path === `${ROUTE_PREFIX}/state`)
      const probe = makeResponse()
      await stateRoute.handler(makeRequest({ method: 'GET', headers: { host: '127.0.0.1:19387' } }), probe)
      const payload = JSON.parse(probe.state.body)
      if (payload.task && payload.task.finishedAt) return payload.task
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('任务没有结束')
  })()
  assert.equal(state.error.code, 'CHECKS_BLOCKED')
  assert.equal((await listSnapshots(busyHost.env)).length, 0, '被拦截时不该创建快照')
  assert.equal(host.records.length > 0, true)
})
