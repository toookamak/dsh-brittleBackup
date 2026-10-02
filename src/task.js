/**
 * 任务状态：**由宿主侧持有**（内存），设置页关闭不中断，重开可见进度与结果。
 * DSH 重启则任务丢失 —— 不承诺续跑（PROJECT-PLAN §0.4 D5）。
 *
 * 同时提供"同一时刻只允许一个写任务"的闸门（§17.2）。
 * `begin()` 返回的 task 上挂着**已绑定的辅助方法**，调用方不需要知道注册表。
 */
import { randomUUID } from 'node:crypto'

export class BusyError extends Error {
  constructor(message = '已有写任务在进行中') {
    super(message)
    this.code = 'BUSY'
  }
}

export class CanceledError extends Error {
  constructor(message = '任务已取消') {
    super(message)
    this.code = 'CANCELED'
  }
}

export class TaskRegistry {
  #current = null
  #last = null

  /** 开始一个任务；同一时刻只允许一个任务（写任务尤其）。 */
  begin(kind) {
    if (this.#current !== null) throw new BusyError()
    const controller = new AbortController()
    const registry = this
    const task = {
      id: randomUUID(),
      kind,
      startedAt: new Date().toISOString(),
      phase: 'prepare',
      message: '',
      progress: { done: 0, total: 0 },
      /** 0–100，单调不回退（体验优化项 3）：UI 的进度条只依赖它。 */
      percent: 0,
      warnings: [],
      canceled: false,
      finishedAt: null,
      result: null,
      error: null,
      signal: controller.signal,
      cancel: (reason = '用户取消') => {
        task.canceled = true
        task.cancelReason = reason
        controller.abort(new CanceledError(reason))
      },
      setPhase: (phase, message = '', percent = undefined) => registry.#setPhase(task, phase, message, percent),
      setProgress: (done, total, percent = undefined) => registry.#setProgress(task, done, total, percent),
      addWarning: (message) => registry.warn(task, message),
      throwIfCanceled: () => registry.#throwIfCanceled(task),
      finish: (result) => registry.finish(task, result),
      fail: (error) => registry.fail(task, error),
    }
    this.#current = task
    return task
  }

  #setPhase(task, phase, message, percent = undefined) {
    task.phase = phase
    task.message = message
    if (typeof percent === 'number') this.#setPercent(task, percent)
    this.#throwIfCanceled(task)
  }

  #setProgress(task, done, total, percent = undefined) {
    task.progress = { done, total }
    if (typeof percent === 'number') this.#setPercent(task, percent)
    this.#throwIfCanceled(task)
  }

  /** 百分比单调递增：任何一步都不允许把进度条往回拽。 */
  #setPercent(task, value) {
    if (!Number.isFinite(value)) return
    const clamped = Math.max(0, Math.min(100, Math.round(value)))
    if (clamped > task.percent) task.percent = clamped
  }

  #throwIfCanceled(task) {
    if (task.canceled) throw new CanceledError(task.cancelReason)
  }

  warn(task, message) {
    if (task.warnings.length < 200) task.warnings.push(String(message))
  }

  finish(task, result) {
    task.result = result ?? null
    task.phase = 'done'
    task.percent = 100
    task.finishedAt = new Date().toISOString()
    this.#release(task)
  }

  fail(task, error) {
    task.error = { code: error?.code ?? 'ERROR', message: error?.message ?? String(error) }
    task.phase = 'failed'
    // 失败时**不**把 percent 推到 100：进度条停在断点上，用户看得见卡在哪里。
    task.finishedAt = new Date().toISOString()
    this.#release(task)
  }

  /** 取消：只打标记；实际回滚由正在执行的调用链负责。 */
  cancel(id) {
    const task = this.#current
    if (task === null || (id !== undefined && id !== task.id)) return { canceled: false, reason: '没有进行中的任务' }
    task.cancel()
    return { canceled: true, id: task.id }
  }

  get current() {
    return this.#current
  }

  /** 可序列化的状态视图（不含 AbortController / 闭包）。 */
  view(task = this.#current ?? this.#last) {
    if (task === null || task === undefined) return { task: null }
    return {
      task: {
        id: task.id,
        kind: task.kind,
        phase: task.phase,
        message: task.message,
        progress: task.progress,
        percent: task.percent,
        warnings: [...task.warnings],
        canceled: task.canceled === true,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        result: task.result,
        error: task.error,
      },
    }
  }

  #release(task) {
    if (this.#current === task) this.#current = null
    this.#last = task
  }
}
