import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../src/index.js'
import { ROUTE_PREFIX } from '../src/routes.js'

test('插件入口：导出的是 cordis 需要的 name + apply', () => {
  assert.equal(name, 'brittle-backup')
  assert.equal(typeof apply, 'function')
})

test('插件入口：只挂路由，不做别的事；没有任何服务也不抛错', () => {
  const routes = []
  const ctx = {
    get: key => (key === 'webServer' ? { register: route => { routes.push(route); return () => {} } } : undefined),
    logger: () => ({}),
    inject: (names, callback) => callback(ctx),
    effect: callback => callback(),
  }
  assert.doesNotThrow(() => apply(ctx, undefined))
  assert.equal(routes.length, 6)
  assert.ok(routes.every(route => route.path.startsWith(ROUTE_PREFIX)))

  const bare = {
    get: () => undefined,
    logger: () => ({}),
    inject: () => {},
    effect: callback => callback(),
  }
  assert.doesNotThrow(() => apply(bare, undefined), 'loader 阶段不能因为服务缺失而抛错')
})

test('插件入口：不向模型注册工具，也不注册聊天命令（U24 / D4）', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  assert.equal(source.includes("register('tools'"), false)
  assert.equal(source.includes('commands'), false)
})
