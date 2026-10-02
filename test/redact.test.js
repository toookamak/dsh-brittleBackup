import test from 'node:test'
import assert from 'node:assert/strict'
import { REDACTED, isSecretKey, scanForSecrets, scanTextForSecrets, secretMapFromDescriptors, secretPointersForEntry, stripSecrets } from '../src/redact.js'

test('isSecretKey：剥离值，但放过名字指针与"复数/计数"字段', () => {
  assert.equal(isSecretKey('apiKey'), true)
  assert.equal(isSecretKey('apiKeyValue'), true)
  assert.equal(isSecretKey('password'), true)
  assert.equal(isSecretKey('token'), true)
  assert.equal(isSecretKey('refreshToken'), true)
  assert.equal(isSecretKey('clientSecret'), true)
  assert.equal(isSecretKey('authorization'), true)

  assert.equal(isSecretKey('apiKeyEnv'), false)
  assert.equal(isSecretKey('tokenRef'), false)
  assert.equal(isSecretKey('secretPath'), false)
  assert.equal(isSecretKey('baseURL'), false)
  assert.equal(isSecretKey('models'), false)
  // 这些是"数字上限 / 计数"，被当成密钥剥掉过（真 bug）
  assert.equal(isSecretKey('maxTokens'), false)
  assert.equal(isSecretKey('tokens'), false)
  assert.equal(isSecretKey('tokenCount'), false)
  assert.equal(isSecretKey('requiredCredentials'), false)
})

test('stripSecrets：嵌套内联密钥被剥离，apiKeyEnv 保留', () => {
  const input = {
    providers: {
      xiuxian: {
        displayName: '修仙',
        apiKeyEnv: 'XIUXIAN_API_KEY',
        apiKey: 'sk-live-abcdefghijklmnop',
        models: [{ id: 'gpt-6-luna' }],
      },
    },
  }
  const { value, redactions } = stripSecrets(input, { prefix: '/override' })
  assert.equal(value.providers.xiuxian.apiKey, REDACTED)
  assert.equal(value.providers.xiuxian.apiKeyEnv, 'XIUXIAN_API_KEY')
  assert.deepEqual(redactions, [{ pointer: '/override/providers/xiuxian/apiKey', reason: 'inline-secret' }])
})

test('stripSecrets：幂等（已剥离的值不再重复记录）', () => {
  const input = { apiKey: REDACTED, nested: { password: 'hunter2hunter2' } }
  const first = stripSecrets(input)
  assert.equal(first.value.nested.password, REDACTED)
  assert.equal(first.redactions.length, 1)

  const second = stripSecrets(first.value)
  assert.deepEqual(second.redactions, [])
  assert.equal(second.value.apiKey, REDACTED)
  assert.equal(second.value.nested.password, REDACTED)
})

test('stripSecrets：宿主密钥路径图优先于字段名（名字不像密钥也剥离）', () => {
  const secretPointers = new Set(['/providers/x/cred'])
  const { value, redactions } = stripSecrets({ providers: { x: { cred: 'abc123', keep: 'ok' } } }, { secretPointers, prefix: '/override' })
  assert.equal(value.providers.x.cred, REDACTED)
  assert.equal(value.providers.x.keep, 'ok')
  assert.deepEqual(redactions, [{ pointer: '/override/providers/x/cred', reason: 'host-secret-path' }])
})

test('secretMapFromDescriptors：path 是字符串数组，按 ns 索引', () => {
  const map = secretMapFromDescriptors([
    { ns: 'llm-pi-ai', secrets: [{ path: ['providers', 'xiuxian', 'apiKey'], set: false }] },
    { ns: 'include:other', secrets: [{ path: ['token'], set: true }] },
  ])
  assert.deepEqual([...secretPointersForEntry(map, 'llm-pi-ai')], ['/providers/xiuxian/apiKey'])
  assert.deepEqual([...secretPointersForEntry(map, 'other')], ['/token'])
  assert.deepEqual(map.entries.get('llm-pi-ai'), [{ path: ['providers', 'xiuxian', 'apiKey'], set: false }])
})

test('scanForSecrets：命中真密钥，放过 commit 一类的哈希', () => {
  const hits = scanForSecrets({
    items: {
      plugins: [{ name: 'x', commit: 'a'.repeat(40) }],
      config: { entries: [{ id: 'llm-pi-ai', override: { providers: { x: { apiKey: 'sk-abcdefghijklmnopqrstuvwx' } } } }] },
      note: 'https://user:secret@example.com/x',
      header: 'Authorization: Bearer abcdefghijklmnop',
    },
  })
  const patterns = hits.map(hit => hit.pattern).sort()
  assert.ok(patterns.includes('openai-key'), 'sk- 应命中')
  assert.ok(patterns.includes('url-userinfo'), 'URL 内嵌 user:pass 应命中')
  assert.ok(patterns.includes('authorization-header'), 'Authorization 头应命中')
  assert.equal(hits.some(hit => hit.pointer.endsWith('/commit')), false, 'commit 不应命中')
})

test('scanTextForSecrets：文档里出现密钥同样命中', () => {
  assert.equal(scanTextForSecrets('普通文本，没有密钥').length, 0)
  assert.ok(scanTextForSecrets('apiKey: sk-abcdefghijklmnopqrstuvwx').length > 0)
})
