import test from 'node:test'
import assert from 'node:assert/strict'
import { PATH_PLACEHOLDER, renderEntryYaml, renderFallbackDoc, safeSpec, toYaml, yamlScalar } from '../src/doc.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

const DOC = renderFallbackDoc({
  items: sampleArtifact().items,
  options: sampleArtifact().options,
  producer: sampleArtifact().producer,
  credentialStatus: { XIUXIAN_API_KEY: '缺失' },
  createdAt: '2026-10-02T03:32:00.000Z',
})

/** 用给定的 plugins[] 渲染一份兜底文档（其余部分沿用固定样例）。 */
function renderWithPlugins(plugins) {
  const artifact = sampleArtifact()
  return renderFallbackDoc({
    items: { ...artifact.items, plugins },
    options: artifact.options,
    producer: artifact.producer,
    credentialStatus: { XIUXIAN_API_KEY: '缺失' },
    createdAt: '2026-10-02T03:32:00.000Z',
  })
}

function plugin(fields) {
  return { resolvedVersion: null, source: 'registry', commit: null, bundle: false, enabled: true, description: '', unportable: false, ...fields }
}

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

test('兜底文档：本机绝对路径被替换成占位符（可分享 / 零主机信息）', () => {
  const doc = renderWithPlugins([
    plugin({ name: 'my-local', spec: 'file:C:\\Users\\someone\\plugins\\x', installCommand: 'dsh plugin add file:C:\\Users\\someone\\plugins\\x', source: 'local-path', unportable: true }),
    plugin({ name: 'posix-local', spec: '/home/someone/plugins/y', installCommand: 'dsh plugin add /home/someone/plugins/y', source: 'local-path', unportable: true }),
    plugin({ name: 'unc-local', spec: '\\\\server\\share\\z', installCommand: 'dsh plugin add \\\\server\\share\\z', source: 'local-path', unportable: true }),
    plugin({ name: 'mac-local', spec: '/Users/someone/plugins/w', installCommand: 'dsh plugin add /Users/someone/plugins/w', source: 'local-path', unportable: true }),
  ])
  assert.equal(doc.includes('C:\\Users\\someone'), false, '盘符绝对路径不得出现')
  assert.equal(doc.includes('/home/someone'), false, 'POSIX 家目录不得出现')
  assert.equal(doc.includes('\\\\server\\share'), false, 'UNC 路径不得出现')
  assert.equal(doc.includes('/Users/someone'), false, 'macOS 家目录不得出现')
  assert.ok(doc.includes(PATH_PLACEHOLDER), `必须给出占位符 ${PATH_PLACEHOLDER}`)
  // 插件名要留下：用户得知道"哪个插件依赖本地目录"，只是路径本身没法分享。
  assert.ok(doc.includes('my-local') && doc.includes('posix-local') && doc.includes('unc-local') && doc.includes('mac-local'), '插件名必须保留')
  assert.ok(doc.includes('本地路径依赖'), 'unportable 警告要保留')
})

test('兜底文档：不含本机路径的安装命令原样保留（用户靠它手工重装）', () => {
  const rows = [
    { name: '@scope/pkg-name', command: 'dsh plugin add @scope/pkg-name@1.2.3' },
    { name: 'dshmarket', command: 'dsh plugin add dshmarket@1.66.7' },
    { name: 'rel-local', command: 'dsh plugin add ./local-relative' },
    { name: 'gh-plugin', command: 'dsh plugin add github:owner/repo' },
    { name: 'link-local', command: 'dsh plugin add link:../plugins/rel' },
  ]
  const doc = renderWithPlugins(rows.map(row => plugin({
    name: row.name,
    spec: row.command.replace('dsh plugin add ', ''),
    installCommand: row.command,
  })))
  for (const row of rows) assert.ok(doc.includes(row.command), `命令被误伤：${row.command}`)
  assert.equal(doc.includes(PATH_PLACEHOLDER), false, '没有本机路径时不该出现占位符')
})

test('safeSpec：掩掉四种路径形态，且不碰包名 / URL / 相对路径', () => {
  const masked = [
    ['file:C:\\Users\\someone\\plugins\\x', `${PATH_PLACEHOLDER}`],
    ['dsh plugin add C:\\Users\\someone\\plugins\\x', `dsh plugin add ${PATH_PLACEHOLDER}`],
    ['dsh plugin add C:/Users/someone/x', `dsh plugin add ${PATH_PLACEHOLDER}`],
    ['dsh plugin add \\\\server\\share\\pkg', `dsh plugin add ${PATH_PLACEHOLDER}`],
    ['dsh plugin add /Users/someone/x', `dsh plugin add ${PATH_PLACEHOLDER}`],
    ['dsh plugin add link:/home/someone/x', `dsh plugin add link:${PATH_PLACEHOLDER}`],
    ['dsh plugin add file:///Users/someone/x', `dsh plugin add ${PATH_PLACEHOLDER}`],
  ]
  for (const [input, expected] of masked) assert.equal(safeSpec(input), expected, input)
  const kept = ['@deepseek-ai/dsh-llm-pi-ai', '^1.66.7', 'dsh plugin add @scope/pkg@1.0.0', 'dsh plugin add github:owner/repo', 'https://github.com/owner/repo.git', 'https://api.minimax.cn/v1', 'link:../plugins/rel', '可视化插件市场']
  for (const value of kept) assert.equal(safeSpec(value), value, value)
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
