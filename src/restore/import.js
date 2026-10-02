/**
 * 导入编排（PROJECT-PLAN §6.2）。
 *
 * `inspectImport()` 全程只读：定位 → 校验 → 14 项检查 → diff 预览 + 计划。
 * `runImport()` 才写盘；拦住全局拦截项，写前快照，失败 / 取消回滚。
 */
import { locateArtifact, readArtifact } from '../artifact.js'
import { gatherHostState } from './host.js'
import { runChecks } from './checks.js'
import { buildPlan, planSummary, writeTargets } from './plan.js'
import { applyPlan } from './apply.js'

export class ImportError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** 给路由 / UI 用的宿主现状视图（剥掉 Entry 对象与函数，可 JSON 化）。 */
export function publicHostView(host) {
  return {
    profileDirectory: host.profileDirectory,
    dshVersion: host.dshVersion,
    services: host.services,
    agentBusy: host.agentBusy,
    skillNames: host.skillNames,
    configEntryIds: [...host.configEntries.keys()].sort(),
    profilePatchIds: host.profilePatchIds,
    installed: [...host.installed.values()].map(info => ({
      name: info.name,
      version: info.version,
      enabled: info.enabled !== false,
      bundle: info.bundle === true,
      patchIds: info.patchIds,
      peerDependencies: info.peerDependencies,
    })),
  }
}

/**
 * 只读预览：定位产物 → 严格校验 → 14 项检查 → 计划。
 * 校验失败即止，**不写任何文件**。
 */
export async function inspectImport({ ctx, env = process.env, sourceDir, selection = null, logger = null } = {}) {
  const located = await locateArtifact(sourceDir)
  if (!located.ok) return { ok: false, code: located.code, reason: located.reason, candidates: located.candidates }

  const read = await readArtifact(located.dir)
  if (!read.ok) {
    return { ok: false, code: 'ARTIFACT_INVALID', reason: '产物未通过严格校验，已停止（未写任何文件）', errors: read.errors, warnings: read.warnings }
  }

  const host = await gatherHostState({ ctx, env, logger })
  const checks = await runChecks({ artifact: read.value, host, ctx })
  const plan = buildPlan({ artifact: read.value, host, checks, selection })

  return {
    ok: true,
    dir: located.dir,
    bytes: read.bytes,
    artifact: read.value,
    artifactWarnings: read.warnings,
    host: publicHostView(host),
    checks: checks.checks,
    blocked: checks.blocked,
    blockedGlobal: checks.blockedGlobal,
    checksSummary: {
      blocked: checks.blocked,
      blockedItems: checks.blockedItems.length,
      warnings: checks.checks.filter(check => check.verdict === 'warning').length,
    },
    plan,
    planSummary: planSummary(plan),
    /** 内部用：applyPlan 需要原始 host（含 Entry 对象），不放进 JSON 视图 */
    internal: { host },
  }
}

/**
 * 真正执行导入。会重新跑一次只读检查（宿主状态可能已经变了），
 * 有全局拦截项就直接拒绝，连快照都不建。
 */
export async function runImport({ ctx, env = process.env, sourceDir, selection = {}, task = null, logger = null } = {}) {
  task?.setPhase?.('inspect', '正在校验产物与检查兼容性')
  const inspected = await inspectImport({ ctx, env, sourceDir, selection, logger })
  if (!inspected.ok) throw new ImportError(inspected.code, inspected.reason, inspected)

  if (inspected.blocked) {
    throw new ImportError('CHECKS_BLOCKED', '存在拦截级检查项，已拒绝写入（没有写任何文件）', inspected.blockedGlobal)
  }

  const targets = writeTargets(inspected.plan)
  if (targets.length === 0) {
    throw new ImportError('NOTHING_SELECTED', '没有勾选任何可自动恢复的项，未做任何改动')
  }

  const report = await applyPlan({
    ctx,
    env,
    artifactDir: inspected.dir,
    artifact: inspected.artifact,
    host: inspected.internal.host,
    plan: inspected.plan,
    selection,
    task,
    logger,
  })

  return {
    direction: 'import',
    dir: inspected.dir,
    planSummary: inspected.planSummary,
    checksSummary: inspected.checksSummary,
    ...report,
  }
}
