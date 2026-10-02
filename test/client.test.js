/**
 * 客户端半的宿主侧仿真：
 * 用假的 `window.__ModuleLoader__` 与假的 `react` 把 client/client.js 跑起来，
 * 断言"装载形状 / 注册形状 / 渲染结果"三件事 —— 不需要浏览器，也不需要打包工具。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

function makeReactStub(stateQueue = []) {
  let cursor = 0
  const effects = []
  return {
    effects,
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2).flat(Infinity).filter(child => child !== null && child !== undefined && child !== false)
      return { type, props: props || {}, children }
    },
    useState(initial) {
      const provided = cursor < stateQueue.length ? stateQueue[cursor] : undefined
      cursor += 1
      const value = provided !== undefined ? provided : (typeof initial === 'function' ? initial() : initial)
      return [value, () => {}]
    },
    useEffect(callback) { effects.push(callback) },
    useRef(value) { return { current: value } },
    useCallback(callback) { return callback },
    useMemo(factory) { return factory() },
    Fragment: 'Fragment',
  }
}

async function loadClient({ stateQueue = [], react } = {}) {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  const loaded = []
  const toasts = []
  const windowStub = { __ModuleLoader__: { load: spec => loaded.push(spec) } }
  const fetchStub = async (url, init) => {
    toasts.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ task: null, plugin: { id: 'brittle-backup', version: '0.1.0', artifactVersion: 1 }, services: {}, degradation: [], settings: { options: {} } }) }
  }
  const factory = new Function('window', 'fetch', 'console', 'setInterval', 'clearInterval', source)
  factory(windowStub, fetchStub, { warn: () => {}, log: () => {}, error: () => {} }, () => 0, () => {})
  assert.equal(loaded.length, 1, '客户端半必须调用一次 __ModuleLoader__.load')
  const reactStub = react || makeReactStub(stateQueue)
  const moduleExports = loaded[0].factory(name => {
    if (name === 'react') return reactStub
    throw new Error('客户端半 require 了未声明的模块：' + name)
  })
  return { spec: loaded[0], moduleExports, react: reactStub, fetchCalls: toasts }
}

function walk(element, visit) {
  if (element === null || element === undefined || typeof element !== 'object') return
  visit(element)
  const children = Array.isArray(element.children) ? element.children : []
  for (const child of children) {
    if (typeof child === 'string' || typeof child === 'number') visit({ type: '#text', props: {}, children: [String(child)] })
    else walk(child, visit)
  }
}

function textOf(element) {
  const parts = []
  walk(element, node => {
    if (node.type === '#text') parts.push(node.children.join(''))
    if (typeof node.children === 'object' && !Array.isArray(node.children)) parts.push(String(node.children))
  })
  return parts.join(' ')
}

function findAll(element, predicate) {
  const out = []
  walk(element, node => { if (predicate(node)) out.push(node) })
  return out
}

test('客户端半：装载形状与宿主契约一致（id / factory / 导出）', async () => {
  const { spec, moduleExports } = await loadClient()
  assert.equal(spec.id, 'dsh-brittlebackup', 'id 必须等于包名')
  assert.equal(typeof spec.factory, 'function')
  assert.equal(moduleExports.name, 'brittle-backup-ui')
  assert.deepEqual(moduleExports.inject, ['slots'])
  assert.equal(typeof moduleExports.apply, 'function')
})

test('客户端半：apply 注册一个 settings.section，id 自用、order=41、中文 label', async () => {
  const { moduleExports } = await loadClient()
  const injected = []
  const registered = []
  const ctx = {
    slots: {
      inject(name, callback) { injected.push(name); callback() },
      register(meta, component) { registered.push({ meta, component }); return () => {} },
    },
    inject() {},
  }
  moduleExports.apply(ctx)
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].meta.name, 'settings.section')
  assert.equal(registered[0].meta.id, 'brittle-backup', '必须用自己的 id，复用别人的会顶掉那一页')
  assert.equal(registered[0].meta.order, 41)
  assert.equal(registered[0].meta.label, '兜底备份')
  assert.equal(typeof registered[0].component, 'function')
})

test('客户端半：slots 服务缺失时不抛错（降级为无 UI）', async () => {
  const { moduleExports } = await loadClient()
  assert.doesNotThrow(() => moduleExports.apply({}))
  assert.doesNotThrow(() => moduleExports.apply({ slots: {} }))
})

test('客户端半：uiWorkspace 可用时应拿到 pickDirectory', async () => {
  const { moduleExports } = await loadClient()
  let picker = null
  const ctx = {
    slots: { inject(name, callback) { callback() }, register() { return () => {} } },
    inject(names, callback) {
      assert.deepEqual(names, ['uiWorkspace'])
      callback({ uiWorkspace: { pickDirectory: async () => 'F:\\picked' } })
    },
  }
  moduleExports.apply(ctx)
  picker = ctx.inject
  assert.equal(typeof picker, 'function')
})

test('客户端半：渲染出三个面板与勾选项（浅渲染，用假 react）', async () => {
  const snapshotState = {
    loading: false,
    error: null,
    notice: null,
    status: {
      plugin: { id: 'brittle-backup', version: '0.1.0', artifactVersion: 1 },
      services: { configEditor: true, pluginManager: true, credentials: true, skills: false },
      degradation: ['skills 服务不可用，元数据来自目录扫描'],
      settings: { options: { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true, compress: true } },
      task: null,
      picker: { allowlistSize: 0 },
    },
  }
  const { moduleExports, react } = await loadClient({
    stateQueue: [snapshotState, null, { export: '', import: '' }, null, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false, { detail: false, loading: false, report: null, error: null }],
  })
  const tree = moduleExports.Section()
  const text = textOf(tree)
  for (const expected of ['dsh-BrittleBackup', '① 导出备份', '② 导入还原', '③ 任务进度', 'skills 文件（连文件一起复制）', '打包成 zip（推荐）', '使用上次路径', '打开备份路径', '开始导出', '预览（只读）', '取消当前任务', '③ 备份配置查询 / 复制', '读取备份并生成查询文本', '复制全部内容', '下载文本']) {
    assert.ok(text.includes(expected), '页面应包含：' + expected)
  }
  assert.ok(text.includes('降级提示'), '降级提示应显示')

  const checkboxes = findAll(tree, node => node.type === 'input' && node.props.type === 'checkbox')
  assert.ok(checkboxes.length >= 7, '七个导出勾选项都要渲染出来（含"打包成 zip"）')
  const buttons = findAll(tree, node => node.type === 'button')
  const exportButton = buttons.find(node => node.children.includes('开始导出'))
  assert.ok(exportButton, '导出按钮必须存在')
  const pickButton = buttons.find(node => typeof node.children[0] === 'string' && node.children[0].indexOf('选择目录') === 0)
  assert.equal(pickButton.props.disabled, true, '宿主没给 picker 时选择按钮应禁用')
  assert.ok(react.effects.length >= 1, '挂载后应主动读一次状态')
})

test('客户端半：没有上次导出路径时「使用上次路径」禁用，有路径时可用并带 title', async () => {
  const inspectionState = null
  const base = (lastExportDir) => ({
    loading: false,
    error: null,
    notice: null,
    status: {
      plugin: { version: '0.1.0', artifactVersion: 1 },
      services: {},
      degradation: [],
      settings: { options: { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true, compress: true }, lastExportDir },
      task: null,
    },
  })
  const stateQueue = (lastExportDir) => [base(lastExportDir), null, { export: '', import: '' }, inspectionState, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false, { detail: false, loading: false, report: null, error: null }]

  const empty = await loadClient({ stateQueue: stateQueue('') })
  const emptyButtons = findAll(empty.moduleExports.Section(), node => node.type === 'button')
  const disabledLast = emptyButtons.find(node => node.children.includes('使用上次路径'))
  assert.equal(disabledLast.props.disabled, true, '没有历史路径时按钮必须禁用')
  assert.equal(disabledLast.props.title, '还没有成功导出过')
  const disabledOpen = emptyButtons.find(node => node.children.includes('打开备份路径'))
  assert.equal(disabledOpen.props.disabled, true, '既没填路径也没历史路径时不能打开')

  const filled = await loadClient({ stateQueue: stateQueue('F:\\backups') })
  const filledButtons = findAll(filled.moduleExports.Section(), node => node.type === 'button')
  const enabledLast = filledButtons.find(node => node.children.includes('使用上次路径'))
  assert.equal(enabledLast.props.disabled, false)
  assert.ok(enabledLast.props.title.includes('F:\\backups'))
})

test('客户端半：任务卡渲染进度条与彩色结论（成功 / 失败 / 取消）', async () => {
  const makeStatus = (task) => ({
    loading: false,
    error: null,
    notice: null,
    status: {
      plugin: { version: '0.1.0', artifactVersion: 1 },
      services: {},
      degradation: [],
      settings: { options: {} },
      task,
    },
  })
  const queue = (task) => [makeStatus(task), null, { export: '', import: '' }, null, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false, { detail: false, loading: false, report: null, error: null }]

  const running = { id: 't1', kind: 'export', phase: 'zip', message: '正在打包成 zip', percent: 80, progress: { done: 0, total: 0 }, warnings: [], canceled: false, startedAt: 'x', finishedAt: null, result: null, error: null }
  const runningTree = (await loadClient({ stateQueue: queue(running) })).moduleExports.Section()
  const runningText = textOf(runningTree)
  assert.ok(runningText.includes('进行中 · 正在打包成 zip'), runningText)
  assert.ok(runningText.includes('80%'), '进度百分比要显示出来')
  const bars = findAll(runningTree, node => node.type === 'div' && typeof node.props.style === 'object' && node.props.style.width === '80%')
  assert.equal(bars.length >= 1, true, '进度条内条宽度必须等于 percent')
  assert.equal(bars[0].props.style.background, '#1677ff', '进行中用蓝色')

  const done = { ...running, phase: 'done', message: '', percent: 100, finishedAt: 'y', result: { direction: 'export', dir: 'F:\\backups\\a.zip', packaging: 'zip', zipBytes: 2048, files: ['backup.json'], options: { profile: true, doc: true }, redactionCount: 1 } }
  const doneText = textOf((await loadClient({ stateQueue: queue(done) })).moduleExports.Section())
  assert.ok(doneText.includes('✓ 导出备份成功'), doneText)
  assert.ok(doneText.includes('最终完成时间：y'), doneText)
  assert.ok(doneText.includes('交付物：F:\\backups\\a.zip'))
  assert.ok(doneText.includes('zip 压缩包（2.0 KB）'), doneText)
  assert.ok(doneText.includes('已剥离疑似密钥 1 处'), doneText)
  assert.ok(doneText.includes('查看完整结果 JSON'), '完整 JSON 收进可展开的 details')

  const failed = { ...running, phase: 'failed', percent: 35, finishedAt: 'y', error: { code: 'SECRET_SCAN', message: '产物自查发现 2 处疑似密钥' } }
  const failedText = textOf((await loadClient({ stateQueue: queue(failed) })).moduleExports.Section())
  assert.ok(failedText.includes('✗ 导出备份失败'), failedText)
  assert.ok(failedText.includes('失败原因：产物自查发现 2 处疑似密钥（SECRET_SCAN）'), failedText)
  assert.ok(failedText.includes('35%'), '失败时进度停在断点')

  const canceled = { ...running, phase: 'apply', percent: 60, canceled: true, finishedAt: 'y' }
  const canceledText = textOf((await loadClient({ stateQueue: queue(canceled) })).moduleExports.Section())
  assert.ok(canceledText.includes('已取消（未完成）'), canceledText)
})

test('客户端半：验证结果摘要（人话）与完整表并存', async () => {
  const inspection = {
    bytes: 8123,
    blocked: false,
    blockedGlobal: [],
    source: 'zip',
    artifact: { producer: { dshVersion: '0.1.0' } },
    host: { dshVersion: '0.2.0-rc.2' },
    checksSummary: { blocked: false, blockedItems: 0, warnings: 2 },
    planSummary: { total: 3, selected: 2 },
    checks: [
      { id: 3, key: 'dsh-version', title: 'DSH 版本差异', level: 'warn', verdict: 'warning', detail: '产物来自 DSH 0.1.0，当前是 0.2.0-rc.2' },
      { id: 9, key: 'skills-same-name', title: 'skills 同名', level: 'warn', verdict: 'warning', detail: '1 个同名 skill 需要选择', items: [] },
      { id: 13, key: 'agents-running', title: 'agent 忙碌', level: 'block', verdict: 'ok', detail: '没有 agent 在运行' },
      { id: 14, key: 'missing-credentials', title: '密钥缺失', level: 'info', verdict: 'ok', detail: '需要补 2 项：A_KEY、B_KEY', items: [] },
    ],
    plan: [
      { id: 'config:llm-pi-ai', kind: 'config', ref: 'llm-pi-ai', action: 'merge', level: 'info', reason: '一致', selected: true, requiresConfirm: false, diff: [] },
      { id: 'plugin:dshmarket', kind: 'plugin', ref: 'dshmarket', action: 'install', level: 'warn', reason: '目标机未安装', selected: true, requiresConfirm: false, diff: [] },
      { id: 'file:pnpm-workspace.yaml', kind: 'file', ref: 'pnpm-workspace.yaml', action: 'confirm', level: 'warn', reason: 'allowBuilds 是代码执行许可', selected: false, requiresConfirm: true, diff: [] },
      { id: 'skill:only-list', kind: 'skill', ref: 'only-list', action: 'manual', level: 'block', reason: '只能手工', selected: false, requiresConfirm: false, diff: [] },
    ],
  }
  const { moduleExports } = await loadClient()
  const selection = { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }

  const summary = moduleExports.summarizeInspection(inspection, selection)
  assert.equal(summary.tone, 'warn')
  assert.equal(summary.headline, '可以还原，但有 2 项需要你确认')
  assert.deepEqual(summary.counts, { auto: 1, attention: 2, manual: 1 })
  assert.ok(summary.notes.some(note => note.text.includes('备份来自 DSH 0.1.0') && note.level === 'warn'))
  assert.ok(summary.notes.some(note => note.text.includes('同名 skill')))
  assert.ok(summary.notes.some(note => note.text.includes('需要补 2 项')))
  assert.ok(summary.notes.some(note => note.text.includes('代码执行许可')))

  // 取消勾选后计数实时变化
  const unchecked = moduleExports.summarizeInspection(inspection, { ...selection, off: { 'config:llm-pi-ai': true } })
  assert.equal(unchecked.counts.auto, 0)
  assert.equal(unchecked.counts.attention, 3)

  // 有全局拦截项 → 结论变成"不能自动还原"
  const blockedInspection = { ...inspection, blocked: true, blockedGlobal: [{ id: 13, title: 'agent 忙碌' }] }
  const blocked = moduleExports.summarizeInspection(blockedInspection, selection)
  assert.equal(blocked.tone, 'block')
  assert.ok(blocked.headline.includes('不能自动还原'))
})

test('客户端半：只调用已实现的路由，负载字段与路由契约一致', async () => {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  const called = [...source.matchAll(/request\(\s*'([^']+)'/g)].map(match => match[1])
  const implemented = ['/state', '/pick', '/export', '/inspect', '/import', '/cancel', '/open', '/query']
  assert.ok(source.includes("request('/query'") && source.includes("body: { sourceDir: dirs.import"), '查询请求必须发送备份来源目录，避免调用错误端点')
  assert.ok(called.length >= 5, '客户端半应当调用这些路由')
  for (const path of called) {
    assert.ok(implemented.includes(path), `客户端调用了未实现的路由：${path}`)
  }
  for (const path of implemented) {
    assert.ok(called.includes(path), `客户端没有用到 ${path}`)
  }
  for (const key of ['targetDir', 'sourceDir', 'options', 'selection', 'taskId']) {
    assert.ok(source.includes(key), `负载字段缺失：${key}`)
  }
  assert.equal(/fetch\(\s*['"]https?:/i.test(source), false, '客户端不得请求外部地址')
  assert.equal(source.includes('localStorage'), false, '不在页面里持久化任何东西')
})

test('客户端半：没有可用选择器时，选择目录按钮禁用、登记路径仍可用', async () => {
  const snapshotState = { loading: false, error: null, notice: null, status: { plugin: {}, services: {}, degradation: [], settings: { options: {} }, task: null } }
  const { moduleExports } = await loadClient({
    stateQueue: [snapshotState, { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true }, { export: 'F:\\some\\dir', import: '' }, null, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false, { detail: false, loading: false, report: null, error: null }],
  })
  const tree = moduleExports.Section()
  const buttons = findAll(tree, node => node.type === 'button')
  const pick = buttons.find(node => typeof node.children[0] === 'string' && node.children[0].indexOf('选择目录') === 0)
  const register = buttons.find(node => node.children.includes('登记路径'))
  assert.equal(pick.props.disabled, true)
  assert.equal(register.props.disabled, false, '有输入路径时登记按钮可用')
})

test('客户端半：预览结果会被渲染成"人话摘要 + 可展开的 14 项验证表 + 可勾选计划"', async () => {
  const snapshotState = { loading: false, error: null, notice: null, status: { plugin: {}, services: {}, degradation: [], settings: { options: {} }, task: null } }
  const inspection = {
    bytes: 8123,
    blocked: false,
    blockedGlobal: [],
    source: 'zip',
    artifact: { producer: { dshVersion: '0.2.0-rc.2' } },
    host: { dshVersion: '0.2.0-rc.2' },
    checksSummary: { blocked: false, blockedItems: 0, warnings: 2 },
    planSummary: { total: 3, selected: 2 },
    checks: [
      { id: 1, key: 'format-version', title: '产物 format / version', level: 'block', verdict: 'ok', detail: '通过闸门' },
      { id: 13, key: 'agents-running', title: 'agent 忙碌', level: 'block', verdict: 'ok', detail: '没有 agent 在运行' },
    ],
    plan: [
      { id: 'config:llm-pi-ai', kind: 'config', ref: 'llm-pi-ai', action: 'merge', level: 'info', reason: '与目标机一致', selected: true, requiresConfirm: false, diff: [{ pointer: '/override/x', before: 1, after: 2 }] },
      { id: 'file:pnpm-workspace.yaml', kind: 'file', ref: 'pnpm-workspace.yaml', action: 'confirm', level: 'warn', reason: 'allowBuilds 是代码执行许可', selected: false, requiresConfirm: true, diff: [] },
      { id: 'plugin:dshmarket', kind: 'plugin', ref: 'dshmarket', action: 'install', level: 'warn', reason: '目标机未安装', selected: true, requiresConfirm: false, diff: [] },
      { id: 'credential:XIUXIAN_API_KEY', kind: 'credential', ref: 'XIUXIAN_API_KEY', action: 'report', level: 'info', reason: '状态：missing', selected: false, requiresConfirm: false, diff: [] },
    ],
  }
  const { moduleExports } = await loadClient({
    stateQueue: [snapshotState, { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true, compress: true }, { export: '', import: 'F:\\backups\\dsh-brittle-backup-20261002-110509.zip' }, inspection, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false, { detail: false, loading: false, report: null, error: null }],
  })
  const tree = moduleExports.Section()
  const text = textOf(tree)

  // 抽象概述在前：一句结论 + 三个计数 + 大白话提示
  assert.ok(text.includes('可以还原，但有 2 项需要你确认'), text)
  assert.ok(text.includes('可直接恢复 1 项'), text)
  assert.ok(text.includes('需要注意 2 项'), text)
  assert.ok(text.includes('只能手工 0 项'), text)

  // 完整验证结果表仍然提供，但收进可展开的 details
  assert.ok(text.includes('查看验证结果表（14 项兼容性验证）'))
  const checkDetails = findAll(tree, node => node.type === 'details')
    .find(node => textOf({ type: 'x', props: {}, children: node.children }).includes('查看验证结果表'))
  assert.ok(checkDetails, '验证表必须有 details 容器')
  assert.equal(checkDetails.props.open, undefined, '完整验证表默认收起（要"看细节"时再展开）')

  assert.ok(text.includes('要还原的内容（4 项，逐项可勾选）'))
  assert.ok(text.includes('pnpm-workspace.yaml'))
  assert.ok(text.includes('来源是 zip 压缩包'))
  assert.ok(text.includes('开始导入'))
  assert.ok(text.includes('我确认要还原 pnpm-workspace.yaml 的 allowBuilds'))

  const checkboxIds = findAll(tree, node => node.type === 'input' && node.props.type === 'checkbox').length
  assert.ok(checkboxIds >= 2, '可自动恢复的计划项应有勾选框')
  const importButton = findAll(tree, node => node.type === 'button').find(node => node.children.includes('开始导入'))
  assert.equal(importButton.props.disabled, false)
})
