import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { locateArtifact, writeArtifact } from '../src/artifact.js'
import { zipDirectory } from '../src/zip.js'
import { ensureDir, pathExists } from '../src/nodefs.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

test('导入：直接传入 zip 文件路径时自动解压并定位 backup.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-direct-zip-'))
  const source = join(root, 'dsh-brittle-backup-20261002-130000')
  await ensureDir(root)
  const artifact = sampleArtifact()
  const written = await writeArtifact({ targetRoot: root, artifact, options: artifact.options })
  const zipPath = `${written.dir}.zip`
  await zipDirectory(written.dir, zipPath)
  assert.equal(await pathExists(zipPath), true)

  const located = await locateArtifact(zipPath, { env: { DSH_HOME: join(root, '.dsh'), DSH_PROFILE_DIR: join(root, '.dsh', 'profiles', 'desktop') } })
  assert.equal(located.ok, true, located.reason)
  assert.equal(located.source, 'zip')
  assert.equal(await pathExists(join(located.dir, 'backup.json')), true)
})
