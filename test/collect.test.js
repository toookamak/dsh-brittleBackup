import test from 'node:test'
import assert from 'node:assert/strict'
import { collectAll } from '../src/collect/index.js'
import { DEFAULT_OPTIONS } from '../src/settings.js'
import { makeFakeHost } from './helpers/fake-host.js'

function options(patch = {}) {
  return { ...DEFAULT_OPTIONS, ...patch }
}

async function host(extra = {}) {
  return await makeFakeHost({
    records: [
      { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: { xiuxian: { apiKeyEnv: 'XIUXIAN_API_KEY', models: [{ id: 'gpt-6-luna' }] } } } },
      { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', override: { provider: 'deepseek-account', model: 'deepseek-flash' } },
      // 没有任何 override 的条目：U36 要求不收进产物
      { id: 'ui-chat', name: '@deepseek-ai/dsh-client-ui-chat', override: {} },
    ],
    secretsByEntry: { 'llm-pi-ai': [{ path: ['providers', 'xiuxian', 'apiKey'], set: false }] },
    bundles: [
      { name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true },
      { name: 'dshmarket', version: '1.66.7', enabled: true, description: '市场', patchIds: ['dsh-market'] },
    ],
    skills: { 'example-skill': { 'SKILL.md': '---\ndescription: 示例 skill\n---\n' } },
    packageJson: { name: 'p', private: true, dsh: { profile: { bundles: ['dshmarket'] } }, dependencies: { dshmarket: '^1.66.7' } },
    lock: '  dshmarket@1.66.7:\n    resolution: {integrity: sha512-x}\n',
    ...extra,
  })
}

test('采集：只收录有 override 的 patch 目标条目，id 用 patchId', async () => {
  const fake = await host()
  const collected = await collectAll({ ctx: fake.ctx, env: fake.env, options: options() })
  const ids = collected.items.config.entries.map(entry => entry.id)
  assert.deepEqual(ids.sort(), ['agent-default-model', 'llm-pi-ai'])
  assert.equal(ids.includes('ui-chat'), false, '空 override 的条目不能进产物')
})

test('采集：插件清单带 enabled / source / 安装命令，git commit 来自 lockfile', async () => {
  const fake = await host({
    lock: '  dshmarket@github:foo/bar#abc:\n    resolution: {tarball: x, commit: 0123456789abcdef0123456789abcdef01234567}\n',
    packageJson: {
      name: 'p',
      private: true,
      dsh: { profile: { bundles: ['dshmarket'] } },
      dependencies: { dshmarket: '^1.66.7', 'remote-plugin': 'github:foo/bar#abc' },
    },
  })
  const collected = await collectAll({ ctx: fake.ctx, env: fake.env, options: options() })
  const plugin = collected.items.plugins.find(item => item.name === 'dshmarket')
  assert.equal(plugin.enabled, true)
  assert.equal(plugin.source, 'registry')
  assert.equal(plugin.resolvedVersion, '1.66.7')
  assert.equal(plugin.description, '市场')
  assert.equal(plugin.installCommand, 'dsh plugin add dshmarket@1.66.7')

  const remote = collected.items.plugins.find(item => item.name === 'remote-plugin')
  assert.equal(remote.source, 'github')
  assert.equal(remote.installCommand, 'dsh plugin add github:foo/bar#abc')

  assert.equal(collected.producer.dshVersion, '0.2.0-rc.2')
  assert.equal(collected.items.defaultModel.model, 'deepseek-flash')
  assert.deepEqual(collected.items.requiredCredentials, ['XIUXIAN_API_KEY'])
})

test('采集：本地路径依赖被标记 unportable', async () => {
  const fake = await host({
    packageJson: {
      name: 'p',
      private: true,
      dsh: { profile: { bundles: [] } },
      dependencies: { 'local-plugin': 'link:F:\\Git\\local-plugin' },
    },
  })
  const collected = await collectAll({ ctx: fake.ctx, env: fake.env, options: options() })
  const plugin = collected.items.plugins[0]
  assert.equal(plugin.source, 'local-path')
  assert.equal(plugin.unportable, true)
  assert.equal(plugin.installCommand, 'dsh plugin add link:F:\\Git\\local-plugin')
})

test('采集：勾选项关掉的内容确实不进产物', async () => {
  const fake = await host()
  const collected = await collectAll({
    ctx: fake.ctx,
    env: fake.env,
    options: options({ profile: false, plugins: false, models: false, skills: false }),
  })
  assert.deepEqual(collected.items.config.entries, [])
  assert.deepEqual(collected.items.files, [])
  assert.deepEqual(collected.items.plugins, [])
  assert.deepEqual(collected.items.models, [])
  assert.equal(collected.items.defaultModel, null)
  assert.deepEqual(collected.items.skills, [])
  assert.ok(collected.warnings.some(message => message.includes('未勾选 profile 配置')))
})

test('采集：skills 服务不给描述时回退到 SKILL.md front matter，文件数正确', async () => {
  const fake = await host({ skills: { alpha: { 'SKILL.md': '---\ndescription: 甲\n---\n', 'assets/a.bin': 'x', 'notes/b.md': 'y' } } })
  const ctx = {
    get(key) {
      if (key === 'skills') return { list: async () => [{ name: 'alpha' }] }
      return fake.ctx.get(key)
    },
  }
  const collected = await collectAll({ ctx, env: fake.env, options: options() })
  const skill = collected.items.skills.find(item => item.name === 'alpha')
  assert.equal(skill.description, '甲')
  assert.equal(skill.files, 3)
  assert.equal(skill.scope, 'user')
  assert.equal(skill.path, 'skills/alpha')
})

test('降级：configEditor / settings 不可用时，条目不采集但其余照常，且不抛错', async () => {
  const fake = await host()
  const ctx = {
    get(key) {
      if (key === 'configEditor' || key === 'settings') return undefined
      return fake.ctx.get(key)
    },
  }
  const collected = await collectAll({ ctx, env: fake.env, options: options() })
  assert.deepEqual(collected.items.config.entries, [])
  assert.equal(collected.items.config.source, 'unavailable')
  assert.equal(collected.items.files.length >= 1, true, 'package.json / pnpm-workspace.yaml 仍然要采集')
  assert.equal(collected.items.plugins.length, 1, '插件清单不受影响')
  assert.ok(collected.warnings.some(message => message.includes('configEditor')))
})

test('降级：插件管理不可用时只记录清单并警告', async () => {
  const fake = await host()
  const ctx = { get: key => (key === 'pluginManager' ? undefined : fake.ctx.get(key)) }
  const collected = await collectAll({ ctx, env: fake.env, options: options() })
  assert.equal(collected.items.plugins.length, 1)
  assert.equal(collected.meta.services.pluginManager, false)
  assert.ok(collected.warnings.some(message => message.includes('插件管理不可用')))
})

test('硬失败：读不到 package.json 时导出中止（唯一硬失败）', async () => {
  const fake = await host()
  const ctx = {
    get(key) {
      if (key === 'fs') return undefined
      return fake.ctx.get(key)
    },
  }
  const { rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  await rm(join(fake.env.DSH_PROFILE_DIR, 'package.json'))
  await assert.rejects(
    () => collectAll({ ctx, env: fake.env, options: options() }),
    error => error?.code === 'PACKAGE_JSON_MISSING',
  )
})
