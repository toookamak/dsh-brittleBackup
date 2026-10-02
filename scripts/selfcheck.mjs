/**
 * 仓库自检（`npm run check`）：
 *   1. 对 src/ 与 test/ 下每个 .js 跑 `node --check`；
 *   2. 断言仓库里**没有网络代码**（SCOPE-PHASE1 §6 最后一条验收）；
 *   3. 断言产物的关键不变量在代码里仍然成立（凭据只 describe、不读 .credentials.yaml）。
 *
 * 只用 Node 内置模块，零依赖。
 */
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptsDir, '..')

const FORBIDDEN = [
  { pattern: /from\s+['"]node:https['"]/, reason: '禁止 node:https' },
  { pattern: /from\s+['"]node:net['"]/, reason: '禁止 node:net' },
  { pattern: /from\s+['"]node:tls['"]/, reason: '禁止 node:tls' },
  { pattern: /from\s+['"]undici['"]/, reason: '禁止 undici' },
  {
    // 浏览器里的 fetch 只用来打本插件自己的本机路由，不是出网能力；
    // 宿主半（src/）里任何 fetch 都是错的。
    pattern: /\bfetch\s*\(/,
    reason: '禁止 fetch()（宿主半不得出网）',
    allowPath: /[\\/]client[\\/]/,
  },
  { pattern: /XMLHttpRequest/, reason: '禁止 XMLHttpRequest' },
  { pattern: /webdav/i, reason: '本阶段不含 WebDAV' },
  { pattern: /api\.github\.com/, reason: '本阶段不含 GitHub 调用' },
  {
    // 只禁止"真的读写"它：把它写进排除名单（paths.js 的 EXCLUDED_SEGMENTS）是正确做法。
    pattern: /\.credentials\.yaml/,
    reason: '禁止读写 .credentials.yaml',
    lineScoped: true,
    lineAllow: /readFile|writeFile|appendFile|createReadStream|createWriteStream|readTextFile|writeTextAtomic|writeJsonAtomic|copyFile|JSON\.parse/,
  },
]

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      out.push(...await walk(path))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

const srcFiles = await walk(join(repoRoot, 'src'))
const clientFiles = await walk(join(repoRoot, 'client'))
const testFiles = await walk(join(repoRoot, 'test'))
const targets = [...srcFiles, ...clientFiles, ...testFiles].sort()

let failures = 0
for (const file of targets) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (checked.status !== 0) {
    failures += 1
    console.error(`✗ 语法检查失败：${relative(repoRoot, file)}\n${checked.stderr}`)
  }
}

for (const file of targets) {
  const text = await readFile(file, 'utf8')
  for (const rule of FORBIDDEN) {
    const { pattern, reason, lineScoped, lineAllow, allowPath } = rule
    if (allowPath !== undefined && allowPath.test(file)) continue
    const hit = lineScoped === true
      ? text.split(/\r?\n/).some(line => pattern.test(line) && (lineAllow === undefined ? true : lineAllow.test(line)))
      : pattern.test(text)
    if (hit) {
      failures += 1
      console.error(`✗ ${relative(repoRoot, file)}：${reason}（命中 ${pattern}）`)
    }
  }
}

const sourceCount = targets.filter(path => path.includes(`${'src'}`)).length

// ---- 打包 / 装载契约（装到 DSH 里能不能被认出来，全靠这些字段） ----
const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const patch = await readFile(join(repoRoot, 'cordis.patch.yml'), 'utf8')
const clientSource = await readFile(join(repoRoot, 'client', 'client.js'), 'utf8')
const packageChecks = [
  [pkg.type === 'module', 'package.json 的 type 必须是 module'],
  [pkg.main === 'src/index.js', 'main 必须指向 src/index.js'],
  [pkg.exports && pkg.exports['.'] === './src/index.js', 'exports["."] 必须指向 src/index.js'],
  [pkg.exports && pkg.exports['./client'] === './client/client.js', 'exports["./client"] 必须指向 client/client.js'],
  [pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch 必须指向 cordis.patch.yml'],
  [pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform 必须是 web'],
  [Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.length > 0, 'dsh.client.inject 必须是非空数组'],
  [Array.isArray(pkg.files) && ['src', 'client', 'cordis.patch.yml', 'README.md'].every(entry => pkg.files.includes(entry)), 'files 必须包含 src / client / cordis.patch.yml / README.md'],
  [Object.keys(pkg.dependencies ?? {}).length === 0, '阶段一必须零运行时依赖'],
  [/^[a-z0-9][a-z0-9-]*$/.test(pkg.name), 'npm 包名必须全小写'],
  [/^\s*-\s*insert:\s*$/m.test(patch) && /id:\s*brittle-backup\s*$/m.test(patch) && /name:\s*'dsh-brittlebackup'\s*$/m.test(patch), 'cordis.patch.yml 必须 insert id=brittle-backup / name=dsh-brittlebackup'],
  [clientSource.includes(`id: '${pkg.name}'`) || clientSource.includes(`id: "${pkg.name}"`), '客户端 bundle 的 __ModuleLoader__ id 必须等于包名'],
  [clientSource.includes("name: 'settings.section'"), '客户端必须注册到 settings.section'],
]
for (const [ok, message] of packageChecks) {
  if (!ok) {
    failures += 1
    console.error(`✗ 打包契约：${message}`)
  }
}

console.log(`${failures === 0 ? '✓' : '✗'} 自检完成：${targets.length} 个 JS 文件（src ${sourceCount} 个），${failures} 个问题`)
process.exit(failures === 0 ? 0 : 1)
