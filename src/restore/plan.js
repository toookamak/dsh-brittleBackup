/**
 * 恢复计划与 diff 预览（PROJECT-PLAN §6.2 步骤 ③④）。
 *
 * 计划只描述"打算做什么"，**不写任何东西**；每个条目都带级别与理由，
 * 默认选择规则：可自动恢复 → 勾选；只能手工 / 有风险 → 默认不勾选（有风险项默认不勾也照 §7 的"默认保留目标机"）。
 */
import { diffObjects, deepEqual } from '../diff.js'

export const PLAN_ACTIONS = Object.freeze({
  merge: '合并写入配置条目',
  manual: '只能照文档手工处理',
  write: '写入文件',
  confirm: '需要显式确认后写入',
  install: '安装插件',
  enable: '启用插件',
  disable: '禁用插件',
  keep: '保留目标机现状',
  copy: '写入 skill 文件',
  verify: '只核对清单',
  report: '只报告',
})

const planId = (kind, ref) => `${kind}:${ref}`

function item({ kind, ref, action, level, reason, selected, requiresConfirm = false, detail = null, diff = null }) {
  return { id: planId(kind, ref), kind, ref, action, level, reason, selected, requiresConfirm, detail, diff }
}

/**
 * @param selection 用户勾选结果：
 *   `{ overrides: { [planId]: boolean }, off: { [planId]: true }, overwriteSkills: [name], overwritePlugins: [name], ackBuildScripts: boolean }`
 *   `overrides` 是**三态**通道：缺省 = 听计划默认值（UI 的复选框直接回显计划里的 `selected`），
 *   显式 true/false = 用户改过。`off` 保留是为了兼容旧调用方。
 */
