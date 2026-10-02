import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArtifact, locateArtifact, readArtifact, validateArtifact, writeArtifact } from '../src/artifact.js'
import { writeJsonAtomic, writeTextAtomic } from '../src/nodefs.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

test('validateArtifact 接受样例产物', () => {
  const result = validateArtifact(sampleArtifact())
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.equal(result.value.items.plugins[0].enabled, true)
  assert.deepEqual(result.value.items.redactions, [])
})

test('validateArtifact：format / version 是全局闸门', () => {
  const wrongFormat = validateArtifact({ ...sampleArtifact(), format: 'dsh-market-backup' })
  assert.equal(wrongFormat.ok, false)
  assert.ok(wrongFormat.errors.some(message => message.includes('format')))

  const wrongVersion = validateArtifact({ ...sampleArtifact(), version: 2 })
  assert.equal(wrongVersion.ok, false)
  assert.ok(wrongVersion.errors.some(message => message.includes('version')))
})

test('validateArtifact：拒绝路径穿越 / 绝对路径 / 排除名单 / 重复路径', () => {
  const cases = [
    { files: [{ path: '../escape.json', json: {} }] },
    { files: [{ path: 'C:\\Windows\\win.ini', json: {} }] },
    { files: [{ path: 'node_modules/x.json', json: {} }] },
    { files: [{ path: 'package.json', json: {} }, { path: 'package.json', json: {} }] },
  ]
  for (const overrides of cases) {
    const result = validateArtifact(sampleArtifact(overrides))
    assert.equal(result.ok, false, `应当拒绝：${JSON.stringify(overrides.files)}`)
  }
})

test('validateArtifact：重复的配置条目 id 与 skill 名也会被拦下', () => {
  const duplicated = sampleArtifact()
  duplicated.items.config.entries.push({ ...duplicated.items.config.entries[0] })
  const result = validateArtifact(duplicated)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(message => message.includes('重复')))
})

test('writeArtifact → readArtifact 往返（含 doc 与同秒重名派生）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-artifact-'))
  const artifact = sampleArtifact()
  const first = await writeArtifact({ targetRoot: root, artifact, docText: '# doc\n', options: artifact.options, date: new Date(2026, 9, 2, 11, 5, 9) })
  const second = await writeArtifact({ targetRoot: root, artifact, docText: '# doc\n', options: artifact.options, date: new Date(2026, 9, 2, 11, 5, 9) })

  assert.match(first.dir, /dsh-brittle-backup-20261002-110509$/)
  assert.match(second.dir, /-2$/)

  const read = await readArtifact(first.dir)
  assert.equal(read.ok, true, read.errors?.join('; '))
  assert.equal(read.value.items.plugins[0].name, 'dshmarket')
  assert.equal(read.bytes > 0, true)
})

test('locateArtifact：目录自身 / 唯一子目录 / 多候选 / 找不到', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-locate-'))
  const artifact = sampleArtifact()

  const direct = join(root, 'direct')
  await writeArtifact({ targetRoot: root, artifact, options: artifact.options, date: new Date(2026, 9, 2, 1, 1, 1) })
  const locatedDirect = await locateArtifact(root)
  assert.equal(locatedDirect.ok, true)

  await writeJsonAtomic(join(direct, 'backup.json'), artifact)
  assert.equal((await locateArtifact(direct)).ok, true)

  await writeArtifact({ targetRoot: root, artifact, options: artifact.options, date: new Date(2026, 9, 2, 2, 2, 2) })
  const ambiguous = await locateArtifact(root)
  assert.equal(ambiguous.ok, false)
  assert.equal(ambiguous.code, 'ARTIFACT_AMBIGUOUS')
  assert.equal(ambiguous.candidates.length, 2)

  const empty = await mkdtemp(join(tmpdir(), 'brittle-empty-'))
  const missing = await locateArtifact(empty)
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'ARTIFACT_NOT_FOUND')
})

test('readArtifact：非法 JSON 与未知 version 都不会被当成可导入产物', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-invalid-'))
  await writeTextAtomic(join(root, 'backup.json'), '{ this is not json')
  assert.equal((await readArtifact(root)).ok, false)

  await writeJsonAtomic(join(root, 'backup.json'), { ...sampleArtifact(), version: 99 })
  const unknown = await readArtifact(root)
  assert.equal(unknown.ok, false)
  assert.ok(unknown.errors.some(message => message.includes('version')))
})
