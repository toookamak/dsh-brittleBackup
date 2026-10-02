/**
 * 完整性检查（M5 的自动化部分）：
 *   1. 从 `src/index.js` 出发，`src/` 下每个模块都必须可达（没有孤儿文件）；
 *   2. `src/` 不得引用 `test/` 或 `scripts/`；客户端半不得引用宿主半的内部模块；
 *   3. `package.json` 引用的每个路径都必须真实存在（main / exports / dsh.bundle.patch / files）；
 *   4. README 里链接的 docs 文件必须都存在。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

function importSpecifiers(source) {
  const specs = []
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1])
  }
  return specs
}

test('完整性：src/ 下没有孤儿模块（都能从 index.js 走到）', async () => {
  const files = await walk(join(repoRoot, 'src'))
  const reachable = new Set()
  const queue = [join(repoRoot, 'src', 'index.js')]
  while (queue.length > 0) {
    const file = queue.pop()
    if (reachable.has(file)) continue
    reachable.add(file)
    const source = await readFile(file, 'utf8')
    for (const spec of importSpecifiers(source)) {
      if (!spec.startsWith('.')) continue
      queue.push(resolve(dirname(file), spec))
    }
  }
  const orphans = files.filter(file => !reachable.has(file)).map(file => relative(repoRoot, file))
  assert.deepEqual(orphans, [], '这些模块没有被任何入口引用：' + orphans.join('、'))
})

test('完整性：src/ 不引用 test/ 或 scripts/，客户端半不引用宿主半内部模块', async () => {
  for (const file of await walk(join(repoRoot, 'src'))) {
    const source = await readFile(file, 'utf8')
    for (const spec of importSpecifiers(source)) {
      const bad = /(^|\/)(test|scripts)\//.test(spec)
      assert.equal(bad, false, `${relative(repoRoot, file)} 引用了 ${spec}`)
    }
  }
  const client = await readFile(join(repoRoot, 'client', 'client.js'), 'utf8')
  assert.equal(client.includes("require('react')"), true)
  assert.equal(/require\(['"]\.\.?\//.test(client), false, '客户端半只能 require 宿主的模块表，不能相对引用宿主半源码')
})

test('完整性：package.json 引用的路径都存在', async () => {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  const normalize = value => String(value).replace(/^\.\//, '')
  const referenced = [pkg.main, ...Object.values(pkg.exports || {}), pkg.dsh.bundle.patch].map(normalize)
  for (const rel of referenced) {
    if (typeof rel !== 'string' || rel.includes('*')) continue
    const info = await stat(join(repoRoot, rel)).catch(() => null)
    assert.ok(info && info.isFile(), `package.json 引用的 ${rel} 不存在`)
    // package.json / README / LICENSE 由 npm 自动包含，不写进 files 也不会漏。
    if (['package.json', 'README.md', 'LICENSE'].includes(rel)) continue
    assert.equal(
      pkg.files.some(entry => normalize(entry) === rel || rel.startsWith(normalize(entry) + '/')),
      true,
      `${rel} 没有被 files 覆盖，打包会漏掉`,
    )
  }
})

test('完整性：README 链接的 docs 文件都存在', async () => {
  const readme = await readFile(join(repoRoot, 'README.md'), 'utf8')
  const links = [...readme.matchAll(/\]\((docs\/[^)#]+)(#[^)]*)?\)/g)].map(match => match[1])
  assert.ok(links.length >= 4, 'README 应该链接到 docs 下的四份文档')
  for (const link of new Set(links)) {
    const info = await stat(join(repoRoot, link)).catch(() => null)
    assert.ok(info && info.isFile(), `README 链接的 ${link} 不存在`)
  }
})

test('完整性：文档里的关键状态与仓库现状一致', async () => {
  const readme = await readFile(join(repoRoot, 'README.md'), 'utf8')
  const plan = await readFile(join(repoRoot, 'docs', 'PROJECT-PLAN.md'), 'utf8')
  assert.equal(/尚未创建/.test(readme), false, 'README 不该再说 client/ 尚未创建')
  assert.equal(/M0–M2 已实现/.test(readme), false, 'README 的状态段应已更新到 M0–M4')
  assert.ok(plan.includes('### 17.8 实现进度与验证证据'), 'PROJECT-PLAN 必须保留实现进度节')
  assert.ok(readme.includes('## 安装到 DSH（本地路径）'), 'README 必须给出安装步骤')
  assert.ok(readme.includes('scripts/doc-audit.mjs'), 'README 必须提到文档审计脚本')
})
