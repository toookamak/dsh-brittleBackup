/**
 * 受限的文件系统操作（SCOPE-PHASE1.md §4.6 / U34）。
 *
 * 宿主 `fs` 服务没有删除、建目录、写二进制的原语，所以目录树复制、快照与回滚必须
 * 直接用 `node:fs`。允许的范围只有三处：
 *   1. `&lt;DSH_HOME&gt;\dsh-brittle-backup\`（快照 / 临时文件 / 回退落点）
 *   2. 用户本次显式选择的导出目录
 *   3. `&lt;DSH_HOME&gt;\skills\&lt;name&gt;\`（仅导入且用户勾选了文件）
 * 调用方必须先用 `assertWithin` 把目标夹在这三处之内 —— 本模块只提供原语，不做策略。
 */
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
  return path
}

export async function pathExists(path) {
  try {
    return (await lstat(path)) !== undefined
  } catch {
    return false
  }
}

export async function readTextFile(path) {
  return await readFile(path, 'utf8')
}

export async function readJsonFile(path) {
  return JSON.parse(await readTextFile(path))
}

/** 原子写：同目录 temp + rename；不跨盘，不静默截断。 */
export async function writeTextAtomic(path, text) {
  await ensureDir(dirname(path))
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temp, text, 'utf8')
  try {
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  return path
}

export async function writeJsonAtomic(path, value) {
  return await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeBytesAtomic(path, bytes) {
  await ensureDir(dirname(path))
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temp, bytes)
  try {
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 递归列目录：返回相对路径、类型与体积。符号链接只记录不跟随（导入侧要拒绝它）。
 * @returns {Promise<Array<{rel:string,type:'file'|'directory'|'symlink'|'other',size:number}>>}
 */
export async function listTree(root, { maxEntries = Number.POSITIVE_INFINITY } = {}) {
  const out = []
  async function walk(current, prefix) {
    if (out.length >= maxEntries) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (out.length >= maxEntries) return
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const abs = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        out.push({ rel, type: 'symlink', size: 0 })
        continue
      }
      if (entry.isDirectory()) {
        out.push({ rel, type: 'directory', size: 0 })
        await walk(abs, rel)
        continue
      }
      if (entry.isFile()) {
        const info = await stat(abs).catch(() => undefined)
        out.push({ rel, type: 'file', size: info?.size ?? 0 })
        continue
      }
      out.push({ rel, type: 'other', size: 0 })
    }
  }
  await walk(root, '')
  return out
}

export async function countFiles(root) {
  const tree = await listTree(root)
  return tree.filter(entry => entry.type === 'file').length
}

/**
 * 逐字节复制目录树：保留子目录、空目录与二进制内容；符号链接跳过并记入 skipped。
 * @returns {Promise<{copied:number, skipped:Array<{rel:string,reason:string}>}>}
 */
export async function copyTree(source, destination, { maxFileBytes = Number.POSITIVE_INFINITY } = {}) {
  const skipped = []
  let copied = 0
  await ensureDir(destination)
  const tree = await listTree(source)
  for (const entry of tree) {
    const target = join(destination, ...entry.rel.split('/'))
    if (entry.type === 'directory') {
      await ensureDir(target)
      continue
    }
    if (entry.type === 'symlink') {
      skipped.push({ rel: entry.rel, reason: '符号链接不复制' })
      continue
    }
    if (entry.type !== 'file') {
      skipped.push({ rel: entry.rel, reason: '非常规文件不复制' })
      continue
    }
    if (entry.size > maxFileBytes) {
      skipped.push({ rel: entry.rel, reason: `超过单文件上限 ${maxFileBytes} 字节` })
      continue
    }
    const from = join(source, ...entry.rel.split('/'))
    await ensureDir(dirname(target))
    await cp(from, target)
    copied += 1
  }
  return { copied, skipped }
}

export async function removeTree(path) {
  await rm(path, { recursive: true, force: true })
}

/** 把文件复制到目标位置（回滚还原用；先建父目录）。 */
export async function copyFileTo(source, destination) {
  await ensureDir(dirname(destination))
  await cp(source, destination)
  return destination
}

export async function listNames(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).map(entry => ({ name: entry.name, directory: entry.isDirectory() }))
  } catch {
    return []
  }
}
