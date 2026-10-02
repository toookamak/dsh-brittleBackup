import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, parseVersion, satisfies } from '../src/semver.js'

test('parseVersion 解析 prerelease 与 build 元数据', () => {
  assert.deepEqual(parseVersion('0.2.0-rc.2'), { major: 0, minor: 2, patch: 0, pre: 'rc.2', raw: '0.2.0-rc.2' })
  assert.equal(parseVersion('v1.66.7+build.5').pre, '')
  assert.equal(parseVersion('不是版本'), null)
})

test('compareVersions：prerelease 小于正式版', () => {
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('0.2.0-rc.2', '0.2.0-rc.1'), 1)
  assert.equal(compareVersions('1.66.7', '1.66.7'), 0)
})

test('satisfies：OR / caret / tilde / 连字符范围', () => {
  const skillsManagerRange = '0.1.2-rc.1 || 0.1.5-rc.1 || 0.2.0-rc.1 || 0.2.0-rc.2'
  assert.equal(satisfies('0.2.0-rc.2', skillsManagerRange).satisfied, true)
  assert.equal(satisfies('0.3.0-rc.1', skillsManagerRange).satisfied, false)

  assert.equal(satisfies('1.66.7', '^1.66.7').satisfied, true)
  assert.equal(satisfies('2.0.0', '^1.66.7').satisfied, false)
  assert.equal(satisfies('0.2.5', '^0.2.3').satisfied, true)
  assert.equal(satisfies('0.3.0', '^0.2.3').satisfied, false)
  assert.equal(satisfies('1.2.9', '~1.2.3').satisfied, true)
  assert.equal(satisfies('1.3.0', '~1.2.3').satisfied, false)
  assert.equal(satisfies('1.5.0', '>=1.2.3 <2.0.0').satisfied, true)
  assert.equal(satisfies('2.0.0', '>=1.2.3 <2.0.0').satisfied, false)
  assert.equal(satisfies('1.5.0', '1.2.0 - 1.9.9').satisfied, true)
  assert.equal(satisfies('2.5.0', '*').satisfied, true)
})

test('satisfies：prerelease 需要同元组锚点（npm 语义，§7-#4 明确要求）', () => {
  assert.equal(satisfies('0.2.0-rc.2', '^0.2.0-rc.1').satisfied, true)
  assert.equal(satisfies('0.2.0-rc.2', '>=0.1.0 <1.0.0').satisfied, false)
  assert.equal(satisfies('0.2.0', '>=0.1.0 <1.0.0').satisfied, true)
})
