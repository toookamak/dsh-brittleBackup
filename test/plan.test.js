import test from 'node:test'
import assert from 'node:assert/strict'
import { gatherHostState } from '../src/restore/host.js'
import { buildPlan, planSummary, writeTargets } from '../src/restore/plan.js'
import { runChecks } from '../src/restore/checks.js'
import { makeFakeHost } from './helpers/fake-host.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

async function planFor({ artifact = sampleArtifact(), hostOptions = {}, selection = null } = {}) {
  const host = await makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: {} } }],
    bundles: [{ name: 'dshmarket', version: '1.66.7', enabled: true }],
    ...hostOptions,
  })
  const state = await gatherHostState({ ctx: host.ctx, env: host.env })
  return { host, plan: buildPlan({ artifact, host: state, selection }) }
}

const find = (plan, kind, ref) => plan.find(item => item.kind === kind && item.ref === ref)

test('计划：值不同的配置条目默认**不写**，显式勾选才覆盖（FORMAT.md §2 / PROJECT-PLAN §7）', async () => {
  const artifact = sampleArtifact()
  const { plan } = await planFor({ artifact })
  const merge = find(plan, 'config', 'llm-pi-ai')
  assert.equal(merge.action, 'merge')
  // 目标机是 {providers:{}}，备份里有一整个 provider → 值不同 → 默认保留目标机。
  assert.equal(merge.selected, false, '值不同时默认不勾选，不能静默覆盖目标机配置')
  assert.equal(merge.level, 'warn')
  assert.match(merge.reason, /默认保留目标机/)
  assert.ok(Array.isArray(merge.diff))

  // 用户在预览里显式勾上 → 才覆盖
  const opted = await planFor({ artifact, selection: { overrides: { 'config:llm-pi-ai': true } } })
  assert.equal(find(opted.plan, 'config', 'llm-pi-ai').selected, true)

  // 显式取消也压得住默认开启的项
  const cancelled = await planFor({ artifact, selection: { overrides: { 'config:llm-pi-ai': false } } })
  assert.equal(find(cancelled.plan, 'config', 'llm-pi-ai').selected, false)

  const manual = find(plan, 'config', 'agent-default-model')
  assert.equal(manual.action, 'manual')
  assert.equal(manual.selected, false)
})

test('计划：拦截级检查项把命中的计划项降级为手工，不能写盘', async () => {
  const artifact = sampleArtifact({
    plugins: [{ name: 'dsh-bad', spec: '^1.0.0', resolvedVersion: '1.0.0', source: 'registry', commit: null, bundle: true, enabled: true, description: '', installCommand: 'dsh plugin add dsh-bad@1.0.0', unportable: false }],
  })
  const host = await makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: {} } }],
    bundles: [{ name: 'dsh-bad', version: '0.9.0', enabled: true, patchIds: ['dsh-bad'], peers: {} }],
  })
  const state = await gatherHostState({ ctx: host.ctx, env: host.env })
  const checks = await runChecks({ artifact, host: state, ctx: host.ctx })
  // 造一个"peer 不兼容"的拦截结论
  checks.blockedItems.push({ ref: 'dsh-bad', reason: '声明 ^1.0.0，当前 0.2.0-rc.2', target: { kind: 'plugin', ref: 'dsh-bad' }, level: 'block' })
  const plan = buildPlan({ artifact, host: state, checks, selection: { overrides: { 'plugin:dsh-bad': true } } })

  const entry = find(plan, 'plugin', 'dsh-bad')
  assert.equal(entry.action, 'manual', '被拦截的项不能仍然是 install')
  assert.equal(entry.level, 'block')
  assert.equal(entry.selected, false, '即使界面勾了也不该写')
  assert.match(entry.reason, /拦截级检查项/)
  assert.ok(!writeTargets(plan).some(item => item.ref === 'dsh-bad'), '拦截项不得进入写盘目标')
})

test('计划：pnpm-workspace 必须显式确认才写入', async () => {
  const { plan } = await planFor()
  const pending = find(plan, 'file', 'pnpm-workspace.yaml')
  assert.equal(pending.action, 'confirm')
  assert.equal(pending.selected, false)
  assert.equal(pending.requiresConfirm, true)

  const confirmed = await planFor({ selection: { ackBuildScripts: true } })
  const write = find(confirmed.plan, 'file', 'pnpm-workspace.yaml')
  assert.equal(write.action, 'write')
  assert.equal(write.selected, true)
})

