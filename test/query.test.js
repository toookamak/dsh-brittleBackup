/** 配置查询文本：安全摘要 / 详细模式，供插件失效时复制到文本中人工排障。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQueryReport } from '../src/query.js'
import { writeArtifact } from '../src/artifact.js'
import { ensureDir } from '../src/nodefs.js'
import { sampleArtifact } from './helpers/sample-artifact.js'
import { makeFakeHost } from './helpers/fake-host.js'

const SECRET = 'sk-live-abcdefghijklmnopqrstuvwx'

test('配置查询摘要：包含必要版本、插件、模型、skills 信息但不含密钥/主机名/绝对路径', async () => {
  const host = await makeFakeHost({
    records: [{
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      override: { providers: { xiuxian: { apiKey: SECRET, apiKeyEnv: 'XIUXIAN_API_KEY', baseURL: 'https://example.test/v1' } } },
    }],
    secretsByEntry: { 'llm-pi-ai': [{ path: ['providers', 'xiuxian', 'apiKey'], set: true }] },
    bundles: [{ name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true }, { name: 'dshmarket', version: '1.66.7', enabled: true }],
    plugins: [{ moduleName: 'dshmarket', entryId: 'dsh-market', enabled: true }],
    skills: { 'skill-a': { 'SKILL.md': '# skill' } },
    packageJson: { name: 'dsh-profile', dependencies: { dshmarket: '^1.66.7' } },
  })

  const sourceDir = `${host.root}\\backup-source`
  await ensureDir(sourceDir)
  const artifact = sampleArtifact({ producer: { dshVersion: '0.2.0-rc.2', pluginVersion: '0.1.1', hostname: 'SECRET-HOST' } })
  const written = await writeArtifact({ targetRoot: sourceDir, artifact, options: artifact.options })
  const report = await buildQueryReport({ sourceDir: written.dir, env: host.env, detail: false })
  assert.equal(report.ok, true)
  assert.match(report.text, /DSH 版本.*0\.2\.0-rc\.2/)
  assert.match(report.text, /dshmarket/)
  assert.match(report.text, /example-skill/)
  assert.match(report.text, /XIUXIAN_API_KEY/)
  assert.equal(report.text.includes(SECRET), false)
  assert.equal(report.text.includes(host.env.DSH_HOME), false)
  assert.equal(report.text.includes(host.env.DSH_PROFILE_DIR), false)
  assert.equal(report.text.includes('hostname'), false)
  assert.equal(report.summary.detail, false)
})

test('配置查询详细模式：包含脱敏后的配置结构，并明确密钥不可复制', async () => {
  const host = await makeFakeHost({
    records: [{ id: 'entry-a', name: 'plugin-a', override: { apiKey: SECRET, apiKeyEnv: 'A_KEY', nested: { enabled: true } } }],
    secretsByEntry: { 'entry-a': [{ path: ['apiKey'], set: true }] },
    bundles: [{ name: '@deepseek-ai/dsh-base', version: '0.2.0-rc.2', enabled: true }],
    packageJson: { name: 'dsh-profile', dependencies: {} },
  })
  const sourceDir = `${host.root}\\backup-source`
  await ensureDir(sourceDir)
  const artifact = sampleArtifact({ entries: [{ id: 'entry-a', name: 'plugin-a', override: { apiKey: '<REDACTED>', apiKeyEnv: 'A_KEY', nested: { enabled: true } }, inherited: {}, secrets: [{ path: ['apiKey'], set: true }], redactions: [] }] })
  const written = await writeArtifact({ targetRoot: sourceDir, artifact, options: artifact.options })
  const report = await buildQueryReport({ sourceDir: written.dir, env: host.env, detail: true })
  assert.equal(report.ok, true)
  assert.equal(report.summary.detail, true)
  assert.match(report.text, /配置结构（已脱敏）/)
  assert.match(report.text, /entry-a/)
  assert.match(report.text, /nested/)
  assert.match(report.text, /A_KEY/)
  assert.match(report.text, /不会显示密钥值/)
  assert.equal(report.text.includes(SECRET), false)
})