export function buildPlan({ artifact, host, checks = null, selection = null } = {}) {
  const off = selection?.off ?? {}
  const overrides = selection?.overrides ?? {}
  const overwriteSkills = new Set(selection?.overwriteSkills ?? [])
  const overwritePlugins = new Set(selection?.overwritePlugins ?? [])
  const items = artifact.items
  const plan = []

  /**
   * 三态勾选：用户没动过就听默认的（`defaultSelected`），动过就听用户的。
   *
   * 之前只有 `off` 一个通道，只能表达"取消勾选"，没法表达"把默认关掉的项重新打开"
   * —— 也就是没法实现契约里那句"默认保留目标机，勾选才覆盖"。
   */
  const selectedByUser = (kind, ref, defaultSelected) => {
    const explicit = overrides[planId(kind, ref)]
    if (typeof explicit === 'boolean') return explicit
    return defaultSelected ? !off[planId(kind, ref)] : false
  }

  // ---- 配置条目 ----
  for (const entry of items.config.entries) {
    const live = host.configEntries.get(entry.id)
    if (!live) {
      plan.push(item({
        kind: 'config', ref: entry.id, action: 'manual', level: 'block', selected: false,
        reason: '目标机没有这个 patch 条目（通常因为插件还没装），无法用官方编辑路径新建',
        detail: '照兜底文档把这段 YAML 粘进 profile 的 cordis.patch.yml',
        diff: diffObjects({}, entry.override).slice(0, 20),
      }))
      continue
    }
    const same = deepEqual(live.override, entry.override)
    plan.push(item({
      kind: 'config', ref: entry.id, action: 'merge', level: same ? 'info' : 'warn',
      // 值不同的时候**默认不写**：FORMAT.md §2 与 PROJECT-PLAN §7 都要求"默认保留目标机"，
      // 用户显式勾选（selection.overrides）才覆盖。之前这里恒为 true，
      // 界面却写着"默认保留目标机，勾选才覆盖" —— 文案和行为是反的。
      selected: selectedByUser('config', entry.id, same),
      reason: same ? '与目标机一致（仍会按合并语义写一遍）' : '同 id 条目值不同：默认保留目标机，勾选才覆盖',
      diff: diffObjects(live.override, entry.override).slice(0, 20),
    }))
  }

  // ---- 文件：pnpm-workspace.yaml（allowBuilds 是代码执行许可） ----
  const workspace = items.files.find(file => file.path === 'pnpm-workspace.yaml')
  if (workspace) {
    plan.push(item({
      kind: 'file', ref: 'pnpm-workspace.yaml',
      action: selection?.ackBuildScripts === true ? 'write' : 'confirm',
      level: 'warn',
      selected: selection?.ackBuildScripts === true && selectedByUser('file', 'pnpm-workspace.yaml', true),
      requiresConfirm: true,
      reason: 'allowBuilds 是代码执行许可：还原它等于重新授权安装脚本运行，必须显式确认',
      diff: [],
    }))
  }

  // ---- 插件 ----
  for (const plugin of items.plugins) {
    const installed = host.installed.get(plugin.name)
    if (plugin.unportable || plugin.source === 'local-path') {
      plan.push(item({
        kind: 'plugin', ref: plugin.name, action: 'manual', level: 'block', selected: false,
        reason: `本地路径依赖（${plugin.spec}），跨机器恢复会失败`,
        detail: plugin.installCommand,
      }))
      continue
    }
    if (!host.services.pluginManager) {
      plan.push(item({
        kind: 'plugin', ref: plugin.name, action: 'manual', level: 'warn', selected: false,
        reason: '宿主插件管理不可用，只能照文档手工安装',
        detail: plugin.installCommand,
      }))
      continue
    }
    if (!installed || !installed.installed) {
      plan.push(item({
        kind: 'plugin', ref: plugin.name, action: 'install', level: 'info',
        selected: selectedByUser('plugin', plugin.name, true),
        reason: `目标机未安装，将执行 ${plugin.installCommand}`,
        detail: plugin.spec,
      }))
      continue
    }
    if (installed.version !== null && plugin.resolvedVersion !== null && installed.version !== plugin.resolvedVersion) {
      const overwrite = overwritePlugins.has(plugin.name)
      plan.push(item({
        kind: 'plugin', ref: plugin.name, action: overwrite ? 'install' : 'keep', level: 'warn',
        selected: overwrite && selectedByUser('plugin', plugin.name, true),
        reason: `目标机 ${installed.version}，备份 ${plugin.resolvedVersion}；默认保留目标机`,
        detail: plugin.spec,
      }))
      continue
    }
    const currentEnabled = installed.enabled !== false
    if (plugin.enabled === false && currentEnabled) {
      plan.push(item({
        kind: 'plugin', ref: plugin.name, action: 'disable', level: 'warn',
        selected: selectedByUser('plugin', plugin.name, true),
        reason: '备份时该插件处于禁用状态，目标机是启用的 → 需要禁用',
      }))
      continue
    }
    if (plugin.enabled !== false && !currentEnabled) {
      plan.push(item({
        kind: 'plugin', ref: plugin.name, action: 'enable', level: 'info',
        selected: selectedByUser('plugin', plugin.name, true),
        reason: '备份时该插件是启用的，目标机是禁用的 → 需要启用',
      }))
      continue
    }
    plan.push(item({
      kind: 'plugin', ref: plugin.name, action: 'keep', level: 'info', selected: false,
      reason: `目标机已安装且启用状态一致（版本 ${installed.version ?? 'unknown'}）`,
    }))
  }

  // ---- skills ----
  for (const skill of items.skills) {
    const exists = host.skillNames.includes(skill.name)
    if (skill.included !== true) {
      plan.push(item({
        kind: 'skill', ref: skill.name, action: 'verify', level: 'info', selected: false,
        reason: '备份里只有清单，没有文件',
        detail: exists ? '目标机已有同名 skill：保持不动' : '目标机没有这个 skill：需要你自行准备文件',
      }))
      continue
    }
    const overwrite = overwriteSkills.has(skill.name)
    plan.push(item({
      kind: 'skill', ref: skill.name, action: 'copy',
      level: exists && !overwrite ? 'warn' : 'info',
      selected: exists && !overwrite ? false : selectedByUser('skill', skill.name, true),
      reason: exists
        ? (overwrite ? '目标机已有同名 skill：按你的选择覆盖' : '目标机已有同名 skill：默认跳过，勾选"覆盖"才写')
        : `写入 <DSH_HOME>\\skills\\${skill.name}\\（${skill.files} 个文件）`,
    }))
  }

  // ---- 凭据：只报告 ----
  const credentialStates = checks?.credentialStates ?? {}
  for (const name of items.requiredCredentials) {
    plan.push(item({
      kind: 'credential', ref: name, action: 'report', level: 'info', selected: false,
      reason: `状态：${credentialStates[name] ?? 'unknown'}（永不读值、永不写入产物）`,
    }))
  }

  // ---- 拦截级检查项真正生效（PROJECT-PLAN §7）----
  //
  // 之前 `runChecks` 判出 `verdict: 'blocked'` 之后**没有任何人消费** `blockedItems`，
  // 所以"路径安全 / peer 不兼容 / entry id 撞车"这些拦截级结论对写入毫无约束力。
  // 这里把命中的计划项降级成 `manual` 并强制取消勾选：
  //   - `writeTargets()` 自然不再带上它（它只收 merge/write/install/enable/disable/copy）；
  //   - 条目仍然留在计划表里，用户能看到"为什么这条只能手工"，而不是凭空少一项。
  const blockedReasons = new Map()
  for (const blocked of checks?.blockedItems ?? []) {
    const target = blocked?.target
    if (target?.kind === undefined || target?.ref === undefined) continue
    const id = planId(String(target.kind), String(target.ref))
    if (!blockedReasons.has(id)) blockedReasons.set(id, blocked.reason ?? '被拦截级检查项命中')
  }
  for (const entry of plan) {
    const reason = blockedReasons.get(entry.id)
    if (reason === undefined) continue
    entry.blockedBy = reason
    entry.action = 'manual'
    entry.level = 'block'
    entry.requiresConfirm = false
    entry.selected = false
    entry.reason = `被拦截级检查项拦下，不能自动写入（${reason}）`
  }

  return plan
}

export function planSummary(plan) {
  const summary = { total: plan.length, selected: 0, byAction: {}, byLevel: {} }
  for (const entry of plan) {
    if (entry.selected) summary.selected += 1
    summary.byAction[entry.action] = (summary.byAction[entry.action] ?? 0) + 1
    summary.byLevel[entry.level] = (summary.byLevel[entry.level] ?? 0) + 1
  }
  return summary
}

/** 计划里真正会写盘的条目（回滚只需要覆盖这些）。 */
export function writeTargets(plan) {
  return plan.filter(entry => entry.selected && ['merge', 'write', 'install', 'enable', 'disable', 'copy'].includes(entry.action))
}
