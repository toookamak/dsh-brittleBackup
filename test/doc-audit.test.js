/**
 * M3 的自动化"盲测"：真实导出一次 → 用 scripts/doc-audit.mjs 审这份兜底文档。
 * 只要文档缺一项重配所需的信息，这个用例就会失败。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { runExport } from '../src/export.js'
import { DEFAULT_OPTIONS } from '../src/settings.js'
import { ensureDir } from '../src/nodefs.js'
import { makeFakeHost } from './helpers/fake-host.js'

const SECRET = 'sk-live-abcdefghijklmnopqrstuvwx'

async function exportFixture() {
  const host = await makeFakeHost({
    records: [
      {
        id: 'llm-pi-ai',
        name: '@deepseek-ai/dsh-llm-pi-ai',
        override: {
          providers: {
            xiuxian: {
              displayName: '修仙',
              apiKeyEnv: 'XIUXIAN_API_KEY',
              api: 'openai-completions',
              baseURL: 'https://xiuxian.pro/v1',
              apiKey: SECRET,
              models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 1000000, maxTokens: 256000, input: ['text', 'image'] }],
            },
            mplan: { displayName: 'minimax', apiKeyEnv: 'MPLAN_API_KEY', api: 'openai-completions', baseURL: 'https://api.minimax.cn/v1', models: [{ id: 'MiniMax-M3' }] },
          },
        },
      },
      { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', override: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' } },
    ],
    secretsByEntry: { 'llm-pi-ai': [{ path: ['providers', 'xiuxian', 'apiKey'], set: true }] },
    bundles: [
      { name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true },
      { name: 'dshmarket', version: '1.66.7', enabled: true, description: '可视化插件市场', patchIds: ['dsh-market'] },
    ],
    skills: { 'example-skill': { 'SKILL.md': '---\ndescription: 示例 skill\n---\n' } },
    credentialConfigured: [],
    packageJson: { name: 'p', private: true, dsh: { profile: { bundles: ['dshmarket'] } }, dependencies: { dshmarket: '^1.66.7' } },
    patch: '# user patch\n',
  })
  const exportRoot = join(host.root, 'backups')
  await ensureDir(exportRoot)
  const report = await runExport({ ctx: host.ctx, env: host.env, targetDir: exportRoot, options: { ...DEFAULT_OPTIONS, skillFiles: true } })
  return { host, report }
}

test('兜底文档：信息完整（每个插件 / provider / 模型 / skill / 条目都在文档里）', async () => {
  const { report } = await exportFixture()
  const artifact = JSON.parse(await readFile(join(report.dir, 'backup.json'), 'utf8'))
  const doc = await readFile(join(report.dir, '兜底文档.md'), 'utf8')

  for (const plugin of artifact.items.plugins) {
    assert.ok(doc.includes(plugin.name), `缺插件：${plugin.name}`)
    assert.ok(doc.includes(plugin.installCommand), `缺安装命令：${plugin.installCommand}`)
  }
  for (const provider of artifact.items.models) {
    assert.ok(doc.includes(provider.provider), `缺 provider：${provider.provider}`)
    assert.ok(doc.includes(provider.apiKeyEnv), `缺设置项：${provider.apiKeyEnv}`)
    assert.ok(doc.includes(provider.baseURL), `缺 baseURL：${provider.baseURL}`)
    for (const model of provider.models) assert.ok(doc.includes(model.id), `缺模型：${model.id}`)
  }
  for (const skill of artifact.items.skills) assert.ok(doc.includes(skill.name), `缺 skill：${skill.name}`)
  for (const entry of artifact.items.config.entries) {
    assert.ok(new RegExp(`^- id: ${entry.id}$`, 'm').test(doc), `缺条目片段：${entry.id}`)
  }
  assert.ok(doc.includes('需要填写的设置项'), '缺"需要填写的设置项"小节')
  assert.ok(doc.includes('XIUXIAN_API_KEY'))
  assert.ok(!doc.includes(SECRET), '文档不得包含密钥值')
  assert.ok(!doc.includes(artifact.producer.hostname), '文档不得包含主机名')
  assert.ok(doc.includes('不会被') || doc.includes('不会**出现'), '被剥离的密钥要有"不会出现、请自己填"的提示')
})

test('盲测脚本：对真实产物跑 doc-audit.mjs 必须退出码 0', async () => {
  const { report } = await exportFixture()
  const audit = spawnSync(process.execPath, [new URL('../scripts/doc-audit.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), report.dir], { encoding: 'utf8' })
  assert.equal(audit.status, 0, `审计未通过：\n${audit.stdout}\n${audit.stderr}`)
  assert.ok(audit.stdout.includes('盲测检查通过'))
})

test('盲测脚本：抽掉一个 provider 后必须报缺口（证明它真的在检查）', async () => {
  const { report } = await exportFixture()
  const backupPath = join(report.dir, 'backup.json')
  const docPath = join(report.dir, '兜底文档.md')
  const artifact = JSON.parse(await readFile(backupPath, 'utf8'))
  const doc = await readFile(docPath, 'utf8')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(docPath, doc.replace(/MPLAN_API_KEY/g, '已删除'), 'utf8')

  const audit = spawnSync(process.execPath, [new URL('../scripts/doc-audit.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), report.dir], { encoding: 'utf8' })
  assert.equal(audit.status, 1, '文档缺内容时审计必须以 1 退出')
  assert.ok(audit.stdout.includes('MPLAN_API_KEY') || audit.stdout.includes('provider'), audit.stdout)
  assert.equal(artifact.items.models.length, 2)
})
