import test from 'node:test'
import assert from 'node:assert/strict'
import { gatherHostState } from '../src/restore/host.js'
import { runChecks } from '../src/restore/checks.js'
import { makeFakeHost } from './helpers/fake-host.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

const BASE_RECORDS = [
  { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: { xiuxian: { apiKeyEnv: 'XIUXIAN_API_KEY' } } } },
]

async function check(options = {}) {
  const host = await makeFakeHost({
    records: BASE_RECORDS,
    secretsByEntry: { 'llm-pi-ai': [{ path: ['providers', 'xiuxian', 'apiKey'], set: true }] },
    bundles: [{ name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true }],
    credentialConfigured: [],
    ...options,
  })
  const state = await gatherHostState({ ctx: host.ctx, env: host.env })
  const artifact = options.artifact ?? sampleArtifact()
  const result = await runChecks({ artifact, host: state, ctx: host.ctx })
  return { host, state, result }
}

test('§7：14 项检查全部产出，级别字段合法', async () => {
  const { result } = await check()
  assert.equal(result.checks.length, 14)
  assert.deepEqual(result.checks.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  for (const item of result.checks) {
    assert.ok(['block', 'warn', 'info'].includes(item.level), `${item.key} 级别非法`)
    assert.ok(typeof item.detail === 'string' && item.detail !== '')
  }
  assert.equal(result.blocked, false)
})

test('§7-#3：DSH 版本不同 → 警告（不阻断）', async () => {
  const { result } = await check({ artifact: sampleArtifact({ producer: { dshVersion: '0.1.7' } }) })
  const check3 = result.checks.find(item => item.id === 3)
  assert.equal(check3.level, 'warn')
  assert.equal(check3.verdict, 'warning')
  assert.equal(result.blocked, false)
})

test('§7-#5：本地路径依赖 → 该项拦截', async () => {
  const artifact = sampleArtifact({
    plugins: [{
      name: 'local-plugin', spec: 'link:F:\\Git\\local-plugin', resolvedVersion: null, source: 'local-path',
      commit: null, bundle: false, enabled: true, description: '', installCommand: 'dsh plugin add link:F:\\Git\\local-plugin', unportable: true,
    }],
  })
  const { result } = await check({ artifact })
  const check5 = result.checks.find(item => item.id === 5)
  assert.equal(check5.verdict, 'blocked')
  assert.equal(check5.items.length, 1)
  assert.equal(result.blockedItems.length >= 1, true)
})

test('§7-#9：同名 skill 且勾选了文件 → 警告项', async () => {
  const artifact = sampleArtifact({ skills: [{ name: 'example-skill', description: '示例', path: 'skills/example-skill', scope: 'user', files: 1, included: true }] })
  const { result } = await check({ artifact, skills: { 'example-skill': { 'SKILL.md': '# x' } } })
  const check9 = result.checks.find(item => item.id === 9)
  assert.equal(check9.verdict, 'warning')
  assert.equal(check9.items[0].level, 'warn')
})

test('§7-#12：同 id 条目值不同 → 警告并给出 diff', async () => {
  const artifact = sampleArtifact({
    entries: [{
      id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai',
      override: { providers: { xiuxian: { apiKeyEnv: 'XIUXIAN_API_KEY', baseURL: 'https://other.example/v1' } } },
      inherited: {}, secrets: [], redactions: [],
    }],
  })
  const { result } = await check({ artifact })
  const check12 = result.checks.find(item => item.id === 12)
  assert.equal(check12.verdict, 'warning')
  assert.equal(check12.items.length, 1)
  assert.ok(check12.items[0].diff.length > 0, '应当给出 diff')
})

test('§7-#13：agent 忙碌 → 全局拦截；服务缺失 → fail-open', async () => {
  const busy = await check({ agentBusy: true })
  assert.equal(busy.result.blocked, true)
  assert.equal(busy.result.checks.find(item => item.id === 13).verdict, 'blocked')
  assert.ok(busy.result.blockedGlobal.some(item => item.id === 13))

  const noAgents = await makeFakeHost({ records: BASE_RECORDS })
  const ctxWithoutAgents = { get: key => (key === 'agents' ? undefined : noAgents.ctx.get(key)) }
  const state = await gatherHostState({ ctx: ctxWithoutAgents, env: noAgents.env })
  assert.equal(state.agentBusy, null)
  const result = await runChecks({ artifact: sampleArtifact(), host: state, ctx: ctxWithoutAgents })
  assert.equal(result.checks.find(item => item.id === 13).verdict, 'ok')
  assert.equal(result.blocked, false)
})

test('§7-#14：缺 key 只报名字，不读值', async () => {
  const { result } = await check({ credentialConfigured: [] })
  const check14 = result.checks.find(item => item.id === 14)
  assert.ok(check14.detail.includes('XIUXIAN_API_KEY'))
  assert.equal(check14.items[0].state, 'missing')

  const configured = await check({ credentialConfigured: ['XIUXIAN_API_KEY'] })
  assert.equal(configured.result.checks.find(item => item.id === 14).items[0].state, 'configured')
})

test('§7-#8：pluginManager 不可用 → 警告并降级', async () => {
  const host = await makeFakeHost({ records: BASE_RECORDS })
  const ctxWithoutManager = { get: key => (key === 'pluginManager' ? undefined : host.ctx.get(key)) }
  const state = await gatherHostState({ ctx: ctxWithoutManager, env: host.env })
  const result = await runChecks({ artifact: sampleArtifact(), host: state, ctx: ctxWithoutManager })
  const check8 = result.checks.find(item => item.id === 8)
  assert.equal(check8.verdict, 'warning')
  assert.ok(check8.detail.includes('降级'))
})
