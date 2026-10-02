import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DEFAULT_OPTIONS } from '../src/settings.js'
import { runExport } from '../src/export.js'
import { inspectImport, runImport } from '../src/restore/import.js'
import { listSnapshots } from '../src/restore/snapshot.js'
import { ensureDir, listTree, pathExists, readTextFile } from '../src/nodefs.js'
import { TaskRegistry } from '../src/task.js'
import { makeFakeHost } from './helpers/fake-host.js'

const SECRET = 'sk-live-abcdefghijklmnopqrstuvwx'
const PATCH = [
  '# user patch',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      xiuxian:',
  '        apiKeyEnv: XIUXIAN_API_KEY',
  '',
].join('\n')

const SKILLS = {
  'skill-a': { 'SKILL.md': '# Skill A\n', 'assets/logo.bin': 'binary-content-a' },
  'skill-b': { 'SKILL.md': '# Skill B\n' },
}

function hostOptions(extra = {}) {
  return {
    records: [{
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      override: {
        providers: {
          xiuxian: {
            apiKeyEnv: 'XIUXIAN_API_KEY',
            apiKey: SECRET,
            baseURL: 'https://xiuxian.pro/v1',
            models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }],
          },
        },
      },
    }],
    secretsByEntry: { 'llm-pi-ai': [{ path: ['providers', 'xiuxian', 'apiKey'], set: true }] },
    bundles: [
      { name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true },
      { name: 'dshmarket', version: '1.66.7', enabled: true, description: '可视化插件市场', patchIds: ['dsh-market'] },
    ],
    plugins: [{ entryId: 'dsh-market', moduleName: 'dshmarket', enabled: true }],
    skills: SKILLS,
    credentialConfigured: ['XIUXIAN_API_KEY'],
    packageJson: { name: 'dsh-profile-desktop', private: true, dsh: { profile: { bundles: ['dshmarket'] } }, dependencies: { dshmarket: '^1.66.7' } },
    patch: PATCH,
    ...extra,
  }
}

async function exportFrom(host, exportRoot, options = {}) {
  await ensureDir(exportRoot)
  return await runExport({
    ctx: host.ctx,
    env: host.env,
    targetDir: exportRoot,
    options: { ...DEFAULT_OPTIONS, skillFiles: true, ...options },
  })
}

test('端到端：导出产物结构正确、零密钥、redactions 与实际剥离一致', async () => {
  const host = await makeFakeHost(hostOptions())
  const exportRoot = join(host.root, 'backups')
  const report = await exportFrom(host, exportRoot)

  const backupPath = join(report.dir, 'backup.json')
  assert.equal(await pathExists(backupPath), true)
  assert.equal(await pathExists(join(report.dir, '兜底文档.md')), true)
  assert.equal(await pathExists(join(report.dir, 'skills', 'skill-a', 'SKILL.md')), true)
  assert.equal(await pathExists(join(report.dir, 'skills', 'skill-a', 'assets', 'logo.bin')), true)

  const backupText = await readTextFile(backupPath)
  assert.equal(backupText.includes(SECRET), false, '产物里不能出现密钥值')
  assert.equal(await readTextFile(join(report.dir, '兜底文档.md')).then(text => text.includes(SECRET)), false)

  const artifact = JSON.parse(backupText)
  const entry = artifact.items.config.entries.find(item => item.id === 'llm-pi-ai')
  assert.equal(entry.override.providers.xiuxian.apiKey, '<REDACTED>')
  assert.equal(entry.override.providers.xiuxian.apiKeyEnv, 'XIUXIAN_API_KEY', '名字指针不能被剥离')
  assert.equal(entry.redactions.length >= 1, true)
  assert.equal(entry.redactions[0].pointer, '/override/providers/xiuxian/apiKey')
  assert.equal(artifact.items.redactions.length, entry.redactions.length, 'redactions[] 必须与实际剥离一致')

  assert.equal(artifact.producer.hostname.length > 0, true)
  assert.equal(artifact.producer.dshVersion, '0.2.0-rc.2')
  assert.equal(artifact.items.plugins[0].enabled, true)
  assert.equal(artifact.options.skillFiles, true)
  assert.equal(artifact.items.skills.every(skill => skill.included === true), true)

  // 兜底文档必须可单独分享：没有主机名、没有本机路径
  const doc = await readTextFile(join(report.dir, '兜底文档.md'))
  assert.equal(doc.includes(artifact.producer.hostname), false)
  assert.equal(doc.includes(host.env.DSH_HOME), false)
  assert.equal(doc.includes('dsh plugin add dshmarket@1.66.7'), true)
})

