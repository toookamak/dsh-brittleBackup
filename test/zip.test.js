/**
 * ZIP 读写（体验优化项 2）：
 *   1. 打包 / 解包往返：中文名、二进制、子目录、空目录；
 *   2. 安全：zip-slip、绝对路径、加密项、符号链接、CRC 不符、超上限，一律拒绝；
 *   3. `zipDirectory` + `extractZip(stripSingleRoot)` 的"压缩文件夹"语义。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildZip, crc32, checkZipEntryName, extractZip, readZip, zipDirectory, ZIP_LIMITS } from '../src/zip.js'
import { ensureDir, listTree, pathExists, readBytes, readTextFile, writeTextAtomic } from '../src/nodefs.js'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50

function findEocd(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset
  }
  throw new Error('测试里找不到 EOCD，说明 buildZip 的输出坏了')
}

function centralEntries(buffer) {
  const eocd = findEocd(buffer)
  const total = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const out = []
  for (let index = 0; index < total; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), CENTRAL_SIG)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    out.push({
      offset: cursor,
      name: buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      flags: buffer.readUInt16LE(cursor + 8),
      method: buffer.readUInt16LE(cursor + 10),
      crc: buffer.readUInt32LE(cursor + 16),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localOffset: buffer.readUInt32LE(cursor + 42),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return out
}

test('zip：crc32 用标准测试向量', () => {
  assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926)
  assert.equal(crc32(Buffer.alloc(0)), 0)
})

test('zip：打包 → 解包往返（中文名、二进制、子目录、空目录、UTF-8 标志位）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-zip-'))
  const binary = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x7f, 0x80])
  const buffer = buildZip([
    { name: 'dsh-brittle-backup-20261002-110509/backup.json', data: '{"a":1}' },
    { name: 'dsh-brittle-backup-20261002-110509/兜底文档.md', data: '# 中文文档\n内容\n' },
    { name: 'dsh-brittle-backup-20261002-110509/skills/', directory: true },
    { name: 'dsh-brittle-backup-20261002-110509/skills/空目录/', directory: true },
    { name: 'dsh-brittle-backup-20261002-110509/skills/skill-a/logo.bin', data: binary },
  ], { date: new Date(2026, 9, 2, 11, 5, 9) })

  const central = centralEntries(buffer)
  assert.equal(central.length, 5)
  assert.ok(central.every(entry => (entry.flags & 0x0800) !== 0), '必须写 UTF-8 名字位，否则中文名会乱码')
  assert.equal(central.find(entry => entry.name.endsWith('兜底文档.md')).name, 'dsh-brittle-backup-20261002-110509/兜底文档.md')

  const parsed = readZip(buffer)
  assert.equal(parsed.entries.length, 5)
  const doc = parsed.entries.find(entry => entry.name.endsWith('兜底文档.md'))
  assert.equal(doc.data.toString('utf8'), '# 中文文档\n内容\n')
  const logo = parsed.entries.find(entry => entry.name.endsWith('logo.bin'))
  assert.deepEqual(logo.data, binary, '二进制必须逐字节一致')
  assert.equal(parsed.entries.find(entry => entry.name.endsWith('空目录/')).directory, true)

  const result = await extractZip(buffer, root, { stripSingleRoot: true })
  assert.equal(result.root, 'dsh-brittle-backup-20261002-110509')
  assert.equal(await readTextFile(join(root, 'backup.json')), '{"a":1}')
  assert.deepEqual(await readBytes(join(root, 'skills', 'skill-a', 'logo.bin')), binary, '二进制必须逐字节一致')
  assert.equal(await pathExists(join(root, 'skills', '空目录')), true, '空目录要保留')
})

test('zip：目录打包 → 解压回来结构与内容一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-zipdir-'))
  const source = join(root, 'dsh-brittle-backup-20261002-120000')
  await ensureDir(join(source, 'skills', 'skill-a', 'assets'))
  await writeTextAtomic(join(source, 'backup.json'), '{"format":"x"}\n')
  await writeTextAtomic(join(source, '兜底文档.md'), '# doc\n')
  await writeTextAtomic(join(source, 'skills', 'skill-a', 'assets', 'logo.bin'), 'binary-content-a')

  const zipPath = `${source}.zip`
  const zipped = await zipDirectory(source, zipPath)
  assert.equal(zipped.root, 'dsh-brittle-backup-20261002-120000')
  assert.equal(await pathExists(zipPath), true)

  const destination = join(root, 'out')
  await extractZip(zipPath, destination, { stripSingleRoot: true })
  const tree = (await listTree(destination)).map(entry => `${entry.type}:${entry.rel}`)
  assert.deepEqual(tree.sort(), [
    'directory:skills',
    'directory:skills/skill-a',
    'directory:skills/skill-a/assets',
    'file:backup.json',
    'file:skills/skill-a/assets/logo.bin',
    'file:兜底文档.md',
  ].sort())
  assert.equal(await readTextFile(join(destination, 'skills', 'skill-a', 'assets', 'logo.bin')), 'binary-content-a')
})

test('zip：条目名安全校验拒绝穿越 / 绝对路径 / 盘符 / NUL', () => {
  assert.equal(checkZipEntryName('../evil.txt').ok, false)
  assert.equal(checkZipEntryName('a/../../evil.txt').ok, false)
  assert.equal(checkZipEntryName('/etc/passwd').ok, false)
  assert.equal(checkZipEntryName('C:\\Windows\\win.ini').ok, false)
  assert.equal(checkZipEntryName('a\0b').ok, false)
  assert.equal(checkZipEntryName('').ok, false)
  assert.equal(checkZipEntryName('node_modules/x.js').ok, true, '压缩包不套用导入侧的排除名单')
  assert.deepEqual(checkZipEntryName('skills/a/./b.txt'), { ok: true, relative: 'skills/a/b.txt' })
})

test('zip：解包时 zip-slip 条目被拒绝，且不在目标外落任何文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-zipslip-'))
  const destination = join(root, 'out')
  await ensureDir(destination)
  const buffer = buildZip([
    { name: 'ok.txt', data: 'ok' },
    { name: '../escape.txt', data: 'nope' },
  ])
  await assert.rejects(() => extractZip(buffer, destination), error => error?.code === 'ARCHIVE_UNSAFE_PATH')
  assert.equal(await pathExists(join(root, 'escape.txt')), false)
})

test('zip：加密项 / 符号链接 / CRC 不符 / 压缩方法未知 都会被拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brittle-zipbad-'))
  const destination = join(root, 'out')

  // ① 加密位
  const encrypted = buildZip([{ name: 'secret.txt', data: 'x' }])
  const encryptedCentral = centralEntries(encrypted)[0]
  encrypted.writeUInt16LE(encrypted.readUInt16LE(encryptedCentral.offset + 8) | 0x0001, encryptedCentral.offset + 8)
  assert.throws(() => readZip(encrypted), error => error?.code === 'ARCHIVE_ENCRYPTED')

  // ② 符号链接（unix 模式放在外部属性的高 16 位）
  const symlink = buildZip([{ name: 'link', data: 'target' }])
  const symlinkCentral = centralEntries(symlink)[0]
  symlink.writeUInt32LE(0xa1ff0000, symlinkCentral.offset + 38)
  assert.throws(() => readZip(symlink), error => error?.code === 'ARCHIVE_SYMLINK')

  // ③ 数据被改一个字节 → CRC 不符（用 store 方式，避免 deflate 流本身先报错）
  const corrupted = buildZip([{ name: 'data.txt', data: 'hello world hello world', store: true }])
  const corruptedCentral = centralEntries(corrupted)[0]
  const dataOffset = corruptedCentral.localOffset + 30 + Buffer.byteLength('data.txt', 'utf8')
  corrupted.writeUInt8(corrupted.readUInt8(dataOffset) ^ 0xff, dataOffset)
  assert.throws(() => readZip(corrupted), error => error?.code === 'ARCHIVE_CRC')

  // ④ 未知压缩方法
  const unknownMethod = buildZip([{ name: 'data.txt', data: 'hello' }])
  const unknownCentral = centralEntries(unknownMethod)[0]
  unknownMethod.writeUInt16LE(99, unknownCentral.offset + 10)
  assert.throws(() => readZip(unknownMethod), error => error?.code === 'ARCHIVE_METHOD')

  // ⑤ 不是 zip
  assert.throws(() => readZip(Buffer.from('this is not a zip')), error => error?.code === 'ARCHIVE_INVALID')
  assert.equal(await pathExists(destination), false, '这些拒绝路径都不该写盘')
})

test('zip：条目数与体积上限生效（防 zip 炸弹）', () => {
  const two = buildZip([{ name: 'a.txt', data: 'a' }, { name: 'b.txt', data: 'b' }])
  assert.throws(() => readZip(two, { limits: { ...ZIP_LIMITS, entries: 1 } }), error => error?.code === 'ARCHIVE_TOO_LARGE')

  const big = buildZip([{ name: 'big.txt', data: Buffer.alloc(4096, 0x61) }])
  assert.throws(() => readZip(big, { limits: { ...ZIP_LIMITS, entryBytes: 1024 } }), error => error?.code === 'ARCHIVE_TOO_LARGE')

  const archive = buildZip([{ name: 'a.txt', data: 'a' }])
  assert.throws(() => readZip(archive, { limits: { ...ZIP_LIMITS, archiveBytes: 4 } }), error => error?.code === 'ARCHIVE_TOO_LARGE')
})
