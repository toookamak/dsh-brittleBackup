/**
 * 安全回归：这两条曾经能真实造成破坏，所以单独成文件钉死。
 *
 *   1. `skills[].name` 未校验 → `{name:'..'}` 会让 `apply.js` 把
 *      `join(skillsRoot, '..')` 当成删除目标，`removeTree` 直接抹掉整个 `<DSH_HOME>`。
 *   2. `skills\` 目录内的文件从不做内容扫描（SECURITY.md §2.3 防线③ 承诺"复制前逐文件扫描"），
 *      产物里会带出明文密钥。
 *
 * 两条都必须在**产物校验层**与**写入层**各挡一次。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { validateArtifact, writeArtifact } from '../src/artifact.js'
import { checkNameSegment } from '../src/paths.js'
import { ensureDir, pathExists, readTextFile } from '../src/nodefs.js'
import { runExport } from '../src/export.js'
import { DEFAULT_OPTIONS } from '../src/settings.js'
import { makeFakeHost } from './helpers/fake-host.js'
import { sampleArtifact } from './helpers/sample-artifact.js'

/** 绕开 buildArtifact 的归一化，直接手搓一份"结构合法但 name 恶意"的产物。 */
function hostileArtifact(skill) {
  const base = sampleArtifact()
  return {
    ...base,
    items: {
      ...base.items,
      skills: [{ description: '', scope: 'user', files: 1, included: true, ...skill }],
    },
  }
}

test('产物校验：skills 名称必须是单个安全目录名', () => {
  for (const name of ['..', '.', '../..', 'a/b', 'a\\b', 'C:', 'x:', 'nul\u0000name', ' leading', 'trailing.', 'a*b', 'con.']) {
    const checked = checkNameSegment(name)
    assert.equal(checked.ok, false, `${JSON.stringify(name)} 必须被判为不安全的名字`)
  }
  // 正常的（含中文 / emoji / 短横线）必须放行
  for (const name of ['example-skill', 'my_skill', '技能包', 'skill.v2', 'a', 'S']) {
    assert.equal(checkNameSegment(name).ok, true, `${JSON.stringify(name)} 应当是合法名字`)
  }
})

test('产物校验：{name:"..", path:"skills/x"} 无法通过（原来的穿越入口）', () => {
  const artifact = hostileArtifact({ name: '..', path: 'skills/x' })
  const checked = validateArtifact(artifact)
  assert.equal(checked.ok, false, '带 ".." 的 skill 名必须让整份产物校验失败')
  assert.ok(
    checked.errors.some(error => error.includes('skill 名称不安全')),
    `错误信息要点名 skill 名不安全，实际：${JSON.stringify(checked.errors)}`,
  )
})

test('产物校验：其它越界名字同样被拒（盘符 / 分隔符 / 绝对路径形态）', () => {
  for (const name of ['../evil', 'C:\\evil', '/etc', 'a/b']) {
    const checked = validateArtifact(hostileArtifact({ name, path: `skills/${name.replace(/[\\:]/g, '_')}` }))
    assert.equal(checked.ok, false, `${JSON.stringify(name)} 必须被拒`)
  }
})

test('写入层：即使绕过产物校验，apply 也不会越出 skillsRoot', async () => {
  const host = await makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: {} } }],
    skills: { 'keep-me': { 'SKILL.md': '# keep' } },
  })
  const sentinel = join(host.env.DSH_HOME, 'top-secret-model.json')
  await ensureDir(host.env.DSH_HOME)
  await ensureDir(sentinel.replace(/[^\\/]+$/, ''))
  const { writeTextAtomic } = await import('../src/nodefs.js')
  await writeTextAtomic(sentinel, '{"secret":1}')

  // 直接构造一个绕过 validateArtifact 的 skill 项，走 applyPlan 的写入分支。
  const { applyPlan } = await import('../src/restore/apply.js')
  const artifactDir = join(host.root, 'artifact')
  await ensureDir(artifactDir)

  const report = await applyPlan({
    ctx: host.ctx,
    env: host.env,
    artifactDir,
    plan: [{ id: 'skill:..', kind: 'skill', ref: '..', action: 'copy', level: 'info', selected: true, reason: 'x', requiresConfirm: false }],
    artifact: sampleArtifact(),
    task: null,
  })

  assert.ok(
    report.failed.some(item => item.kind === 'skill'),
    '越界的 skill 写入必须进 failed，而不是 applied',
  )
  assert.equal(report.applied.some(item => item.kind === 'skill'), false)
  // 关键断言：<DSH_HOME> 必须完好无损
  assert.equal(await pathExists(join(host.env.DSH_HOME, 'skills', 'keep-me', 'SKILL.md')), true, '既有 skill 不能被删')
  assert.equal(await pathExists(join(host.env.DSH_HOME, 'top-secret-model.json')), true, '整个 <DSH_HOME> 不能被删')
  assert.equal(await readTextFile(sentinel), '{"secret":1}')
})

test('防线③：skill 文件里扫到疑似密钥 → 该文件不进产物，并如实报出', async () => {
  const host = await makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: {} } }],
    skills: {
      'skill-a': {
        'SKILL.md': '# 说明\n这里是正常文档。\n',
        'assets/logo.bin': 'binary-content-a',
        '.env': 'OPENAI_API_KEY=sk-live-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n',
      },
    },
  })
  const exportRoot = join(host.root, 'backups')
  await ensureDir(exportRoot)

  const report = await runExport({
    ctx: host.ctx,
    env: host.env,
    targetDir: exportRoot,
    options: { ...DEFAULT_OPTIONS, skillFiles: true, compress: false },
  })

  const withheld = report.skillCopy.withheld ?? []
  assert.ok(withheld.length >= 1, '含密钥的 skill 文件必须被记录为 withheld')
  assert.ok(withheld.some(item => item.skill === 'skill-a' && item.rel === '.env'), `实际 withheld：${JSON.stringify(withheld)}`)

  // 产物里绝不能出现那段明文
  const dir = report.dir
  assert.equal(await pathExists(join(dir, 'skills', 'skill-a', '.env')), false, '带密钥的文件不得写进产物')
  // 但正常文件必须还在：不能因为一个文件就丢掉整个 skill
  assert.equal(await pathExists(join(dir, 'skills', 'skill-a', 'SKILL.md')), true, '干净文件仍然要导出')
  assert.equal(await pathExists(join(dir, 'skills', 'skill-a', 'assets', 'logo.bin')), true, '二进制资产仍然要逐字节导出')

  // 用户必须被明确告知
  assert.ok(
    report.warnings.some(text => text.includes('未写入产物') && text.includes('.env')),
    `导出报告里必须有醒目警告，实际：${JSON.stringify(report.warnings)}`,
  )
})

test('防线③：干净的 skill 目录不会被误伤', async () => {
  const host = await makeFakeHost({
    records: [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', override: { providers: {} } }],
    skills: { 'skill-a': { 'SKILL.md': '# 说明\nmaxTokens: 256000\ntokenPath: /a/b\n' } },
  })
  const exportRoot = join(host.root, 'backups')
  await ensureDir(exportRoot)
  const report = await runExport({
    ctx: host.ctx,
    env: host.env,
    targetDir: exportRoot,
    options: { ...DEFAULT_OPTIONS, skillFiles: true, compress: false },
  })
  assert.deepEqual(report.skillCopy.withheld, [], '不含密钥的 skill 不该被拦')
  assert.equal(await pathExists(join(report.dir, 'skills', 'skill-a', 'SKILL.md')), true)
})