test('端到端：预览阶段只读（校验 / 14 项 / diff 都不写盘）', async () => {
  const source = await makeFakeHost(hostOptions())
  const exportRoot = join(source.root, 'backups')
  await exportFrom(source, exportRoot)

  const target = await makeFakeHost(hostOptions({ skills: {} }))
  const before = await listTree(target.env.DSH_HOME)
  const inspected = await inspectImport({ ctx: target.ctx, env: target.env, sourceDir: exportRoot })
  const after = await listTree(target.env.DSH_HOME)

  assert.equal(inspected.ok, true, inspected.reason)
  assert.equal(inspected.checks.length, 14)
  assert.deepEqual(after, before, '预览不得产生任何文件变化')
  assert.ok(inspected.plan.some(item => item.kind === 'config' && item.action === 'merge'))
  assert.ok(inspected.plan.some(item => item.kind === 'skill' && item.action === 'copy'))
})

test('端到端：导入把配置合并写回、把 skills 目录树逐字节复制', async () => {
  const source = await makeFakeHost(hostOptions())
  const exportRoot = join(source.root, 'backups')
  await exportFrom(source, exportRoot)

  const target = await makeFakeHost(hostOptions({ skills: {} }))
  const report = await runImport({
    ctx: target.ctx,
    env: target.env,
    sourceDir: exportRoot,
    selection: { ackBuildScripts: true },
    task: null,
  })

  assert.ok(report.applied.some(item => item.kind === 'config' && item.ref === 'llm-pi-ai'))
  assert.ok(report.applied.some(item => item.kind === 'file' && item.ref === 'pnpm-workspace.yaml'))
  assert.ok(report.applied.some(item => item.kind === 'skill' && item.ref === 'skill-a'))
  assert.equal(report.restartRequired, true)
  assert.deepEqual(report.missingCredentials, [])

  // 合并语义：产物里被剥离的密钥**不写回**（不能把占位符当值），目标机独有键不丢
  const stored = target.store.find(item => item.entry.patchId === 'llm-pi-ai')
  assert.equal(stored.override.providers.xiuxian.apiKeyEnv, 'XIUXIAN_API_KEY')
  assert.equal(stored.override.providers.xiuxian.apiKey, SECRET, '被剥离的密钥不能用占位符覆盖目标机')
  assert.ok(report.redactedSkipped.includes('/override/providers/xiuxian/apiKey'), '必须报出被跳过的剥离位置')

  // skills 逐字节一致（含子目录）
  const copied = await readTextFile(join(target.env.DSH_HOME, 'skills', 'skill-a', 'assets', 'logo.bin'))
  assert.equal(copied, 'binary-content-a')

  // 快照存在，且 profile patch 被列入快照目标
  const snapshots = await listSnapshots(target.env)
  assert.equal(snapshots.length >= 1, true)
})

test('端到端：同名 skill 默认跳过，显式覆盖才写', async () => {
  const source = await makeFakeHost(hostOptions())
  const exportRoot = join(source.root, 'backups')
  await exportFrom(source, exportRoot)

  const target = await makeFakeHost(hostOptions())
  const planReport = await inspectImport({ ctx: target.ctx, env: target.env, sourceDir: exportRoot })
  const skillItem = planReport.plan.find(item => item.kind === 'skill' && item.ref === 'skill-a')
  assert.equal(skillItem.action, 'copy')
  assert.equal(skillItem.selected, false, '同名且未勾选覆盖时不得写入')

  const report = await runImport({ ctx: target.ctx, env: target.env, sourceDir: exportRoot, selection: { overwriteSkills: ['skill-a', 'skill-b'] } })
  assert.ok(report.applied.some(item => item.kind === 'skill' && item.ref === 'skill-a'))
})

test('端到端：取消导入 → 回滚，且删除本次新建的 skill 目录', async () => {
  const source = await makeFakeHost(hostOptions())
  const exportRoot = join(source.root, 'backups')
  await exportFrom(source, exportRoot)

  const target = await makeFakeHost(hostOptions({ skills: {} }))
  const registry = new TaskRegistry()
  const task = registry.begin('import')
  let calls = 0
  const original = task.throwIfCanceled
  task.throwIfCanceled = () => {
    calls += 1
    if (calls >= 3) task.cancel('测试取消')
    return original()
  }

  await assert.rejects(
    () => runImport({ ctx: target.ctx, env: target.env, sourceDir: exportRoot, selection: { ackBuildScripts: true }, task }),
    error => error?.code === 'CANCELED',
  )

  assert.equal(await pathExists(join(target.env.DSH_HOME, 'skills', 'skill-a')), false, '取消后本次新建的 skill 目录必须被删除')
  assert.equal(await readTextFile(join(target.env.DSH_PROFILE_DIR, 'cordis.patch.yml')), PATCH, 'profile patch 必须回到操作前')
})

test('端到端：agent 忙碌时拒绝写入（且不建快照）', async () => {
  const source = await makeFakeHost(hostOptions())
  const exportRoot = join(source.root, 'backups')
  await exportFrom(source, exportRoot)

  const target = await makeFakeHost(hostOptions({ agentBusy: true }))
  await assert.rejects(
    () => runImport({ ctx: target.ctx, env: target.env, sourceDir: exportRoot, selection: { ackBuildScripts: true } }),
    error => error?.code === 'CHECKS_BLOCKED',
  )
  assert.equal((await listSnapshots(target.env)).length, 0, '被拦截时不应该创建快照')
})
