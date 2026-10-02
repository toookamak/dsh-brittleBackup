/**
 * 应用阶段（PROJECT-PLAN §6.2 步骤 ⑤–⑦）。
 *
 * 顺序固定：写前快照 → 配置条目 → pnpm-workspace（需确认）→ 插件 → skills → 报告。
 * 任何一步失败：**单项失败不影响其它项**（隔离并继续）；中断 / 取消 / 抛错 → 回滚到快照，
 * 回滚不完整必须显式列出残留（U21 / U35）。
 */
import { join } from 'node:path'
import { SNAPSHOT_KEEP, profileDir, skillsRoot } from '../paths.js'
import { hasMethod, service } from '../services.js'
import { copyTree, pathExists, removeTree, writeTextAtomic } from '../nodefs.js'
import { mergeDeep } from '../diff.js'
import { stripRedacted } from '../redact.js'
import { createSnapshot, pruneSnapshots, rollbackSnapshot } from './snapshot.js'
import { credentialStates, missingCredentialList } from '../credentials.js'

class ApplyFailure extends Error {
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

function configEntryById(artifact, id) {
  return artifact.items.config.entries.find(entry => entry.id === id) ?? null
}

/** 回滚包装：catch 里回滚，然后把回滚结果挂在错误上。 */
async function withRollback(snapshotDir, env, work) {
  try {
    return await work()
  } catch (error) {
    const rollback = await rollbackSnapshot(snapshotDir, { env }).catch(rollbackError => ({
      restored: [],
      removed: [],
      residuals: [{ path: snapshotDir, reason: `回滚自身失败：${rollbackError?.message ?? String(rollbackError)}` }],
    }))
    error.rollback = rollback
    error.snapshotDir = snapshotDir
    throw error
  }
}

/**
 * @param plan buildPlan() 的结果（`selected` 已经反映用户勾选）
 * @returns 报告：applied / failed / manual / skipped / needsConfirm / residual / snapshot
 */
export async function applyPlan({
  ctx,
  env = process.env,
  artifactDir,
  artifact,
  host,
  plan,
  selection = {},
  task = null,
  logger = null,
}) {
  const configEditor = service(ctx, 'configEditor')
  const manager = service(ctx, 'pluginManager')
  const profile = profileDir(env)

  const configItems = plan.filter(item => item.kind === 'config' && item.selected && item.action === 'merge')
  const workspaceItem = plan.find(item => item.kind === 'file' && item.action === 'write' && item.selected)
  const workspacePending = plan.find(item => item.kind === 'file' && item.action === 'confirm')
  const pluginItems = plan.filter(item => item.kind === 'plugin' && item.selected)
  const skillItems = plan.filter(item => item.kind === 'skill' && item.selected && item.action === 'copy')

  const report = {
    applied: [],
    failed: [],
    manual: plan.filter(item => item.action === 'manual').map(item => ({ kind: item.kind, ref: item.ref, reason: item.reason, detail: item.detail })),
    skipped: plan.filter(item => !item.selected && item.action !== 'report').map(item => ({ kind: item.kind, ref: item.ref, reason: item.reason })),
    needsConfirm: workspacePending === undefined ? [] : [{ ref: workspacePending.ref, reason: workspacePending.reason }],
    residual: [],
    /** 产物里被剥离的密钥位置：**跳过不写**，只提示用户自己补。 */
    redactedSkipped: [],
    snapshot: null,
    credentialStates: {},
    missingCredentials: [],
    restartRequired: true,
  }

  // ---- 写前快照 ----
  task?.setPhase?.('snapshot', '正在写前快照')
  const targets = []
  if (configItems.length > 0) targets.push({ path: join(profile, 'cordis.patch.yml'), type: 'file' })
  if (workspaceItem !== undefined) targets.push({ path: join(profile, 'pnpm-workspace.yaml'), type: 'file' })
  for (const item of skillItems) targets.push({ path: join(skillsRoot(env), item.ref), type: 'dir' })
  const snapshot = await createSnapshot({ env, targets })
  report.snapshot = snapshot.dir

  await withRollback(snapshot.dir, env, async () => {
    // ---- 1. 配置条目：按 patch id 合并写入 ----
    task?.setPhase?.('apply', '正在写配置条目')
    for (const item of configItems) {
      task?.throwIfCanceled?.()
      const entry = configEntryById(artifact, item.ref)
      const live = host.configEntries.get(item.ref)
      if (entry === null || live === undefined) {
        report.failed.push({ kind: 'config', ref: item.ref, reason: '产物里找不到该条目，或目标机不认识它的 Entry' })
        continue
      }
      if (!hasMethod(configEditor, 'edit')) {
        report.failed.push({ kind: 'config', ref: item.ref, reason: '宿主没有 configEditor.edit()' })
        continue
      }
      try {
        const safe = stripRedacted(entry.override, { prefix: '/override' })
        await configEditor.edit(live.entry, current => mergeDeep(current, safe.value))
        if (safe.removed.length > 0) {
          report.redactedSkipped.push(...safe.removed)
          task?.addWarning?.(`条目 ${item.ref}：跳过 ${safe.removed.length} 处已剥离的密钥（${safe.removed.join('、')}），请在设置里补`)
        }
        report.applied.push({ kind: 'config', ref: item.ref, detail: `合并 ${Object.keys(safe.value).length} 个顶层字段` })
      } catch (error) {
        report.failed.push({ kind: 'config', ref: item.ref, reason: error?.message ?? String(error) })
      }
      task?.setProgress?.(report.applied.length + report.failed.length, plan.length)
    }

    // ---- 2. pnpm-workspace.yaml（代码执行许可，需显式确认） ----
    if (workspaceItem !== undefined) {
      const file = artifact.items.files.find(item => item.path === 'pnpm-workspace.yaml')
      if (file === undefined || typeof file.text !== 'string') {
        report.failed.push({ kind: 'file', ref: 'pnpm-workspace.yaml', reason: '产物里没有它的原文' })
      } else {
        try {
          await writeTextAtomic(join(profile, 'pnpm-workspace.yaml'), file.text)
          report.applied.push({ kind: 'file', ref: 'pnpm-workspace.yaml', detail: '按原文覆盖写入（已显式确认 allowBuilds）' })
        } catch (error) {
          report.failed.push({ kind: 'file', ref: 'pnpm-workspace.yaml', reason: error?.message ?? String(error) })
        }
      }
    }

    // ---- 3. 插件：已装对齐启用状态，缺失才安装 ----
    task?.setPhase?.('apply', '正在处理插件')
    for (const item of pluginItems) {
      task?.throwIfCanceled?.()
      const plugin = artifact.items.plugins.find(entry => entry.name === item.ref)
      if (plugin === undefined) {
        report.failed.push({ kind: 'plugin', ref: item.ref, reason: '产物里找不到该插件' })
        continue
      }
      if (!hasMethod(manager, 'installBundle')) {
        report.failed.push({ kind: 'plugin', ref: item.ref, reason: '宿主没有 pluginManager.installBundle()' })
        continue
      }
      const requestId = `brittle-backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      try {
        if (item.action === 'install') {
          const result = await manager.installBundle(plugin.spec, { enabled: plugin.enabled !== false, requestId })
          if (task?.canceled === true) {
            await manager.cancelInstall?.(requestId).catch?.(() => {})
            task.throwIfCanceled?.()
          }
          if (result?.application === 'failed' || result?.error) {
            report.failed.push({ kind: 'plugin', ref: item.ref, reason: result?.error?.code ?? 'install 失败', detail: result?.error?.diagnostic ?? null })
          } else {
            await manager.waitForInstall?.(requestId).catch?.(() => null)
            report.applied.push({ kind: 'plugin', ref: item.ref, detail: `安装 ${plugin.spec}` })
          }
        } else if (item.action === 'enable' || item.action === 'disable') {
          const enabled = item.action === 'enable'
          const installedPlugin = host.plugins.find(entry => entry?.moduleName === item.ref)
          const result = plugin.bundle === true || installedPlugin === undefined
            ? await manager.setBundleEnabled(item.ref, enabled)
            : await manager.setPluginEnabled(installedPlugin.entryId, enabled)
          if (result?.application === 'failed' || result?.error) {
            report.failed.push({ kind: 'plugin', ref: item.ref, reason: `切换启用状态失败（${result?.error?.code ?? 'unknown'}）` })
          } else {
            report.applied.push({ kind: 'plugin', ref: item.ref, detail: enabled ? '已启用' : '已禁用' })
          }
        } else {
          report.skipped.push({ kind: 'plugin', ref: item.ref, reason: item.reason })
        }
      } catch (error) {
        if (error?.code === 'CANCELED') throw error
        report.failed.push({ kind: 'plugin', ref: item.ref, reason: error?.message ?? String(error) })
      }
      task?.setProgress?.(report.applied.length + report.failed.length, plan.length)
    }

    // ---- 4. skills：只处理勾选了文件、且被选中的 ----
    task?.setPhase?.('apply', '正在写入 skills')
    for (const item of skillItems) {
      task?.throwIfCanceled?.()
      const source = join(artifactDir, 'skills', item.ref)
      const destination = join(skillsRoot(env), item.ref)
      try {
        if (!(await pathExists(source))) {
          report.failed.push({ kind: 'skill', ref: item.ref, reason: '产物里没有 skills\\' + item.ref + ' 目录' })
          continue
        }
        if (await pathExists(destination)) await removeTree(destination)
        const copied = await copyTree(source, destination)
        report.applied.push({ kind: 'skill', ref: item.ref, detail: `${copied.copied} 个文件` })
      } catch (error) {
        report.failed.push({ kind: 'skill', ref: item.ref, reason: error?.message ?? String(error) })
      }
      task?.setProgress?.(report.applied.length + report.failed.length, plan.length)
    }

    // ---- 5. 缺 key 名单（只报告，永不读值） ----
    const credential = await credentialStates(ctx, artifact.items.requiredCredentials)
    report.credentialStates = credential.state
    report.missingCredentials = missingCredentialList(credential.state)
  })

  // 剪枝快照（失败只记警告）
  try {
    await pruneSnapshots(env, SNAPSHOT_KEEP)
  } catch (error) {
    report.residual.push({ path: 'snapshots', reason: `剪枝失败：${error?.message ?? String(error)}` })
  }

  logger?.info?.(`恢复完成：${report.applied.length} 项成功、${report.failed.length} 项失败、${report.manual.length} 项需手工`)
  return report
}

export { ApplyFailure }
