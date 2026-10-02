import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { checkArtifactPath, dshHome, isWithin, profileDir, resolveArtifactPath, timestamp, workDir } from '../src/paths.js'

test('checkArtifactPath 只接受安全的相对路径', () => {
  assert.equal(checkArtifactPath('package.json').ok, true)
  assert.equal(checkArtifactPath('skills/我的 skill/SKILL.md').ok, true)
  assert.equal(checkArtifactPath('skills\\x\\SKILL.md').ok, true)

  assert.equal(checkArtifactPath('C:\\Windows\\win.ini').ok, false)
  assert.equal(checkArtifactPath('/etc/passwd').ok, false)
  assert.equal(checkArtifactPath('../outside.txt').ok, false)
  assert.equal(checkArtifactPath('a/../../b.txt').ok, false)
  assert.equal(checkArtifactPath('').ok, false)
  assert.equal(checkArtifactPath(undefined).ok, false)
})

test('checkArtifactPath 拒绝排除名单里的路径段', () => {
  for (const bad of ['node_modules/x.js', '.credentials.yaml', 'cordis.yml', '.dsh-market/state.json', '.plugin-manager/logs.txt']) {
    const result = checkArtifactPath(bad)
    assert.equal(result.ok, false, `${bad} 应该被拒绝`)
  }
})

test('isWithin：包含关系（含相等、含大小写差异）', () => {
  const root = resolve('F:\\Git\\demo')
  assert.equal(isWithin(root, join(root, 'a', 'b.txt')), true)
  assert.equal(isWithin(root, root), true)
  assert.equal(isWithin(root, resolve('F:\\Git\\demo-other\\x.txt')), false)
  assert.equal(isWithin(root, resolve('F:\\Git')), false)
})

test('resolveArtifactPath 越界即抛错', () => {
  const root = resolve('F:\\Git\\demo')
  assert.equal(resolveArtifactPath(root, 'a/b.txt'), join(root, 'a', 'b.txt'))
  assert.throws(() => resolveArtifactPath(root, '../escape.txt'), /非法产物路径/)
})

test('timestamp 是 YYYYMMDD-HHmmss（本地时间）', () => {
  const stamp = timestamp(new Date(2026, 9, 2, 11, 5, 9))
  assert.match(stamp, /^20261002-110509$/)
})

test('路径全部由环境变量决定，回退值可预期', () => {
  const env = { DSH_HOME: 'F:\\Git\\demo\\.dsh', DSH_PROFILE: 'desktop', DSH_PROFILE_DIR: 'F:\\Git\\demo\\.dsh\\profiles\\desktop' }
  assert.equal(dshHome(env), resolve(env.DSH_HOME))
  assert.equal(profileDir(env), resolve(env.DSH_PROFILE_DIR))
  assert.equal(workDir(env), join(resolve(env.DSH_HOME), 'dsh-brittle-backup'))

  const fallback = { DSH_HOME: 'F:\\Git\\demo\\.dsh' }
  assert.equal(profileDir(fallback), join(resolve(fallback.DSH_HOME), 'profiles', 'desktop'))
})
