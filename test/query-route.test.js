import test from 'node:test'
import assert from 'node:assert/strict'
import { mountRoutes, ROUTE_PREFIX } from '../src/routes.js'
import { TaskRegistry } from '../src/task.js'
import { makeFakeHost } from './helpers/fake-host.js'
import { writeArtifact } from '../src/artifact.js'
import { sampleArtifact } from './helpers/sample-artifact.js'
import { ensureDir } from '../src/nodefs.js'

function request(body) {
  return { method: 'POST', headers: { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }
}
function response() {
  const state = { statusCode: 200, body: '' }
  return { state, writeHead(status) { state.statusCode = status }, end(body) { state.body += body ?? '' } }
}

test('路由 /query：返回安全摘要或脱敏详细文本，不写用户文件', async () => {
  const host = await makeFakeHost({ records: [{ id: 'entry-a', override: { apiKey: 'sk-live-abcdefghijklmnopqrstuvwx', apiKeyEnv: 'A_KEY' } }] })
  const sourceRoot = `${host.root}\\query-source`
  await ensureDir(sourceRoot)
  const written = await writeArtifact({ targetRoot: sourceRoot, artifact: sampleArtifact(), options: sampleArtifact().options })
  const routes = []
  const ctx = { get(key) { if (key === 'webServer') return { register: route => { routes.push(route); return () => {} } }; return host.ctx.get(key) }, logger: host.ctx.logger }
  mountRoutes({ ctx, tasks: new TaskRegistry(), logger: { info() {}, warn() {}, error() {}, once() {} }, env: host.env })
  const pick = routes.find(item => item.path === `${ROUTE_PREFIX}/pick`)
  const pickOutput = response()
  await pick.handler(request({ path: written.dir }), pickOutput)
  assert.equal(pickOutput.state.statusCode, 200)
  const route = routes.find(item => item.path === `${ROUTE_PREFIX}/query`)
  assert.ok(route)
  const output = response()
  await route.handler(request({ sourceDir: written.dir, detail: true }), output)
  assert.equal(output.state.statusCode, 200)
  const payload = JSON.parse(output.state.body)
  assert.equal(payload.ok, true)
  assert.match(payload.text, /XIUXIAN_API_KEY/)
  assert.equal(payload.text.includes('sk-live-abcdefghijklmnopqrstuvwx'), false)
})
