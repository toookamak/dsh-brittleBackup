/**
 * 降级提示的语义边界（缺陷 3）。
 *
 * `meta.services.*` 必须只回答"**宿主有没有**这个服务"；
 * 用户这次主动不勾 profile / skills 是**选择**，不是能力缺失，
 * 绝不能被说成"当前 DSH 版本不支持" / "服务不可用"。
 * "没勾"这件事由 collectAll 的 warnings 如实告知，与 degradation 分开。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectAll, degradationNotes } from '../src/collect/index.js'
import { DEFAULT_OPTIONS } from '../src/settings.js'
import { makeFakeHost } from './helpers/fake-host.js'

const ALL_AVAILABLE = { configEditor: true, settings: true, pluginManager: true, skills: true }

/** 假宿主里按需屏蔽某几个服务，模拟"宿主真的没提供这个能力"。 */
function withoutServices(ctx, keys) {
  return { get: key => (keys.includes(key) ? undefined : ctx.get(key)) }
}

async function fixture() {
  return makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-llm', override: { provider: 'deepseek-account', model: 'deepseek-flash' } }],
    skills: { 'example-skill': { 'SKILL.md': '---\ndescription: 示例\n---\n' } },
    bundles: [{ name: 'dshmarket', version: '1.66.7', enabled: true }],
  })
}

test('degradationNotes：四项都可用 → 一条降级提示都不出', () => {
  assert.deepEqual(degradationNotes({ services: ALL_AVAILABLE }), [])
})

test('degradationNotes：真的缺服务 → 才出对应提示', () => {
  const notes = degradationNotes({ services: { ...ALL_AVAILABLE, configEditor: false, skills: false } })
  assert.ok(notes.some(note => note.includes('configEditor 不可用')), notes.join(' | '))
  assert.ok(notes.some(note => note.includes('skills 服务不可用')), notes.join(' | '))
})

test('collectAll：用户主动不勾 profile / skills ≠ 服务不可用', async () => {
  const host = await fixture()
  const collected = await collectAll({
    ctx: host.ctx,
    env: host.env,
    options: { ...DEFAULT_OPTIONS, profile: false, skills: false },
  })
  assert.equal(collected.meta.services.configEditor, true, '不勾 profile 不代表宿主没有 configEditor')
  assert.equal(collected.meta.services.skills, true, '不勾 skills 不代表宿主没有 skills 服务')
  assert.deepEqual(degradationNotes(collected.meta), [], '用户的选择不许进 degradation 列表')
  // 但"没勾"本身必须仍然如实告知 —— 只是它在 warnings 里，不在 degradation 里。
  assert.ok(collected.warnings.some(message => message.includes('未勾选 profile 配置')), collected.warnings.join(' | '))
  assert.ok(collected.warnings.some(message => message.includes('未勾选 skills 清单')), collected.warnings.join(' | '))
  assert.equal(collected.items.config.entries.length, 0, '不勾 profile 时确实不采条目（这是选择生效，不是降级）')
  assert.equal(collected.items.skills.length, 0)
})

test('collectAll：宿主真的没有 skills 服务 → 才提示降级', async () => {
  const host = await fixture()
  const collected = await collectAll({ ctx: withoutServices(host.ctx, ['skills']), env: host.env, options: DEFAULT_OPTIONS })
  assert.equal(collected.meta.services.skills, false)
  assert.ok(degradationNotes(collected.meta).some(note => note.includes('skills 服务不可用')))
  // 服务不可用时 skills 元数据退回目录扫描，这部分仍然采得到。
  assert.equal(collected.items.skills.length, 1)
})

test('collectAll：宿主真的没有 configEditor 服务 → 才提示降级', async () => {
  const host = await fixture()
  const collected = await collectAll({ ctx: withoutServices(host.ctx, ['configEditor']), env: host.env, options: DEFAULT_OPTIONS })
  assert.equal(collected.meta.services.configEditor, false)
  assert.ok(degradationNotes(collected.meta).some(note => note.includes('configEditor 不可用')))
})

test('degradationNotes：services 缺项按"不可用"算，不抛（老契约：缺项即缺能力）', () => {
  assert.equal(degradationNotes({}).length, 4)
  assert.deepEqual(degradationNotes(undefined), degradationNotes({}))
})
