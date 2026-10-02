import test from 'node:test'
import assert from 'node:assert/strict'
import { renderEntryYaml, renderFallbackDoc, toYaml, yamlScalar } from '../src/doc.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

const DOC = renderFallbackDoc({
  items: sampleArtifact().items,
  options: sampleArtifact().options,
  producer: sampleArtifact().producer,
  credentialStatus: { XIUXIAN_API_KEY: '缺失' },
  createdAt: '2026-10-02T03:32:00.000Z',
})

test('兜底文档：自包含（步骤 / 插件命令 / 模型 / skills）', () => {
  assert.ok(DOC.includes('# DSH 配置兜底文档（dsh-BrittleBackup 生成）'))
  assert.ok(DOC.includes('手工重建步骤'))
  assert.ok(DOC.includes('dsh plugin add dshmarket@1.66.7'))
  assert.ok(DOC.includes('XIUXIAN_API_KEY'))
  assert.ok(DOC.includes('gpt-6-luna'))
  assert.ok(DOC.includes('example-skill'))
  assert.ok(DOC.includes('```yaml'))
  assert.ok(DOC.includes('- id: llm-pi-ai'))
  assert.ok(DOC.includes('重启 DSH'))
})

test('兜底文档：零主机名 / 零本机路径 / 零密钥', () => {
  assert.equal(DOC.includes('DESKTOP-TEST'), false, '不能出现主机名')
  assert.equal(/[A-Za-z]:\\/.test(DOC), false, '不能出现 Windows 本机路径')
  assert.equal(DOC.includes('sk-'), false, '不能出现密钥')
  assert.equal(DOC.includes('<DSH_HOME>\\skills'), true, '只允许占位符形式的路径')
})

test('可粘贴片段：三层结构（id / name / config）与缩进正确', () => {
  const yaml = renderEntryYaml(sampleArtifact().items.config.entries[0])
  assert.ok(yaml.startsWith('- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config:'))
  assert.ok(yaml.includes('    providers:'))
  assert.ok(yaml.includes('        apiKeyEnv: XIUXIAN_API_KEY'))
  assert.ok(yaml.includes('          - id: gpt-6-luna'))
})

test('yamlScalar：需要时加引号，布尔/数字保持字面量', () => {
  assert.equal(yamlScalar('xiuxian'), 'xiuxian')
  assert.equal(yamlScalar('https://xiuxian.pro/v1'), 'https://xiuxian.pro/v1')
  assert.equal(yamlScalar('修仙'), '"修仙"')
  assert.equal(yamlScalar(true), 'true')
  assert.equal(yamlScalar(256000), '256000')
  assert.equal(yamlScalar(null), 'null')
  assert.equal(yamlScalar('true'), '"true"')
})

test('toYaml：数组与嵌套对象的块状输出', () => {
  const text = toYaml({ input: ['text', 'image'], models: [{ id: 'a' }] })
  assert.ok(text.includes('input:\n  - text\n  - image'))
  assert.ok(text.includes('models:\n  - id: a'))
})
