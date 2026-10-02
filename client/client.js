/**
 * 客户端半：一个顶层独立设置页（`settings.section`），承载导出 / 导入 / 任务进度。
 *
 * 手写、零构建：宿主用 `window.__ModuleLoader__.load({ id, factory })` 装载客户端半，
 * factory 里通过宿主提供的 `require()` 取外部模块（这里只取 `react`），
 * 最后把 `{ name, inject, apply }` 交回去 —— 形状与参考实现（dsh-market）一致。
 *
 * 与宿主通信只走 `/brittle-backup/*` 这九个路由（见 docs/PROJECT-PLAN.md §17.2），
 * 页面不直接碰文件系统。
 *
 * 2026-10-02 体验优化（与宿主半一一对应）：
 *   1. 落点行加「使用上次路径」「打开备份路径」（`/open`）；
 *   2. 导出加「打包成 zip」勾选（默认开，宿主侧默认压包）；
 *   3. 任务卡有进度条 + 彩色结论（成功 / 失败 / 取消）；
 *   4. 恢复前的验证结果先给大白话摘要，原始 14 项表收进可展开的「查看验证结果表」。
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
    var host = { pickDirectory: null, pickFile: null, hasPicker: false, hasFilePicker: false }

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
      if (error.code === 'OPEN_UNSUPPORTED') return '当前系统不支持从设置页打开目录，请手动打开：' + text
      if (error.code === 'OPEN_FAILED') return '打开目录失败：' + text
      if (error.code === 'PATH_UNSAFE') return text + '（要打开/登记的都必须是存在的绝对目录）'
      if (error.code === 'ARCHIVE_INVALID' || error.code === 'ARCHIVE_CRC' || error.code === 'ARCHIVE_UNSAFE_PATH') {
        return '压缩包读不了：' + text + '（可以改用未压缩的产物目录）'
      }
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
    var AUTO_ACTIONS = ['merge', 'write', 'install', 'enable', 'disable', 'copy']
    /** 需要用户显式打勾才会执行的项（如 allowBuilds）——永远算"需要注意"，不算"可直接恢复"。 */
    var CONFIRM_ACTIONS = ['confirm']

    // ---- 任务进度与彩色结论（体验优化项 3）----
    var TASK_STATUS_COLOR = { running: '#1677ff', done: '#389e0d', failed: '#d4380d', canceled: '#d48806' }
    var TASK_STATUS_TEXT = { running: '进行中', done: '成功', failed: '失败', canceled: '已取消' }
    var PHASE_LABEL = {
      prepare: '准备',
      collect: '采集配置与 skills',
      redact: '密钥自查 / 生成兜底文档',
      write: '写入产物',
      zip: '打包 zip',
      inspect: '校验产物与兼容性',
      snapshot: '写前快照',
      apply: '写入配置 / 插件 / skills',
      verify: '核对密钥状态',
      done: '完成',
      failed: '失败',
    }

    function phaseLabel(phase) {
      return PHASE_LABEL[phase] || phase || '—'
    }

    function taskStatus(task) {
      if (!task) return 'idle'
      if (task.error) return 'failed'
      if (task.canceled) return 'canceled'
      if (task.finishedAt) return 'done'
      return 'running'
    }

    function taskKindLabel(task) {
      return task && task.kind === 'import' ? '导入还原' : '导出备份'
    }

    function taskHeadline(task) {
      var status = taskStatus(task)
      if (status === 'running') return '进行中 · ' + (task.message || phaseLabel(task.phase))
      if (status === 'done') return '✓ ' + taskKindLabel(task) + '成功'
      if (status === 'canceled') return '已取消（未完成）'
      if (status === 'failed') return '✗ ' + taskKindLabel(task) + '失败'
      return '无任务'
    }

    function taskPercent(task) {
      if (!task) return 0
      if (typeof task.percent === 'number') return Math.max(0, Math.min(100, task.percent))
      return task.finishedAt && !task.error ? 100 : 0
    }

    function progressBar(task) {
      var status = taskStatus(task)
      var color = TASK_STATUS_COLOR[status] || 'rgba(127,127,127,0.5)'
      var percent = taskPercent(task)
      return h('div', { key: 'bar', style: { marginBottom: 8 } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 } },
          h('strong', { style: { color: color } }, taskHeadline(task)),
          h('span', { style: styles.hint }, TASK_STATUS_TEXT[status] + '　' + percent + '%')),
        h('div', { style: { height: 8, borderRadius: 4, background: 'rgba(127,127,127,0.18)', overflow: 'hidden' } },
          h('div', { style: { height: '100%', width: Math.max(percent, 2) + '%', background: color, borderRadius: 4 } })))
    }

    var OPTION_LABELS = [['profile', 'profile 配置'], ['plugins', '插件清单'], ['models', '模型配置'], ['skills', 'skills 清单'], ['skillFiles', 'skills 文件'], ['doc', '兜底文档']]

    function resultLines(task) {
      var result = task.result
      if (!result || typeof result !== 'object') return []
      var lines = []
      if (result.direction === 'export') {
        if (task.finishedAt) lines.push('最终完成时间：' + task.finishedAt)
        lines.push('交付物：' + result.dir)
        lines.push('打包形态：' + (result.packaging === 'zip'
          ? 'zip 压缩包' + (result.zipBytes ? '（' + formatBytes(result.zipBytes) + '）' : '')
          : '未压缩目录'))
        if (result.files && result.files.length) lines.push('包含：' + result.files.join('、'))
        lines.push('本次含：' + OPTION_LABELS.filter(function (pair) {
          return result.options && result.options[pair[0]] === true
        }).map(function (pair) { return pair[1] }).join('、'))
        if (result.redactionCount) lines.push('已剥离疑似密钥 ' + result.redactionCount + ' 处（不会写进产物，恢复后要自己补）')
      } else if (result.direction === 'import') {
        lines.push('成功 ' + (result.applied || []).length + ' 项、失败 ' + (result.failed || []).length +
          ' 项、需手工 ' + (result.manual || []).length + ' 项、已跳过 ' + (result.skipped || []).length + ' 项')
        if (result.snapshot) lines.push('回滚快照：' + result.snapshot)
        if (result.missingCredentials && result.missingCredentials.length) lines.push('需要自己补的密钥：' + result.missingCredentials.join('、'))
        if (result.redactedSkipped && result.redactedSkipped.length) lines.push('跳过 ' + result.redactedSkipped.length + ' 处已剥离的密钥（不会用占位符覆盖目标机）')
        if (result.residual && result.residual.length) lines.push('回滚残留 ' + result.residual.length + ' 处（展开下方「完整结果」看细节）')
        lines.push(result.restartRequired ? '需要重启 DSH 才完全生效' : '无需重启')
      }
      return lines
    }

    // ---- 恢复前验证结果的"人话"摘要（体验优化项 4）----
    var TONE_COLOR = { ok: '#389e0d', warn: '#d48806', block: '#d4380d' }

    function checkByKey(inspection) {
      var map = {}
      var checks = inspection.checks || []
      checks.forEach(function (check) { map[check.key] = check })
      return map
    }

    /** 把 14 项专业结论翻译成用户看得懂的话；没事的检查项不出现。 */
    function plainNotes(inspection) {
      var byKey = checkByKey(inspection)
      var notes = []
      function add(level, text) { notes.push({ level: level, text: text }) }
      var producer = (inspection.artifact && inspection.artifact.producer) || {}
      var host = inspection.host || {}

      function blocked(key) { return byKey[key] && byKey[key].verdict === 'blocked' }
      function warned(key) { return byKey[key] && byKey[key].verdict === 'warning' }

      if (blocked('peer-dependencies')) add('block', '有插件声明的依赖和这台机器的 DSH 版本不兼容，装上去可能起不来，已拦住自动安装。')
      if (blocked('local-path-dependency')) add('block', '备份里有指向本机绝对路径的插件，换机器一定装不上，只能照兜底文档手工处理。')
      if (blocked('entry-id-conflict')) add('block', '有插件的 loader id 和这台机器上已有的插件撞了，直接装可能让 DSH 起不来。')
      if (blocked('path-safety')) add('block', '产物里有不安全（含 .. 或绝对路径）的文件路径，拒绝写入。')
      if (blocked('agents-running')) add('block', '现在有 agent 正在运行，导入被挡住了：等它跑完再回来。')
      if (warned('dsh-version')) add('warn', '备份来自 DSH ' + (producer.dshVersion || '?') + '，这台机器是 ' + (host.dshVersion || '?') + '：插件与配置形状可能不一样，建议逐项确认后再还原。')
      if (warned('installed-version-differs')) add('warn', '有插件这台机器也装了，但版本和备份不同：默认保留这台机器的版本，要按备份覆盖得逐项勾选。')
      if (warned('config-entry-conflict')) add('warn', '有配置条目和这台机器上的现有配置不一样：默认保留现有的，勾选才会覆盖。')
      if (warned('skills-same-name')) add('warn', '有同名 skill：默认跳过不写，想覆盖要自己勾选。')
      if (warned('model-structure')) add('warn', '模型配置有几处形状可疑，插件不会盲写，报告里会给可以自己粘贴的片段。')
      if (warned('plugin-manager')) add('warn', '这台机器的插件管理不可用：插件只能照兜底文档手工装。')
      var manual = (inspection.plan || []).filter(function (entry) { return entry.action === 'manual' })
      if (manual.length) add('warn', '有 ' + manual.length + ' 项（' + manual.slice(0, 3).map(function (entry) { return entry.ref }).join('、') + (manual.length > 3 ? ' 等' : '') + '）只能照兜底文档手工处理。')
      var credential = byKey['missing-credentials']
      if (credential && /补 \d+ 项/.test(credential.detail || '')) add('info', credential.detail + '：导入后要你自己填，插件永远不读 key 的值。')
      var workspace = (inspection.plan || []).filter(function (entry) { return entry.requiresConfirm })
      if (workspace.length) add('info', '有 ' + workspace.length + ' 项属于"代码执行许可"（allowBuilds），必须你显式打勾才会写。')
      return notes
    }

    /**
     * 抽象概述：一句结论 + 三个计数。
     * 计数**跟着勾选实时变化**（所以传进来的 selection 也参与计算）。
     */
    function summarizeInspection(inspection, selection) {
      if (!inspection) return null
      var off = (selection && selection.off) || {}
      var auto = 0
      var attention = 0
      var manual = 0
      var plan = inspection.plan || []
      plan.forEach(function (entry) {
        if (entry.action === 'manual') { manual += 1; return }
        if (CONFIRM_ACTIONS.indexOf(entry.action) >= 0) { attention += 1; return }
        if (AUTO_ACTIONS.indexOf(entry.action) < 0) return
        var selected = off[entry.id] !== true
        if (selected && entry.level === 'info' && entry.requiresConfirm !== true) auto += 1
        else attention += 1
      })
      var blockedGlobal = inspection.blockedGlobal || []
      var tone = inspection.blocked ? 'block' : (attention > 0 ? 'warn' : 'ok')
      var headline
      if (tone === 'block') headline = '不能自动还原：有 ' + blockedGlobal.length + ' 项拦截级问题，只能照兜底文档手工处理'
      else if (tone === 'ok') headline = '可以放心还原：' + auto + ' 项都可以自动恢复'
      else headline = '可以还原，但有 ' + attention + ' 项需要你确认'
      return {
        tone: tone,
        color: TONE_COLOR[tone],
        headline: headline,
        counts: { auto: auto, attention: attention, manual: manual },
        notes: plainNotes(inspection),
      }
    }

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
      list: { margin: '4px 0 0 16px', padding: 0 },
      summaryCard: { borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: '1px solid rgba(127,127,127,0.28)' },
      counter: { display: 'inline-block', marginRight: 16, fontSize: 13 },
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

    /**
     * 目录行。
     * @param extraButtons 额外按钮（体验优化项 1）：`[{ key, label, onClick, disabled, title }]`
     */
    function dirPicker(label, value, onChange, onPick, onRegister, disabled, extraButtons) {
      var buttons = [
        h('button', { key: 'pick', style: styles.button, onClick: onPick, disabled: disabled || !host.hasPicker },
          host.hasPicker ? '选择目录…' : '选择目录（宿主不支持）'),
        h('button', { key: 'register', style: styles.button, onClick: onRegister, disabled: disabled || !value }, '登记路径'),
      ]
      for (const extra of extraButtons || []) {
        buttons.push(h('button', {
          key: extra.key,
          style: styles.button,
          onClick: extra.onClick,
          disabled: disabled || extra.disabled === true,
          title: extra.title || '',
        }, extra.label))
      }
      return h('div', { style: styles.row },
        h('span', { style: { minWidth: 64 } }, label),
        h('input', { style: styles.input, value: value || '', placeholder: '选择一个目录，或把绝对路径登记进来', onChange: function (event) { onChange(event.target.value) }, disabled: disabled }),
        buttons)
    }

    function taskPanel(task) {
      if (!task) return h('div', { style: styles.hint }, '当前没有进行中的任务。')
      var status = taskStatus(task)
      var children = [
        progressBar(task),
        h('div', { key: 'meta', style: styles.row },
          h('span', { style: styles.hint }, '任务：' + taskKindLabel(task)),
          h('span', { style: styles.hint }, '阶段：' + phaseLabel(task.phase)),
          task.progress && task.progress.total > 0
            ? h('span', { style: styles.hint }, '进度 ' + task.progress.done + '/' + task.progress.total)
            : null),
      ]
      if (status === 'failed') {
        children.push(h('div', { key: 'fail', style: { color: TASK_STATUS_COLOR.failed, fontWeight: 600, marginBottom: 6 } },
          '失败原因：' + task.error.message + (task.error.code ? '（' + task.error.code + '）' : '')))
      }
      var lines = resultLines(task)
      if (lines.length) {
        children.push(h('ul', { key: 'result-lines', style: Object.assign({}, styles.list, { color: TASK_STATUS_COLOR[status] || 'inherit' }) },
          lines.map(function (line, index) { return h('li', { key: index }, line) })))
      }
      if (task.warnings && task.warnings.length) {
        children.push(h('details', { key: 'warn' }, h('summary', { style: { color: '#d48806', cursor: 'pointer' } }, '警告 ' + task.warnings.length + ' 条'),
          h('pre', { style: styles.pre }, task.warnings.join('\n'))))
      }
      if (task.result) {
        children.push(h('details', { key: 'raw' }, h('summary', { style: styles.hint }, '查看完整结果 JSON'),
          h('pre', { style: styles.pre }, JSON.stringify(task.result, null, 2))))
      }
      return h('div', null, children)
    }

    function inspectionPanel(inspection, selection, handlers) {
      if (!inspection) return h('div', { style: styles.hint }, '还没有预览。选好来源目录后点"预览"。')
      var checks = inspection.checks || []
      var plan = inspection.plan || []
      var summary = summarizeInspection(inspection, selection)
      var children = []

      // ---- 摘要（体验优化项 4）：一句人话 + 三个计数 + 需要注意的点 ----
      children.push(h('div', { key: 'summary', style: Object.assign({}, styles.summaryCard, { borderColor: summary.color }) },
        h('div', { style: { color: summary.color, fontWeight: 600, marginBottom: 6 } }, summary.headline),
        h('div', null,
          h('span', { style: Object.assign({}, styles.counter, { color: TONE_COLOR.ok }) }, '可直接恢复 ' + summary.counts.auto + ' 项'),
          h('span', { style: Object.assign({}, styles.counter, { color: TONE_COLOR.warn }) }, '需要注意 ' + summary.counts.attention + ' 项'),
          h('span', { style: Object.assign({}, styles.counter, { color: '#8c8c8c' }) }, '只能手工 ' + summary.counts.manual + ' 项')),
        summary.notes.length
          ? h('ul', { style: styles.list }, summary.notes.map(function (note, index) {
            return h('li', { key: index, style: { color: note.level === 'block' ? TONE_COLOR.block : (note.level === 'warn' ? TONE_COLOR.warn : 'inherit') } }, note.text)
          }))
          : h('div', { style: styles.hint }, '没有需要注意的地方。')))

      children.push(h('div', { key: 'source', style: styles.row },
        h('span', null, '产物：' + formatBytes(inspection.bytes)),
        h('span', { style: styles.hint }, '来源 DSH ' + (inspection.artifact && inspection.artifact.producer ? inspection.artifact.producer.dshVersion : '?') + '，当前 ' + (inspection.host ? inspection.host.dshVersion : '?')),
        inspection.source === 'zip'
          ? h('span', { style: styles.hint }, '来源是 zip 压缩包：已自动解压到插件工作目录再校验')
          : null,
        inspection.blocked
          ? h('span', { style: { color: TONE_COLOR.block, fontWeight: 600 } }, '有全局拦截项：' + (inspection.blockedGlobal || []).map(function (item) { return item.title }).join('、'))
          : h('span', { style: { color: TONE_COLOR.ok } }, '没有全局拦截项：可以自动写入')))

      if (inspection.checksSummary) {
        children.push(h('div', { key: 'cs', style: styles.hint },
          '检查概况：拦截 ' + (inspection.checksSummary.blocked ? '有' : '无') + '　警告 ' + inspection.checksSummary.warnings + ' 项　计划 ' +
          inspection.planSummary.selected + '/' + inspection.planSummary.total + ' 已勾选'))
      }

      // ---- 完整 14 项验证结果表：默认收起（要"看细节"时才展开）----
      children.push(h('details', { key: 'checks' },
        h('summary', { style: Object.assign({}, styles.title, { cursor: 'pointer' }) }, '查看验证结果表（14 项兼容性验证）'),
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
                  ? h('ul', { style: styles.list }, check.items.slice(0, 12).map(function (entry, index) {
                    return h('li', { key: index, style: styles.hint }, entry.ref + (entry.reason ? '：' + entry.reason : ''))
                  }))
                  : null))
          })))))

      children.push(h('details', { key: 'plan', open: true },
        h('summary', { style: styles.title }, '要还原的内容（' + plan.length + ' 项，逐项可勾选）'),
        h('table', { style: styles.table },
          h('thead', null, h('tr', null,
            h('th', { style: styles.th }, '选'),
            h('th', { style: styles.th }, '类型'),
            h('th', { style: styles.th }, '对象'),
            h('th', { style: styles.th }, '动作'),
            h('th', { style: styles.th }, '说明'))),
          h('tbody', null, plan.map(function (entry) {
            var auto = AUTO_ACTIONS.indexOf(entry.action) >= 0
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

      // 查询文本状态放在既有 hooks 之后，避免改变旧版宿主仿真与页面状态顺序。
      var queryState = React.useState({ detail: false, loading: false, report: null, error: null })
      var query = queryState[0]
      var setQuery = queryState[1]

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

      function pickZip() {
        if (!host.pickFile) return
        host.pickFile().then(function (picked) {
          if (typeof picked === 'string' && picked !== '') {
            setDir('import', picked)
            return request('/pick', { body: { path: picked } }).then(function () { notify('已选定 ZIP 备份：' + picked) })
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

      function lastExportDir() {
        var status = snapshot.status
        return status && status.settings && typeof status.settings.lastExportDir === 'string' ? status.settings.lastExportDir : ''
      }

      /** 「使用上次路径」：填进输入框**并顺手登记**（导出目录走一次性白名单，只填会被 403 挡下）。 */
      function useLastExportDir() {
        var last = lastExportDir()
        if (last === '') return
        setDir('export', last)
        request('/pick', { body: { path: last } }).then(function (payload) {
          notify('已填入上次成功导出的路径并登记：' + payload.path)
        }).catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
      }

      /** 「打开备份路径」：输入框里的路径优先，为空回退到上次成功导出路径。 */
      function openPath(kind) {
        var value = kind === 'import' ? dirs.import : (dirs.export || lastExportDir())
        if (!value) {
          setSnapshot(function (p) { return Object.assign({}, p, { error: '还没有可打开的路径：先选一个目录，或先成功导出一次' }) })
          return
        }
        request('/open', { body: { path: value } }).then(function (payload) {
          notify('已在文件管理器中打开：' + payload.path)
        }).catch(function (error) { setSnapshot(function (p) { return Object.assign({}, p, { error: describeError(error) }) }) })
      }

      function toggleOption(key, value) {
        setOptions(function (previous) { var next = Object.assign({}, previous); next[key] = value; return next })
      }

      function runExport() {
        setBusy(true)
        request('/export', { body: { options: currentOptions, targetDir: dirs.export || null } }).then(function () {
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

      function runQuery() {
        setQuery(function (previous) { return Object.assign({}, previous, { loading: true, error: null }) })
        request('/pick', { body: { path: dirs.import } }).then(function () {
          return request('/query', { body: { sourceDir: dirs.import, detail: query.detail === true } })
        }).then(function (report) {
          setQuery(function (previous) { return Object.assign({}, previous, { loading: false, report: report, error: null }) })
        }).catch(function (error) {
          setQuery(function (previous) { return Object.assign({}, previous, { loading: false, error: describeError(error) }) })
        })
      }

      function copyQuery() {
        var text = query.report && query.report.text
        if (!text) return
        var fallback = function () {
          var area = document.createElement('textarea')
          area.value = text
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.focus()
          area.select()
          var copied = false
          try { copied = document.execCommand('copy') } catch (_) { copied = false }
          document.body.removeChild(area)
          if (!copied) throw new Error('当前环境不允许访问剪贴板，请手动选择文本复制')
        }
        var promise = typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(text)
          : Promise.resolve().then(fallback)
        promise.then(function () { notify('查询文本已复制到剪贴板') }).catch(function (error) {
          setQuery(function (previous) { return Object.assign({}, previous, { error: error.message || String(error) }) })
        })
      }

      function downloadQuery() {
        var text = query.report && query.report.text
        if (!text) return
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
        var url = URL.createObjectURL(blob)
        var link = document.createElement('a')
        link.href = url
        link.download = 'dsh-brittle-backup-query.txt'
        link.click()
        setTimeout(function () { URL.revokeObjectURL(url) }, 0)
        notify('查询文本已下载')
      }

      function queryPanel() {
        return h('div', { style: styles.card },
          h('div', { style: styles.title }, '③ 备份配置查询 / 复制'),
          h('div', { style: styles.hint }, '从②导入还原中当前填写的备份目录或 zip 读取查询内容；插件失效时可复制插件名、版本、配置条目和必要环境变量。密钥值、主机名和本机绝对路径不会显示。'),
          h('label', { style: Object.assign({}, styles.row, { marginTop: 8 }) },
            h('input', { type: 'checkbox', checked: query.detail === true, onChange: function (event) { setQuery(function (previous) { return Object.assign({}, previous, { detail: event.target.checked }) }) } }),
            '显示详细配置结构（仍然隐藏密钥值）'),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.buttonPrimary, disabled: query.loading || !dirs.import, onClick: runQuery }, query.loading ? '生成中…' : '读取备份并生成查询文本'),
            h('button', { type: 'button', style: styles.button, disabled: !query.report || !query.report.text, onClick: copyQuery }, '复制全部内容'),
            h('button', { type: 'button', style: styles.button, disabled: !query.report || !query.report.text, onClick: downloadQuery }, '下载文本')),
          query.error ? errorBanner(query.error) : null,
          query.report && query.report.summary
            ? h('div', { style: styles.hint }, '已生成：' + query.report.summary.plugins + ' 个插件、' + query.report.summary.entries + ' 个配置条目、' + query.report.summary.models + ' 个 provider、' + query.report.summary.skills + ' 个 skill')
            : null,
          h('textarea', { readOnly: true, value: query.report ? query.report.text : '', placeholder: '点击「生成查询文本」后，这里会显示可复制的安全文本。', style: Object.assign({}, styles.input, { display: 'block', width: '100%', minHeight: 220, boxSizing: 'border-box', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', resize: 'vertical' }) }))
      }

      if (snapshot.loading) return h('div', { style: styles.page }, '正在读取插件状态…')

      var status = snapshot.status
      var task = status ? status.task : null
      var taskRunning = !!(task && !task.finishedAt)
      var degradation = status ? status.degradation || [] : []
      var currentOptions = options || (status && status.settings ? status.settings.options : null) || { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true, compress: true }
      var lastDir = lastExportDir()

      return h('div', { style: styles.page },
        errorBanner(snapshot.error),
        noticeBanner(snapshot.notice),

        // 任务在跑时把进度条顶到最上面：不用滚到 ③ 也能看到阶段（体验优化项 3）。
        taskRunning ? h('div', { style: styles.card }, progressBar(task)) : null,

        h('div', { style: styles.card },
          h('div', { style: styles.title }, 'dsh-BrittleBackup'),
          h('div', { style: styles.hint },
            '把配置、插件清单、模型配置与 skills 导出成一份备份（默认打成 zip），再从这里导入还原；导入前做 14 项兼容性验证，写入前自动快照。'),
          status
            ? h('div', { style: Object.assign({}, styles.row, { marginTop: 8 }) },
              h('span', { style: styles.hint }, '插件版本 ' + status.plugin.version),
              h('span', { style: styles.hint }, '产物格式 v' + status.plugin.artifactVersion),
              h('span', { style: styles.hint }, '服务：configEditor ' + (status.services.configEditor ? '✓' : '✗') + '　pluginManager ' + (status.services.pluginManager ? '✓' : '✗') + '　credentials ' + (status.services.credentials ? '✓' : '✗') + '　skills ' + (status.services.skills ? '✓' : '✗')))
            : null,
          degradation.length
            ? h('div', { style: Object.assign({}, styles.banner, { marginTop: 8 }) }, h('div', null, '降级提示：'), h('ul', { style: styles.list }, degradation.map(function (note, index) { return h('li', { key: index }, note) })))
            : null),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '① 导出备份'),
          h('div', { style: styles.row },
            optionRow('profile', 'profile 配置', currentOptions.profile, taskRunning, toggleOption),
            optionRow('plugins', '插件清单', currentOptions.plugins, taskRunning, toggleOption),
            optionRow('models', '模型配置', currentOptions.models, taskRunning, toggleOption),
            optionRow('skills', 'skills 清单', currentOptions.skills, taskRunning, toggleOption),
            optionRow('skillFiles', 'skills 文件（连文件一起复制）', currentOptions.skillFiles, taskRunning, toggleOption),
            optionRow('doc', '兜底文档', currentOptions.doc, taskRunning, toggleOption),
            optionRow('compress', '打包成 zip（推荐）', currentOptions.compress, taskRunning, toggleOption)),
          dirPicker('落点', dirs.export, function (value) { setDir('export', value) }, function () { pick('export') }, function () { register('export') }, taskRunning, [
            { key: 'last', label: '使用上次路径', onClick: useLastExportDir, disabled: lastDir === '', title: lastDir === '' ? '还没有成功导出过' : '上次成功导出到：' + lastDir },
            { key: 'open', label: '打开备份路径', onClick: function () { openPath('export') }, disabled: !dirs.export && lastDir === '', title: '在系统文件管理器里打开（输入框里的路径优先）' },
          ]),
          h('div', { style: styles.row },
            h('button', { style: styles.buttonPrimary, disabled: busy || taskRunning, onClick: runExport }, '开始导出'),
            h('span', { style: styles.hint }, '不填落点就写到插件工作目录；勾了"打包成 zip"就只留一个 .zip，打包失败会自动退回未压缩目录。产物里绝不会出现密钥。'))),

        h('div', { style: styles.card },
          h('div', { style: styles.title }, '② 导入还原'),
          dirPicker('来源', dirs.import, function (value) { setDir('import', value) }, function () { pick('import') }, function () { register('import') }, taskRunning, [
            { key: 'zip', label: '选择 ZIP…', onClick: pickZip, disabled: !host.hasFilePicker, title: host.hasFilePicker ? '直接选择一个 .zip 备份文件' : '宿主未提供文件选择器，也可手动填写 zip 绝对路径后登记' },
            { key: 'open', label: '打开备份路径', onClick: function () { openPath('import') }, disabled: !dirs.import, title: '在系统文件管理器里打开来源目录或 zip 所在位置' },
          ]),
          h('div', { style: styles.row },
            h('button', { style: styles.button, disabled: busy || taskRunning || !dirs.import, onClick: runInspect }, '预览（只读）'),
            h('span', { style: styles.hint }, '选产物目录或放着 .zip 的目录都行；预览会跑完 14 项检查并给出结论，不改动任何文件。')),
          inspectionPanel(inspection, selection, {
            toggle: togglePlan,
            ack: function (value) { setSelection(function (previous) { return Object.assign({}, previous, { ackBuildScripts: value }) }) },
            run: runImport,
            busy: busy || taskRunning,
          }),
          queryPanel()),

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
          var workspace = scoped && scoped.uiWorkspace
          var pickFile = workspace && (workspace.pickFile || workspace.pickFilePath || workspace.pickFilePathname)
          if (typeof pickFile === 'function') {
            host.pickFile = function () { return pickFile.call(workspace, { extensions: ['.zip'] }) }
            host.hasFilePicker = true
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
    // 宿主侧仿真测试直接断言这些纯函数（渲染结果之外的第二层保障）。
    exports.summarizeInspection = summarizeInspection
    exports.plainNotes = plainNotes
    exports.resultLines = resultLines
    exports.taskStatus = taskStatus
    exports.progressBar = progressBar
    return module.exports
  },
})