test('计划：插件未装 → 安装；已装同版本 → 保留；版本不同默认保留，勾选才覆盖', async () => {
  const missing = await planFor({ artifact: sampleArtifact({ plugins: [{ name: 'dsh-context', spec: '^0.62.2', resolvedVersion: '0.62.2', source: 'registry', commit: null, bundle: true, enabled: true, description: '', installCommand: 'dsh plugin add dsh-context@0.62.2', unportable: false }] }) })
  assert.equal(find(missing.plan, 'plugin', 'dsh-context').action, 'install')
  assert.equal(find(missing.plan, 'plugin', 'dsh-context').selected, true)

  const same = await planFor()
  assert.equal(find(same.plan, 'plugin', 'dshmarket').action, 'keep')
  assert.equal(find(same.plan, 'plugin', 'dshmarket').selected, false)

  const differing = await planFor({ artifact: sampleArtifact({ plugins: [{ name: 'dshmarket', spec: '^1.66.6', resolvedVersion: '1.66.6', source: 'registry', commit: null, bundle: true, enabled: true, description: '', installCommand: 'dsh plugin add dshmarket@1.66.6', unportable: false }] }) })
  const keep = find(differing.plan, 'plugin', 'dshmarket')
  assert.equal(keep.action, 'keep')
  assert.equal(keep.selected, false)

  const overwrite = await planFor({
    artifact: sampleArtifact({ plugins: [{ name: 'dshmarket', spec: '^1.66.6', resolvedVersion: '1.66.6', source: 'registry', commit: null, bundle: true, enabled: true, description: '', installCommand: 'dsh plugin add dshmarket@1.66.6', unportable: false }] }),
    selection: { overwritePlugins: ['dshmarket'] },
  })
  assert.equal(find(overwrite.plan, 'plugin', 'dshmarket').action, 'install')
  assert.equal(find(overwrite.plan, 'plugin', 'dshmarket').selected, true)
})

test('计划：禁用状态需要对齐（enable / disable）', async () => {
  const artifact = sampleArtifact({ plugins: [{ name: 'dshmarket', spec: '^1.66.7', resolvedVersion: '1.66.7', source: 'registry', commit: null, bundle: true, enabled: false, description: '', installCommand: 'dsh plugin add dshmarket@1.66.7', unportable: false }] })
  const { plan } = await planFor({ artifact })
  const disable = find(plan, 'plugin', 'dshmarket')
  assert.equal(disable.action, 'disable')
  assert.equal(disable.selected, true)

  const enable = await planFor({ hostOptions: { bundles: [{ name: 'dshmarket', version: '1.66.7', enabled: false }] } })
  assert.equal(find(enable.plan, 'plugin', 'dshmarket').action, 'enable')
})

test('计划：skills 同名默认跳过，勾选覆盖才写；没带文件只核对', async () => {
  const included = sampleArtifact({ skills: [{ name: 'example-skill', description: 'd', path: 'skills/example-skill', scope: 'user', files: 1, included: true }] })
  const clash = await planFor({ artifact: included, hostOptions: { skills: { 'example-skill': { 'SKILL.md': '# x' } } } })
  const skip = find(clash.plan, 'skill', 'example-skill')
  assert.equal(skip.action, 'copy')
  assert.equal(skip.selected, false)

  const overwrite = await planFor({ artifact: included, hostOptions: { skills: { 'example-skill': { 'SKILL.md': '# x' } } }, selection: { overwriteSkills: ['example-skill'] } })
  assert.equal(find(overwrite.plan, 'skill', 'example-skill').selected, true)

  const fresh = await planFor({ artifact: included })
  assert.equal(find(fresh.plan, 'skill', 'example-skill').selected, true)

  const listing = await planFor()
  const verify = find(listing.plan, 'skill', 'example-skill')
  assert.equal(verify.action, 'verify')
  assert.equal(verify.selected, false)
})

test('计划：汇总与"真正写盘的目标"只包含勾选项', async () => {
  // 默认不勾配置条目（值不同 → 保留目标机），所以配置不进写盘目标
  const untouched = await planFor({ selection: { ackBuildScripts: true } })
  const untouchedTargets = writeTargets(untouched.plan)
  assert.ok(!untouchedTargets.some(item => item.kind === 'config'), '未显式勾选的配置条目不得进写盘目标')
  assert.ok(untouchedTargets.some(item => item.kind === 'file'))

  const { plan } = await planFor({ selection: { ackBuildScripts: true, overrides: { 'config:llm-pi-ai': true } } })
  const summary = planSummary(plan)
  assert.equal(summary.total, plan.length)
  assert.ok(summary.selected >= 2)

  const targets = writeTargets(plan)
  assert.ok(targets.every(item => item.selected === true))
  assert.ok(targets.some(item => item.kind === 'config'))
  assert.ok(targets.some(item => item.kind === 'file'))
})

test('计划：凭据项只报告，永不勾选', async () => {
  const { plan } = await planFor()
  const credential = find(plan, 'credential', 'XIUXIAN_API_KEY')
  assert.equal(credential.action, 'report')
  assert.equal(credential.selected, false)
})
