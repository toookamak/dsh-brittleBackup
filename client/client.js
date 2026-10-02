/**
 * 客户端半：一个顶层独立设置页（`settings.section`），承载导出 / 导入 / 任务进度。
 *
 * 手写、零构建：宿主用 `window.__ModuleLoader__.load({ id, factory })` 装载客户端半，
 * factory 里通过宿主提供的 `require()` 取外部模块（这里只取 `react`），
 * 最后把 `{ name, inject, apply }` 交回去 —— 形状与参考实现（dsh-market）一致。
 *
 * 与宿主通信只走 `/brittle-backup/*` 这五个路由（见 docs/PROJECT-PLAN.md §17.2），
 * 页面不直接碰文件系统。
 */
window.__ModuleLoader__.load({
  id: 'dsh-brittlebackup',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    var API = '/brittle-backup'
    var SECTION_ID = 'brittle-backup'

    /** 宿主服务句柄（apply 里通过嵌套 inject 填上；页面只读）。 */
    var host = { pickDirectory: null, hasPicker: false }

    function request(path, options) {
      var init = { method: 'GET', headers: { accept: 'application/json' } }
      if (options && options.body !== undefined) {
        init.method = 'POST'
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      return fetch(API + path, init).then(function (response) {
        return response.json().catch(function () { return null }).then(function (payload) {
          if (!response.ok) {
            var message = payload && payload.error ? payload.error.message : ('HTTP ' + response.status)
            var code = payload && payload.error ? payload.error.code : 'HTTP_' + response.status
            var error = new Error(message)
            error.code = code
            error.detail = payload && payload.error ? payload.error.detail : undefined
            throw error
          }
          return payload
        })
      })
    }

    function describeError(error) {
      if (!error) return '未知错误'
      var text = String(error.message || error)
      if (error.code === 'PICKER_NOT_ALLOWED') return text + '（请先用"选择目录"或"登记路径"）'
      if (error.code === 'CHECKS_BLOCKED') return text + '（有拦截级检查项，先把它们处理掉）'
      if (error.code === 'BUSY') return '已有任务在进行中，请等它结束或取消'
      return text
    }

    function formatBytes(value) {
      if (typeof value !== 'number' || !isFinite(value)) return '—'
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
      return (value / 1024 / 1024).toFixed(2) + ' MB'
    }

    var LEVEL_LABEL = { block: '拦截', warn: '警告', info: '信息' }
    var LEVEL_COLOR = { block: '#d4380d', warn: '#d48806', info: '#8c8c8c' }
    var ACTION_LABEL = {
      merge: '合并写入配置',
      manual: '只能照文档手工处理',
      write: '写入文件（已确认）',
      confirm: '需要显式确认',
      install: '安装插件',
      enable: '启用插件',
      disable: '禁用插件',
      keep: '保留目标机现状',
      copy: '写入 skill 文件',
      verify: '只核对清单',
      report: '只报告',
    }
    var KIND_LABEL = { config: '配置条目', file: '文件', plugin: '插件', skill: 'skill', credential: '密钥' }

    var styles = {
      page: { padding: '4px 2px 32px', fontSize: 13, lineHeight: 1.6, color: 'inherit', maxWidth: 900 },
      card: { border: '1px solid rgba(127,127,127,0.28)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 },
      title: { fontSize: 14, fontWeight: 600, margin: '0 0 8px' },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
      hint: { opacity: 0.72, fontSize: 12 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, wordBreak: 'break-all' },
      button: { padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.45)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
      buttonPrimary: { padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.45)', background: 'rgba(127,127,127,0.18)', color: 'inherit', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
      input: { padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.45)', background: 'transparent', color: 'inherit', fontSize: 12, flex: '1 1 320px', minWidth: 240 },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
      th: { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,0.28)', fontWeight: 600 },
      td: { padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,0.16)', verticalAlign: 'top' },
      pre: { margin: '6px 0 0', padding: 10, background: 'rgba(127,127,127,0.12)', borderRadius: 6, overflow: 'auto', maxHeight: 260, fontSize: 12 },
      banner: { borderRadius: 6, padding: '6px 10px', marginBottom: 10, fontSize: 12, border: '1px solid rgba(127,127,127,0.28)' },
    }

    function errorBanner(message) {
      if (!message) return null
      return h('div', { style: Object.assign({}, styles.banner, { borderColor: '#d4380d', color: '#d4380d' }) }, message)
    }

    function noticeBanner(message) {
      if (!message) return null
      return h('div', { style: Object.assign({}, styles.banner, { borderColor: '#1677ff' }) }, message)
    }

    function optionRow(key, label, checked, disabled, onChange) {
      return h('label', { key: key, style: { display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 16, opacity: disabled ? 0.5 : 1 } },
        h('input', { type: 'checkbox', checked: checked, disabled: disabled, onChange: function (event) { onChange(key, event.target.checked) } }),
        label)
    }

    function dirPicker(label, value, onChange, onPick, onRegister, disabled) {
      return h('div', { style: styles.row },
        h('span', { style: { minWidth: 64 } }, label),
        h('input', { style: styles.input, value: value || '', placeholder: '选择一个目录，或把绝对路径登记进来', onChange: function (event) { onChange(event.target.value) }, disabled: disabled }),
        h('button', { style: styles.button, onClick: onPick, disabled: disabled || !host.hasPicker }, host.hasPicker ? '选择目录…' : '选择目录（宿主不支持）'),
        h('button', { style: styles.button, onClick: onRegister, disabled: disabled || !value }, '登记路径'))
    }

    function taskPanel(task) {
      if (!task) return h('div', { style: styles.hint }, '当前没有进行中的任务。')
      var children = [
        h('div', { key: 'head', style: styles.row },
          h('strong', null, task.kind === 'export' ? '导出' : '导入'),
          h('span', { style: styles.hint }, '阶段：' + task.phase),
          h('span', { style: styles.hint }, task.progress && task.progress.total ? (task.progress.done + '/' + task.progress.total) : ''),
          task.canceled ? h('span', { style: { color: '#d48806' } }, '（已取消）') : null),
      ]
      if (task.message) children.push(h('div', { key: 'msg', style: styles.hint }, task.message))
      if (task.error) children.push(errorBanner('失败：' + task.error.message))
      if (task.warnings && task.warnings.length) {
        children.push(h('details', { key: 'warn' }, h('summary', { style: styles.hint }, '警告 ' + task.warnings.length + ' 条'),
          h('pre', { style: styles.pre }, task.warnings.join('\n'))))
      }
      if (task.result) {
        children.push(h('pre', { key: 'result', style: styles.pre }, JSON.stringify(task.result, null, 2)))
      }
      return h('div', null, children)
    }

    function inspectionPanel(inspection, selection, handlers) {
      if (!inspection) return h('div', { style: styles.hint }, '还没有预览。选好来源目录后点"预览"。')
      var checks = inspection.checks || []
      var plan = inspection.plan || []
      var children = []

      children.push(h('div', { key: 'summary', style: styles.row },
        h('span', null, '产物：' + formatBytes(inspection.bytes)),
        h('span', { style: styles.hint }, '来源 DSH ' + (inspection.artifact && inspection.artifact.producer ? inspection.artifact.producer.dshVersion : '?') + '，当前 ' + (inspection.host ? inspection.host.dshVersion : '?')),
        inspection.blocked ? h('span', { style: { color: '#d4380d', fontWeight: 600 } }, '有全局拦截项：'+ (inspection.blockedGlobal || []).map(function (item) { return item.title }).join('、')) : h('span', { style: { color: '#389e0d' } }, '没有全局拦截项')))

      if (inspection.checksSummary) {
        children.push(h('div', { key: 'cs', style: styles.hint }, '检查：拦截 ' + (inspection.checksSummary.blocked ? '有' : '无') + '　警告 ' + inspection.checksSummary.warnings + ' 项　计划 ' + inspection.planSummary.selected + '/' + inspection.planSummary.total + ' 已勾选'))
      }

      children.push(h('details', { key: 'checks', open: true },
        h('summary', { style: styles.title }, '§7 兼容性验证（14 项）'),
        h('table', { style: styles.table },
          h('thead', null, h('tr', null, h('th', { style: styles.th }, '#'), h('th', { style: styles.th }, '检查项'), h('th', { style: styles.th }, '级别'), h('th', { style: styles.th }, '结论'))),
          h('tbody', null, checks.map(function (check) {
            return h('tr', { key: check.id },
              h('td', { style: styles.td }, String(check.id)),
              h('td', { style: styles.td }, check.title),
              h('td', { style: Object.assign({}, styles.td, { color: LEVEL_COLOR[check.level] || 'inherit' }) }, LEVEL_LABEL[check.level] || check.level),
              h('td', { style: styles.td }, check.detail,
                check.action ? h('div', { style: styles.hint }, check.action) : null,
                check.items && check.items.length
                  ? h('ul', { style: { margin: '4px 0 0 16px', padding: 0 } }, check.items.slice(0, 12).map(function (entry, index) {
                    return h('li', { key: index, style: styles.hint }, entry.ref + (entry.reason ? '：' + entry.reason : ''))
                  }))
                  : null))
          })))))

      children.push(h('details', { key: 'plan', open: true },
        h('summary', { style: styles.title }, '导入计划（' + plan.length + ' 项，逐项可勾选）'),
        h('table', { style: styles.table },
          h('thead', null, h('tr', null,
            h('th', { style: styles.th }, '选'),
            h('th', { style: styles.th }, '类型'),
            h('th', { style: styles.th }, '对象'),
            h('th', { style: styles.th }, '动作'),
            h('th', { style: styles.th }, '说明'))),
          h('tbody', null, plan.map(function (entry) {
            var auto = ['merge', 'write', 'install', 'enable', 'disable', 'copy'].indexOf(entry.action) >= 0
            var disabled = !auto || (entry.requiresConfirm && !selection.ackBuildScripts)
            return h('tr', { key: entry.id },
              h('td', { style: styles.td }, auto
                ? h('input', {
                  type: 'checkbox',
                  checked: !selection.off[entry.id],
                  disabled: disabled,
                  onChange: function (event) { handlers.toggle(entry.id, event.target.checked) },
                })
                : '—'),
              h('td', { style: styles.td }, KIND_LABEL[entry.kind] || entry.kind),
              h('td', { style: styles.td }, entry.ref),
              h('td', { style: Object.assign({}, styles.td, { color: LEVEL_COLOR[entry.level] || 'inherit' }) }, ACTION_LABEL[entry.action] || entry.action),
              h('td', { style: styles.td }, entry.reason,
                entry.diff && entry.diff.length
                  ? h('details', null, h('summary', { style: styles.hint }, 'diff ' + entry.diff.length + ' 处'),
                    h('pre', { style: styles.pre }, entry.diff.map(function (change) {
                      return change.pointer + '\n  - ' + JSON.stringify(change.before) + '\n  + ' + JSON.stringify(change.after)
                    }).join('\n')))
                  : null))
          })))))

      if (plan.some(function (entry) { return entry.requiresConfirm })) {
        children.push(h('label', { key: 'ack', style: Object.assign({}, styles.row, { marginTop: 8 }) },
          h('input', { type: 'checkbox', checked: !!selection.ackBuildScripts, onChange: function (event) { handlers.ack(event.target.checked) } }),
          h('span', null, '我确认要还原 pnpm-workspace.yaml 的 allowBuilds（等于重新授权安装脚本运行）')))
      }

      children.push(h('div', { key: 'actions', style: styles.row },
        h('button', { style: styles.buttonPrimary, disabled: handlers.busy || inspection.blocked, onClick: handlers.run }, '开始导入'),
        h('span', { style: styles.hint }, inspection.blocked ? '存在全局拦截项，已禁止写入' : '写入前会自动快照，失败或取消会回滚')))

      return h('div', null, children)
    }

    function Section() {
      var state = React.useState({ loading: true, status: null, error: null, notice: null })
      var snapshot = state[0]
      var setSnapshot = state[1]

      var optionsState = React.useState(null)
      var options = optionsState[0]
      var setOptions = optionsState[1]

      var dirsState = React.useState({ export: '', import: '' })
      var dirs = dirsState[0]
      var setDirs = dirsState[1]

      var inspectionState = React.useState(null)
      var inspection = inspectionState[0]
      var setInspection = inspectionState[1]

      var selectionState = React.useState({ off: {}, overwriteSkills: [], overwritePlugins: [], ackBuildScripts: false })
      var selection = selectionState[0]
      var setSelection = selectionState[1]

      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      function refresh() {
        return request('/state').then(function (payload) {
          setSnapshot(function (previous) { return Object.assign({}, previous, { loading: false, status: payload, error: null }) })
          if (payload && payload.settings && payload.settings.options) {
            setOptions(function (previous) { return previous === null ? payload.settings.options : previous })
          }
          return payload
        }).catch(function (error) {
          setSnapshot(function (previous) { return Object.assign({}, previous, { loading: false, error: describeError(error) }) })
        })
      }

      React.useEffect(function () {
        refresh()
      }, [])

      React.useEffect(function () {
        var task = snapshot.status && snapshot.status.task
        if (!task) return undefined
        var running = !task.finishedAt
        if (!running) return undefined
        var timer = setInterval(function () { refresh() }, 1200)
        return function () { clearInterval(timer) }
      }, [snapshot.status && snapshot.status.task && snapshot.status.task.id, snapshot.status && snapshot.status.task && snapshot.status.task.phase])

      function notify(message) {
        setSnapshot(function (previous) { return Object.assign({}, previous, { notice: message }) })
      }
      function setDir(kind, value) {
        setDirs(function (previous) { var next = Object.assign({}, previous); next[kind] = value; return next })
      }

      function pick(kind) {
        if (!host.pickDirectory) return
        host.pickDirectory().then(function (picked) {
          if (typeof picked === 'string' && picked !== '') {
            setDir(kind, picked)
            return request('/pick', { body: { path: picked } }).then(function () { notify('已选定目录：' + picked) })
          }
          return undefined
        }).catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
      }

      function register(kind) {
        var value = kind === 'export' ? dirs.export : dirs.import
        request('/pick', { body: { path: value } }).then(function (payload) {
          notify('已登记目录：' + payload.path)
        }).catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
      }

      function toggleOption(key, value) {
        setOptions(function (previous) { var next = Object.assign({}, previous); next[key] = value; return next })
      }

      function runExport() {
        setBusy(true)
        request('/export', { body: { options: options, targetDir: dirs.export || null } }).then(function () {
          notify('导出任务已开始')
          refresh()
        }).catch(function (error) {
          setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) })
        }).then(function () { setBusy(false) })
      }

      function runInspect() {
        setBusy(true)
        request('/pick', { body: { path: dirs.import } })
          .then(function () { return request('/inspect', { body: { sourceDir: dirs.import, selection: selection } }) })
          .then(function (payload) {
            setInspection(payload)
            setSnapshot(function (p) { return Object.assign({}, p, { error: null }) })
            notify('预览完成：' + payload.planSummary.selected + '/' + payload.planSummary.total + ' 项可自动恢复')
          })
          .catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
          .then(function () { setBusy(false) })
      }

      function runImport() {
        setBusy(true)
        request('/pick', { body: { path: dirs.import } })
          .then(function () { return request('/import', { body: { sourceDir: dirs.import, selection: selection } }) })
          .then(function () { notify('导入任务已开始'); refresh() })
          .catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
          .then(function () { setBusy(false) })
      }

      function cancel() {
        var task = snapshot.status && snapshot.status.task
        request('/cancel', { body: { taskId: task ? task.id : undefined } }).then(function (payload) {
          notify(payload && payload.canceled ? '已请求取消，正在回滚' : '没有可取消的任务')
          refresh()
        }).catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
      }

      function togglePlan(id, checked) {
        setSelection(function (previous) {
          var off = Object.assign({}, previous.off)
          if (checked) delete off[id]
          else off[id] = true
          return Object.assign({}, previous, { off: off })
        })
      }

      if (snapshot.loading) return h('div', { style: styles.page }, '正在读取插件状态…')

      var status = snapshot.status
      var task = status ? status.task : null
      var taskRunning = !!(task && !task.finishedAt)
      var degradation = status ? status.degradation || [] : []
      var currentOptions = options || (status && status.settings ? status.settings.options : null) || { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true }

      return h('div', { style: styles.page },
        errorBanner(snapshot.error),
        noticeBanner(snapshot.notice),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, 'dsh-BrittleBackup'),
          h('div', { style: styles.hint },
            '把配置、插件清单、模型配置与 skills 导出成一个目录，再从该目录导入还原；导入前做 14 项兼容性验证，写入前自动快照。'),
          status
            ? h('div', { style: Object.assign({}, styles.row, { marginTop: 8 }) },
              h('span', { style: styles.hint }, '插件版本 ' + status.plugin.version),
              h('span', { style: styles.hint }, '产物格式 v' + status.plugin.artifactVersion),
              h('span', { style: styles.hint }, '服务：configEditor ' + (status.services.configEditor ? '✓' : '✗') + '　pluginManager ' + (status.services.pluginManager ? '✓' : '✗') + '　credentials ' + (status.services.credentials ? '✓' : '✗') + '　skills ' + (status.services.skills ? '✓' : '✗')))
            : null,
          degradation.length
            ? h('div', { style: Object.assign({}, styles.banner, { marginTop: 8 }) }, h('div', null, '降级提示：'), h('ul', { style: { margin: '4px 0 0 16px', padding: 0 } }, degradation.map(function (note, index) { return h('li', { key: index }, note) })))
            : null),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '① 导出备份'),
          h('div', { style: styles.row },
            optionRow('profile', 'profile 配置', currentOptions.profile, taskRunning, toggleOption),
            optionRow('plugins', '插件清单', currentOptions.plugins, taskRunning, toggleOption),
            optionRow('models', '模型配置', currentOptions.models, taskRunning, toggleOption),
            optionRow('skills', 'skills 清单', currentOptions.skills, taskRunning, toggleOption),
            optionRow('skillFiles', 'skills 文件（连文件一起复制）', currentOptions.skillFiles, taskRunning, toggleOption),
            optionRow('doc', '兜底文档', currentOptions.doc, taskRunning, toggleOption)),
          dirPicker('落点', dirs.export, function (value) { setDir('export', value) }, function () { pick('export') }, function () { register('export') }, taskRunning),
          h('div', { style: styles.row },
            h('button', { style: styles.buttonPrimary, disabled: busy || taskRunning, onClick: runExport }, '开始导出'),
            h('span', { style: styles.hint }, '不填落点就写到插件工作目录；产物里绝不会出现密钥。'))),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '② 导入还原'),
          dirPicker('来源', dirs.import, function (value) { setDir('import', value) }, function () { pick('import') }, function () { register('import') }, taskRunning),
          h('div', { style: styles.row },
            h('button', { style: styles.button, disabled: busy || taskRunning || !dirs.import, onClick: runInspect }, '预览（只读）'),
            h('span', { style: styles.hint }, '预览会跑完 14 项检查并给出 diff，不改动任何文件。')),
          inspectionPanel(inspection, selection, {
            toggle: togglePlan,
            ack: function (value) { setSelection(function (previous) { return Object.assign({}, previous, { ackBuildScripts: value }) }) },
            run: runImport,
            busy: busy || taskRunning,
          })),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '③ 任务进度'),
          taskPanel(task),
          h('div', { style: styles.row },
            h('button', { style: styles.button, onClick: function () { refresh() } }, '刷新'),
            h('button', { style: styles.button, disabled: !taskRunning, onClick: cancel }, '取消当前任务'),
            h('span', { style: styles.hint }, '关掉设置页不会中断任务；DSH 重启会中断，不承诺续跑。'))))
    }

    function apply(ctx) {
      var slots = ctx && ctx.slots
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        console.warn('[brittle-backup] 客户端 slots 服务不可用：设置页未注册')
        return
      }
      // 目录选择器是可选的客户端能力；没有就让用户把绝对路径登记进来。
      if (typeof ctx.inject === 'function') {
        ctx.inject(['uiWorkspace'], function (scoped) {
          if (scoped && scoped.uiWorkspace && typeof scoped.uiWorkspace.pickDirectory === 'function') {
            host.pickDirectory = function () { return scoped.uiWorkspace.pickDirectory() }
            host.hasPicker = true
          }
        })
      }
      slots.inject('settings.section', function () {
        return slots.register({
          name: 'settings.section',
          id: SECTION_ID,
          order: 41,
          label: '兜底备份',
        }, Section)
      })
    }

    exports.name = 'brittle-backup-ui'
    exports.inject = ['slots']
    exports.apply = apply
    exports.Section = Section
    return module.exports
  },
})
