/**
 * §7 兼容性检查清单的 14 项实现（PROJECT-PLAN §7）。
 *
 * 判定级别：`block`（拦截）/ `warn`（警告）/ `info`（信息）。全局拦截会拒绝执行写入，
 * 但**不影响**其它项的结论与"照兜底文档怎么办"的指引。
 */
import { checkArtifactPath, checkNameSegment } from '../paths.js'
import { deepEqual, diffObjects } from '../diff.js'
import { satisfies } from '../semver.js'
import { validateModelStructure } from '../collect/models.js'
import { credentialStates, missingCredentialList } from '../credentials.js'

export const LEVELS = Object.freeze({ block: '拦截', warn: '警告', info: '信息' })

const GUIDANCE = '照兜底文档手工处理（文档里给了安装命令与可粘贴的配置片段）'

function result(id, key, title, scope, level, verdict, detail, extra = {}) {
  return { id, key, title, scope, level, verdict, detail, ...extra }
}

/**
 * @param artifact 已通过 validateArtifact 的产物
 * @param host gatherHostState() 的结果
 */
export async function runChecks({ artifact, host, ctx = null }) {
  const checks = []
  const items = artifact.items

  checks.push(result(1, 'format-version', '产物 format / version', 'global', 'block', 'ok',
    `format=${artifact.format} version=${artifact.version} 通过闸门`))

  const pathProblems = []
  for (const file of items.files) {
    const checked = checkArtifactPath(file.path)
    if (!checked.ok) pathProblems.push({ ref: file.path, reason: checked.reason, target: { kind: 'file', ref: file.path } })
  }
  for (const skill of items.skills) {
    // 名字才是会被拿去拼路径的东西（apply.js: join(skillsRoot, name)），所以按 name 定位。
    const checkedName = checkNameSegment(skill.name)
    if (!checkedName.ok) {
      pathProblems.push({ ref: String(skill.name), reason: `skill 名称不安全：${checkedName.reason}`, target: { kind: 'skill', ref: String(skill.name) } })
      continue
    }
    const checked = checkArtifactPath(skill.path)
    if (!checked.ok) pathProblems.push({ ref: skill.path, reason: checked.reason, target: { kind: 'skill', ref: skill.name } })
  }
  checks.push(result(2, 'path-safety', '路径安全', 'item', 'block', pathProblems.length === 0 ? 'ok' : 'blocked',
    pathProblems.length === 0 ? `${items.files.length} 个文件条目、${items.skills.length} 个 skill 路径都通过校验` : `${pathProblems.length} 个路径不安全`,
    { items: pathProblems }))

  const versionDiffers = artifact.producer.dshVersion !== host.dshVersion
  checks.push(result(3, 'dsh-version', 'DSH 版本差异', 'global',
    artifact.producer.dshVersion === 'unknown' || host.dshVersion === 'unknown' ? 'info' : 'warn',
    versionDiffers ? 'warning' : 'ok',
    versionDiffers
      ? `产物来自 DSH ${artifact.producer.dshVersion}，当前是 ${host.dshVersion} —— 继续，但逐项标注风险`
      : `DSH 版本一致（${host.dshVersion}）`,
    versionDiffers ? { action: '版本不同时，插件与配置形状都可能变化；请逐项确认再勾选' } : {}))

  const peerProblems = []
  const peerUnknown = []
  for (const plugin of items.plugins) {
    const info = host.installed.get(plugin.name)
    if (!info || !info.installed) {
      peerUnknown.push({ ref: plugin.name, reason: '未安装，本期不联网查询它的 peerDependencies' })
      continue
    }
    if (info.manifestFound !== true) {
      peerUnknown.push({ ref: plugin.name, reason: '读不到它的 package.json，无法判定 peer 声明' })
      continue
    }
    for (const [peer, range] of Object.entries(info.peerDependencies)) {
      if (peer !== '@deepseek-ai/dsh' && peer !== '@deepseek-ai/cordis' && !peer.startsWith('@deepseek-ai/dsh-')) continue
      const verdict = satisfies(host.dshVersion, range)
      if (!verdict.supported) {
        peerUnknown.push({ ref: `${plugin.name} → ${peer}`, reason: verdict.reason ?? '无法判定' })
        continue
      }
      if (!verdict.satisfied) peerProblems.push({ ref: `${plugin.name} → ${peer}`, reason: `声明 ${range}，当前 ${host.dshVersion}`, target: { kind: 'plugin', ref: plugin.name } })
    }
  }
  checks.push(result(4, 'peer-dependencies', '插件 peerDependencies', 'item', 'block', peerProblems.length === 0 ? 'ok' : 'blocked',
    peerProblems.length === 0
      ? (peerUnknown.length === 0 ? '已安装插件的 peer 声明都与当前 DSH 兼容' : `${peerUnknown.length} 项无法判定（未安装 / 不联网），不自动安装`)
      : `${peerProblems.length} 个插件的 peer 声明与当前 DSH 不兼容`,
    { items: [...peerProblems.map(item => ({ ...item, level: 'block' })), ...peerUnknown.map(item => ({ ...item, level: 'info' }))], action: GUIDANCE }))

  const localDeps = items.plugins.filter(plugin => plugin.unportable || plugin.source === 'local-path')
  checks.push(result(5, 'local-path-dependency', '本地路径依赖', 'item', 'block', localDeps.length === 0 ? 'ok' : 'blocked',
    localDeps.length === 0 ? '没有 link:/file: 绝对路径依赖' : `${localDeps.length} 个插件是本地路径依赖，跨机器会失败`,
    { items: localDeps.map(plugin => ({ ref: plugin.name, reason: plugin.spec, level: 'block', target: { kind: 'plugin', ref: plugin.name } })), action: GUIDANCE }))

  const conflicts = []
  const unknownIds = []
  const knownIdOwner = new Map()
  for (const [name, info] of host.installed) {
    for (const id of info.patchIds) knownIdOwner.set(id, name)
  }
  for (const plugin of items.plugins) {
    const info = host.installed.get(plugin.name)
    if (!info || info.patchIds.length === 0) {
      unknownIds.push({ ref: plugin.name, reason: '该插件未安装，读不到它的 patch id，无法前置判定' })
      continue
    }
    for (const id of info.patchIds) {
      const owner = knownIdOwner.get(id)
      if (owner !== undefined && owner !== plugin.name) conflicts.push({ ref: `${plugin.name} → ${id}`, reason: `id 已被 ${owner} 占用`, target: { kind: 'plugin', ref: plugin.name } })
    }
  }
  checks.push(result(6, 'entry-id-conflict', 'loader entry id 冲突', 'item', 'block', conflicts.length === 0 ? 'ok' : 'blocked',
    conflicts.length === 0
      ? (unknownIds.length === 0 ? '没有检测到 id 冲突' : `${unknownIds.length} 个插件的 id 无法判定（未安装）`)
      : `${conflicts.length} 处 entry id 冲突（cordis 撞 id 会让整棵树起不来）`,
    { items: [...conflicts.map(item => ({ ...item, level: 'block' })), ...unknownIds.map(item => ({ ...item, level: 'info' }))], action: '冲突项不自动安装' }))

  const versionDiffs = []
  for (const plugin of items.plugins) {
    const info = host.installed.get(plugin.name)
    const target = info?.version ?? null
    if (target === null || plugin.resolvedVersion === null) continue
    if (target !== plugin.resolvedVersion) versionDiffs.push({ ref: plugin.name, reason: `目标机 ${target}，备份 ${plugin.resolvedVersion}` })
  }
  checks.push(result(7, 'installed-version-differs', '插件已装但版本不同', 'item', 'warn', versionDiffs.length === 0 ? 'ok' : 'warning',
    versionDiffs.length === 0 ? '已装插件版本与备份一致' : `${versionDiffs.length} 个插件版本不同，默认保留目标机版本`,
    { items: versionDiffs.map(item => ({ ...item, level: 'warn' })), action: '默认保留目标机版本；要按备份覆盖需在预览里逐项勾选' }))

  checks.push(result(8, 'plugin-manager', '包管理器可用性', 'global', 'warn', host.services.pluginManager ? 'ok' : 'warning',
    host.services.pluginManager ? 'pluginManager.installBundle 可用' : `不可用（${host.services.pluginManagerReason}）→ 降级为只还原配置 + 文档指引`))

  const skillClashes = []
  for (const skill of items.skills) {
    if (!host.skillNames.includes(skill.name)) continue
    if (skill.included !== true) {
      skillClashes.push({ ref: skill.name, reason: '目标机已有同名 skill（本次只导入清单，不覆盖）', level: 'info' })
      continue
    }
    skillClashes.push({ ref: skill.name, reason: '目标机已有同名 skill，需要选择 覆盖 / 跳过 / 重命名', level: 'warn' })
  }
  checks.push(result(9, 'skills-same-name', 'skills 同名', 'item', 'warn', skillClashes.length === 0 ? 'ok' : 'warning',
    skillClashes.length === 0 ? '目标机没有同名 skill' : `${skillClashes.length} 个同名 skill 需要选择`,
    { items: skillClashes, action: '默认跳过；勾选"覆盖"才会写文件' }))

  checks.push(result(10, 'skills-empty', 'skills 清单缺失', 'global', 'info', 'ok',
    items.skills.length === 0 ? '备份里没有 skills（正常，不报错）' : `备份里有 ${items.skills.length} 个 skill`))

  const modelProblems = validateModelStructure(items.models)
  checks.push(result(11, 'model-structure', '模型配置结构', 'global', modelProblems.length === 0 ? 'info' : 'warn', modelProblems.length === 0 ? 'ok' : 'warning',
    modelProblems.length === 0 ? `${items.models.length} 个 provider 结构符合当前形状` : `${modelProblems.length} 处结构可疑`,
    { items: modelProblems.map(problem => ({ ref: problem, level: 'warn' })), action: '不盲写；报告里给出文档中的 YAML，由你自己粘贴' }))

  const entryConflicts = []
  for (const entry of items.config.entries) {
    const live = host.configEntries.get(entry.id)
    if (!live) continue
    if (deepEqual(live.override, entry.override)) continue
    entryConflicts.push({
      ref: entry.id,
      reason: '同 id 条目在目标机已存在且值不同',
      diff: diffObjects(live.override, entry.override).slice(0, 20),
    })
  }
  checks.push(result(12, 'config-entry-conflict', '配置条目冲突', 'item', 'warn', entryConflicts.length === 0 ? 'ok' : 'warning',
    entryConflicts.length === 0 ? '配置条目与目标机一致（或目标机没有这些条目）' : `${entryConflicts.length} 个同 id 条目值不同，默认保留目标机`,
    { items: entryConflicts.map(item => ({ ...item, level: 'warn' })), action: '默认保留目标机；要覆盖需逐项勾选' }))

  const agentBusy = host.agentBusy
  checks.push(result(13, 'agents-running', 'agent 忙碌', 'global', 'block', agentBusy === true ? 'blocked' : 'ok',
    agentBusy === true ? '有 agent 正在运行（status = running）→ 拒绝写入' : agentBusy === false ? '没有 agent 在运行' : '拿不到 agents 服务 → fail-open（不阻断）'))

  const credential = await credentialStates(ctx, items.requiredCredentials)
  const missing = missingCredentialList(credential.state)
  checks.push(result(14, 'missing-credentials', '密钥缺失', 'global', 'info', 'ok',
    credential.available
      ? (missing.length === 0 ? '需要的设置项都已配置' : `需要补 ${missing.length} 项：${missing.join('、')}`)
      : '凭据服务不可用，只输出名单不判断状态',
    { items: items.requiredCredentials.map(name => ({ ref: name, level: 'info', state: credential.state[name] ?? 'undetected' })) }))

  const blockedGlobal = checks.filter(check => check.scope === 'global' && check.verdict === 'blocked')
  const blockedItems = checks.flatMap(check => (check.items ?? []).filter(item => item.level === 'block'))
  return {
    checks,
    blocked: blockedGlobal.length > 0,
    blockedGlobal: blockedGlobal.map(check => ({ id: check.id, title: check.title, detail: check.detail })),
    blockedItems,
    credentialStates: credential.state,
    agentBusy,
  }
}

/** UI 用的中文级别标签。 */
export function levelLabel(level) {
  return LEVELS[level] ?? level
}
