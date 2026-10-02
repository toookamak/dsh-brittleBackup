/**
 * ZIP 打包 / 解包（阶段一体验优化，见 docs/FORMAT.md §1）。
 *
 * 为什么手写：本项目的硬目标是**零依赖、零构建、抗 DSH 升级**，所以不引 `archiver` /
 * `adm-zip` / `yauzl`，只用 Node 内置的 `node:zlib` 做 deflate/inflate，其余（本地文件头、
 * 中央目录、EOCD、CRC32）都是几十行字节搬运。写侧固定写 UTF-8 名字位（bit 11），
 * 所以中文文件名（`兜底文档.md`）不会被解成乱码。
 *
 * 解包侧的威胁模型与目录形态一致：压缩包是**用户自己挑的本地文件**，但不能因此信任它 ——
 *   - 条目名必须过 `checkZipEntryName`（相对路径、无 `..`、无盘符、无 NUL）→ 防 zip-slip；
 *   - 解压后仍用 `assertWithin` 二次夹紧在目标目录内；
 *   - 条目数 / 单文件 / 总解压体积都有上限 → 防 zip 炸弹；
 *   - 加密项与符号链接项**直接拒绝**（本项目自己的包永远不含它们）；
 *   - 每个文件都校验 CRC32 → 损坏的包不会被悄悄还原成半个产物。
 */
import { basename, dirname, join } from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { ensureDir, listTree, readBytes, writeBytesAtomic } from './nodefs.js'
import { assertWithin } from './paths.js'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const EOCD_MIN = 22
const EOCD_MAX = 22 + 0xffff
const UTF8_FLAG = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const DOS_DIRECTORY_ATTRIBUTE = 0x10
const UNIX_FILE_TYPE_MASK = 0xf000
const UNIX_SYMLINK = 0xa000

/** 防爆上限（与 artifact.js LIMITS 同一档"宽松防爆"口径）。 */
export const ZIP_LIMITS = Object.freeze({
  entries: 20000,
  entryBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  archiveBytes: 256 * 1024 * 1024,
})

export class ZipError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function fail(code, message) {
  throw new ZipError(code, message)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/** 标准 CRC32（IEEE 802.3），返回无符号 32 位整数。 */
export function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time: time & 0xffff, date: day & 0xffff }
}

/**
 * 把条目数组打成 zip 字节流。
 * @param entries `[{ name, data?: Buffer|string, directory?: boolean, store?: boolean }]`
 */
