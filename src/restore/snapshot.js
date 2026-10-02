/**
 * 写前快照与回滚（U21 / U34）。
 *
 * 快照做两件事，缺一不可：
 *   1. 记录"将要被覆盖"的文件的**原内容**（回滚时还原）；
 *   2. 记录"将要新建"的路径（回滚时删除）。
 * 没有第 2 条就无法"回滚到操作前"，而宿主 `fs` 服务没有删除原语 —— 这就是 U34 例外的由来。
 *
 * 剪枝：保留最近 `keep` 份（默认 10），失败只记警告。
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { SNAPSHOT_KEEP, snapshotsDir, timestamp } from '../paths.js'
import {
  copyFileTo,
  copyTree,
  ensureDir,
  listNames,
  pathExists,
  readJsonFile,
  removeTree,
  writeJsonAtomic,
} from '../nodefs.js'

export const SNAPSHOT_MANIFEST = 'manifest.json'

/**
 * @param targets `[{path, type:'file'|'dir'}]` —— 本次将要写的目标（文件或目录）
 * @returns {{dir:string, manifest:object}}
 */
export async function createSnapshot({ env = process.env, targets = [], now = new Date() } = {}) {
  const dir = join(snapshotsDir(env), `${timestamp(now)}-${randomBytes(3).toString('hex')}`)
  await ensureDir(dir)
  const entries = []
  let index = 0
  for (const target of targets) {
    const existed = await pathExists(target.path)
    const entry = { path: target.path, type: target.type ?? 'file', existed, backup: null }
    if (existed) {
      const backup = join('files', String(index))
      if (entry.type === 'dir') await copyTree(target.path, join(dir, backup))
      else await copyFileTo(target.path, join(dir, backup))
      entry.backup = backup
      index += 1
    }
    entries.push(entry)
  }
  const manifest = { version: 1, createdAt: now.toISOString(), entries }
  await writeJsonAtomic(join(dir, SNAPSHOT_MANIFEST), manifest)
  return { dir, manifest }
}

/**
 * 回滚到快照：先删除"本次新建"的路径，再还原"本次覆盖"的内容。
 * @returns {{restored:string[], removed:string[], residuals:Array<{path:string,reason:string}>}}
 */
export async function rollbackSnapshot(dir, { env = process.env } = {}) {
  const restored = []
  const removed = []
  const residuals = []
  let manifest
  try {
    manifest = await readJsonFile(join(dir, SNAPSHOT_MANIFEST))
  } catch (error) {
    return { restored, removed, residuals: [{ path: dir, reason: `读不到快照清单：${error?.message ?? String(error)}` }] }
  }
  const entries = Array.isArray(manifest.entries) ? [...manifest.entries].reverse() : []
  for (const entry of entries) {
    try {
      if (entry.existed !== true) {
        if (await pathExists(entry.path)) {
          await removeTree(entry.path)
          removed.push(entry.path)
        }
        continue
      }
      const backup = join(dir, entry.backup)
      if (entry.type === 'dir') {
        await removeTree(entry.path)
        await copyTree(backup, entry.path)
      } else {
        await copyFileTo(backup, entry.path)
      }
      restored.push(entry.path)
    } catch (error) {
      residuals.push({ path: entry.path, reason: error?.message ?? String(error) })
    }
  }
  return { restored, removed, residuals }
}

export async function listSnapshots(env = process.env) {
  const root = snapshotsDir(env)
  const entries = await listNames(root)
  const out = []
  for (const entry of entries) {
    if (!entry.directory) continue
    const dir = join(root, entry.name)
    let createdAt = null
    try {
      createdAt = (await readJsonFile(join(dir, SNAPSHOT_MANIFEST)))?.createdAt ?? null
    } catch {
      createdAt = null
    }
    out.push({ name: entry.name, dir, createdAt })
  }
  out.sort((a, b) => (a.name < b.name ? 1 : -1))
  return out
}

/** 保留最近 keep 份；返回被删除的目录列表。 */
export async function pruneSnapshots(env = process.env, keep = SNAPSHOT_KEEP) {
  const effective = Number.isInteger(keep) && keep >= 1 ? keep : SNAPSHOT_KEEP
  const snapshots = await listSnapshots(env)
  const removed = []
  for (const snapshot of snapshots.slice(effective)) {
    try {
      await removeTree(snapshot.dir)
      removed.push(snapshot.dir)
    } catch {
      /* 剪枝失败只记警告 */
    }
  }
  return removed
}
