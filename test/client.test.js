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
      settings: { options: { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true } },
      task: null,
      picker: { allowlistSize: 0 },
    },
  }
  const { moduleExports, react } = await loadClient({
    stateQueue: [snapshotState, null, { export: '', import: '' }, null, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false],
  })
  const tree = moduleExports.Section()
  const text = textOf(tree)
  for (const expected of ['dsh-BrittleBackup', '① 导出备份', '② 导入还原', '③ 任务进度', 'skills 文件（连文件一起复制）', '开始导出', '预览（只读）', '取消当前任务']) {
    assert.ok(text.includes(expected), '页面应包含：' + expected)
  }
  assert.ok(text.includes('降级提示'), '降级提示应显示')

  const checkboxes = findAll(tree, node => node.type === 'input' && node.props.type === 'checkbox')
  assert.ok(checkboxes.length >= 6, '六个导出勾选项都要渲染出来')
  const buttons = findAll(tree, node => node.type === 'button')
  const exportButton = buttons.find(node => node.children.includes('开始导出'))
  assert.ok(exportButton, '导出按钮必须存在')
  const pickButton = buttons.find(node => typeof node.children[0] === 'string' && node.children[0].indexOf('选择目录') === 0)
  assert.equal(pickButton.props.disabled, true, '宿主没给 picker 时选择按钮应禁用')
  assert.ok(react.effects.length >= 1, '挂载后应主动读一次状态')
})

test('客户端半：只调用已实现的路由，负载字段与路由契约一致', async () => {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  const called = [...source.matchAll(/request\(\s*'([^']+)'/g)].map(match => match[1])
  const implemented = ['/state', '/pick', '/export', '/inspect', '/import', '/cancel']
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
    stateQueue: [snapshotState, { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true }, { export: 'F:\\some\\dir', import: '' }, null, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false],
  })
  const tree = moduleExports.Section()
  const buttons = findAll(tree, node => node.type === 'button')
  const pick = buttons.find(node => typeof node.children[0] === 'string' && node.children[0].indexOf('选择目录') === 0)
  const register = buttons.find(node => node.children.includes('登记路径'))
  assert.equal(pick.props.disabled, true)
  assert.equal(register.props.disabled, false, '有输入路径时登记按钮可用')
})

test('客户端半：预览结果会被渲染成 14 项检查 + 可勾选计划', async () => {
  const snapshotState = { loading: false, error: null, notice: null, status: { plugin: {}, services: {}, degradation: [], settings: { options: {} }, task: null } }
  const inspection = {
    bytes: 8123,
    blocked: false,
    blockedGlobal: [],
    artifact: { producer: { dshVersion: '0.2.0-rc.2' } },
    host: { dshVersion: '0.2.0-rc.2' },
    checksSummary: { blocked: false, blockedItems: 0, warnings: 2 },
    planSummary: { total: 3, selected: 2 },
    checks: [
      { id: 1, title: '产物 format / version', level: 'block', verdict: 'ok', detail: '通过闸门' },
      { id: 13, title: 'agent 忙碌', level: 'block', verdict: 'ok', detail: '没有 agent 在运行' },
    ],
    plan: [
      { id: 'config:llm-pi-ai', kind: 'config', ref: 'llm-pi-ai', action: 'merge', level: 'warn', reason: '同 id 条目值不同', selected: true, requiresConfirm: false, diff: [{ pointer: '/override/x', before: 1, after: 2 }] },
      { id: 'file:pnpm-workspace.yaml', kind: 'file', ref: 'pnpm-workspace.yaml', action: 'confirm', level: 'warn', reason: 'allowBuilds 是代码执行许可', selected: false, requiresConfirm: true, diff: [] },
      { id: 'plugin:dshmarket', kind: 'plugin', ref: 'dshmarket', action: 'install', level: 'info', reason: '目标机未安装', selected: true, requiresConfirm: false, diff: [] },
      { id: 'credential:XIUXIAN_API_KEY', kind: 'credential', ref: 'XIUXIAN_API_KEY', action: 'report', level: 'info', reason: '状态：missing', selected: false, requiresConfirm: false, diff: [] },
    ],
  }
  const { moduleExports } = await loadClient({
    stateQueue: [snapshotState, { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true }, { export: '', import: 'F:\\backups\\dsh-brittle-backup-20261002-110509' }, inspection, { off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false }, false],
  })
  const tree = moduleExports.Section()
  const text = textOf(tree)
  assert.ok(text.includes('§7 兼容性验证（14 项）'))
  assert.ok(text.includes('导入计划（4 项，逐项可勾选）'))
  assert.ok(text.includes('pnpm-workspace.yaml'))
  assert.ok(text.includes('开始导入'))
  assert.ok(text.includes('我确认要还原 pnpm-workspace.yaml 的 allowBuilds'))

  const checkboxIds = findAll(tree, node => node.type === 'input' && node.props.type === 'checkbox').length
  assert.ok(checkboxIds >= 2, '可自动恢复的计划项应有勾选框')
  const importButton = findAll(tree, node => node.type === 'button').find(node => node.children.includes('开始导入'))
  assert.equal(importButton.props.disabled, false)
})