export function buildZip(entries, { date = new Date() } = {}) {
  const { time, date: dosDay } = dosDateTime(date)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const isDirectory = entry.directory === true || entry.name.endsWith('/')
    const normalizedName = entry.name.replace(/\\/g, '/')
    const name = Buffer.from(normalizedName, 'utf8')
    const raw = isDirectory
      ? Buffer.alloc(0)
      : (Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8'))
    const crc = crc32(raw)

    let method = METHOD_STORE
    let payload = raw
    if (!isDirectory && raw.length > 0 && entry.store !== true) {
      const deflated = deflateRawSync(raw, { level: 9 })
      if (deflated.length < raw.length) {
        method = METHOD_DEFLATE
        payload = deflated
      }
    }

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(LOCAL_SIG, 0)
    localHeader.writeUInt16LE(20, 4) // 需要的版本 2.0
    localHeader.writeUInt16LE(UTF8_FLAG, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(dosDay, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(payload.length, 18)
    localHeader.writeUInt32LE(raw.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(CENTRAL_SIG, 0)
    centralHeader.writeUInt16LE(20, 4) // 制作版本
    centralHeader.writeUInt16LE(20, 6) // 需要的版本
    centralHeader.writeUInt16LE(UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(dosDay, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(payload.length, 20)
    centralHeader.writeUInt32LE(raw.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra
    centralHeader.writeUInt16LE(0, 32) // comment
    centralHeader.writeUInt16LE(0, 34) // 起始磁盘
    centralHeader.writeUInt16LE(0, 36) // 内部属性
    centralHeader.writeUInt32LE(isDirectory ? DOS_DIRECTORY_ATTRIBUTE : 0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + payload.length
  }

  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(EOCD_MIN)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, eocd])
}

function findEocd(buffer) {
  const from = Math.max(0, buffer.length - EOCD_MAX)
  for (let offset = buffer.length - EOCD_MIN; offset >= from; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset
  }
  return -1
}

/** 条目名安全校验：防 zip-slip。**不**套用产物的排除名单（那是导入目标的规则，不是压缩包的）。 */
export function checkZipEntryName(name) {
  if (typeof name !== 'string' || name === '') return { ok: false, reason: '条目名为空' }
  if (name.includes('\0')) return { ok: false, reason: '条目名含 NUL 字节' }
  const raw = name.replace(/\\/g, '/')
  if (raw.startsWith('/')) return { ok: false, reason: '条目名是绝对路径' }
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, reason: '条目名带盘符' }
  const segments = raw.split('/').filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return { ok: false, reason: '条目名为空' }
  if (segments.some(segment => segment === '..')) return { ok: false, reason: '条目名含 ".."' }
  return { ok: true, relative: segments.join('/') }
}

/** 解析 zip 字节流：返回条目（含已解压内容）。校验失败一律抛 ZipError。 */
export function readZip(buffer, { limits = ZIP_LIMITS } = {}) {
  if (!Buffer.isBuffer(buffer)) fail('ARCHIVE_INVALID', '不是字节流')
  if (buffer.length > limits.archiveBytes) fail('ARCHIVE_TOO_LARGE', `压缩包 ${buffer.length} 字节，超过上限 ${limits.archiveBytes}`)
  const eocdOffset = findEocd(buffer)
  if (eocdOffset < 0) fail('ARCHIVE_INVALID', '找不到 ZIP 结束记录（EOCD），这不是一个合法的 zip 文件')

  const total = buffer.readUInt16LE(eocdOffset + 10)
  const centralSize = buffer.readUInt32LE(eocdOffset + 12)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (centralOffset + centralSize > buffer.length) fail('ARCHIVE_INVALID', '中央目录越出文件边界，压缩包已损坏')
  if (total > limits.entries) fail('ARCHIVE_TOO_LARGE', `压缩包里有 ${total} 个条目，超过上限 ${limits.entries}`)

  const entries = []
  let cursor = centralOffset
  let totalBytes = 0
  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIG) {
      fail('ARCHIVE_INVALID', `第 ${index + 1} 条中央目录记录不合法`)
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const externalAttributes = buffer.readUInt32LE(cursor + 38)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const nameBytes = buffer.subarray(nameStart, nameStart + nameLength)
    const name = nameBytes.toString((flags & UTF8_FLAG) !== 0 ? 'utf8' : 'latin1')
    cursor = nameStart + nameLength + extraLength + commentLength

    if ((flags & 0x0001) === 0x0001) fail('ARCHIVE_ENCRYPTED', `zip 里的 ${name} 是加密条目，本插件不处理加密包`)
    if ((((externalAttributes >>> 16) & 0xffff) & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK) {
      fail('ARCHIVE_SYMLINK', `zip 里的 ${name} 是符号链接，拒绝解压`)
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) fail('ARCHIVE_METHOD', `zip 里的 ${name} 用了不支持的压缩方法（${method}）`)

    const isDirectory = name.endsWith('/') || (externalAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIG) fail('ARCHIVE_INVALID', `${name} 的本地文件头不合法`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) fail('ARCHIVE_INVALID', `${name} 的数据越出文件边界`)

    let data = Buffer.alloc(0)
    if (!isDirectory) {
      if (uncompressedSize > limits.entryBytes) fail('ARCHIVE_TOO_LARGE', `${name} 解压后 ${uncompressedSize} 字节，超过单文件上限 ${limits.entryBytes}`)
      totalBytes += uncompressedSize
      if (totalBytes > limits.totalBytes) fail('ARCHIVE_TOO_LARGE', `解压总大小超过上限 ${limits.totalBytes}`)
      const payload = buffer.subarray(dataStart, dataEnd)
      try {
        data = method === METHOD_STORE
          ? Buffer.from(payload)
          : inflateRawSync(payload, { maxOutputLength: limits.entryBytes })
      } catch (error) {
        fail('ARCHIVE_INVALID', `${name} 解压失败：${error?.message ?? String(error)}`)
      }
      if (data.length !== uncompressedSize) fail('ARCHIVE_INVALID', `${name} 的解压长度与目录记录不一致`)
      if (crc32(data) !== crc) fail('ARCHIVE_CRC', `${name} 的 CRC32 校验失败，压缩包已损坏`)
    }
    entries.push({ name, directory: isDirectory, data, size: data.length })
  }
  return { entries, totalBytes }
}

/** 全部条目共用的唯一顶层目录名；不满足条件返回 null。 */
function singleRootOf(entries) {
  const tops = new Set()
  for (const entry of entries) {
    const top = entry.name.replace(/\\/g, '/').split('/')[0]
    if (top === '') continue
    tops.add(top)
  }
  if (tops.size !== 1) return null
  const root = [...tops][0]
  const consistent = entries.every(entry => {
    const name = entry.name.replace(/\\/g, '/')
    return name === `${root}/` || name.startsWith(`${root}/`)
  })
  return consistent ? root : null
}

/**
 * 解压到目录。
 * @param input zip 路径或字节流
 * @param destination 目标目录（调用方负责保证它在允许范围内）
 * @param stripSingleRoot 包里只有一个顶层目录时剥掉它（"压缩文件夹"的还原语义）
 */
export async function extractZip(input, destination, { limits = ZIP_LIMITS, stripSingleRoot = false } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : await readBytes(input)
  const { entries } = readZip(buffer, { limits })
  const root = stripSingleRoot ? singleRootOf(entries) : null
  const files = []
  const directories = []
  let bytes = 0

  for (const entry of entries) {
    let name = entry.name.replace(/\\/g, '/')
    if (root !== null) {
      if (name === root || name === `${root}/`) continue
      if (!name.startsWith(`${root}/`)) fail('ARCHIVE_UNSAFE_PATH', `条目 ${entry.name} 不在单一顶层目录 ${root} 下`)
      name = name.slice(root.length + 1)
    }
    const checked = checkZipEntryName(name)
    if (!checked.ok) fail('ARCHIVE_UNSAFE_PATH', `zip 条目路径不安全（${entry.name}）：${checked.reason}`)
    const target = join(destination, ...checked.relative.split('/'))
    assertWithin(destination, target, 'zip 解压路径')
    if (entry.directory) {
      await ensureDir(target)
      directories.push(checked.relative)
      continue
    }
    await writeBytesAtomic(target, entry.data)
    files.push(checked.relative)
    bytes += entry.data.length
  }
  return { files, directories, bytes, root }
}

/**
 * 把一个目录打成 `<父目录>\<目录名>.zip`，**包内保留根目录名**（手工解压也能得到完整产物目录）。
 * 符号链接与非常规文件不进包（与 copyTree 的口径一致）。
 */
export async function zipDirectory(sourceDir, zipPath, { date = new Date(), prefix = null, limits = ZIP_LIMITS, list = listTree } = {}) {
  const tree = await list(sourceDir)
  if (tree.length > limits.entries) fail('ARCHIVE_TOO_LARGE', `目录里有 ${tree.length} 个条目，超过上限 ${limits.entries}`)
  const root = prefix === null ? basename(sourceDir) : prefix
  const entries = []
  for (const item of tree) {
    if (item.type === 'symlink' || item.type === 'other') continue
    if (item.type === 'directory') {
      entries.push({ name: `${root}/${item.rel}/`, directory: true })
      continue
    }
    entries.push({ name: `${root}/${item.rel}`, data: await readBytes(join(sourceDir, ...item.rel.split('/'))) })
  }
  const buffer = buildZip(entries, { date })
  await ensureDir(dirname(zipPath))
  await writeBytesAtomic(zipPath, buffer)
  return { zipPath, entries: entries.length, bytes: buffer.length, root }
}
