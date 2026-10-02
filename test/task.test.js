/**
 * 任务注册表（体验优化项 3 的宿主侧）：
 * 进度百分比必须**单调不回退**、可序列化，且成功 / 失败 / 取消三种收尾各自给出可渲染的状态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BusyError, CanceledError, TaskRegistry } from '../src/task.js'

test('task：初始 percent 为 0，setPhase / setProgress 都能推进', () => {
  const registry = new TaskRegistry()
  const task = registry.begin('export')
  assert.equal(task.percent, 0)
  assert.equal(registry.view().task.percent, 0)

  task.setPhase('collect', '正在采集', 10)
  assert.equal(task.percent, 10)
  assert.equal(task.phase, 'collect')
  assert.equal(task.message, '正在采集')

  task.setProgress(3, 12, 60)
  assert.deepEqual(task.progress, { done: 3, total: 12 })
  assert.equal(task.percent, 60)
  assert.equal(registry.view().task.percent, 60)
})

test('task：percent 单调不回退，并夹在 0–100', () => {
  const registry = new TaskRegistry()
  const task = registry.begin('import')
  task.setPhase('apply', '写入', 80)
  task.setPhase('verify', '回退一步也不许', 20)
  assert.equal(task.percent, 80, '进度条不能被后面的阶段往回拽')

  task.setProgress(1, 1, 999)
  assert.equal(task.percent, 100)
  task.setProgress(0, 0, -5)
  assert.equal(task.percent, 100, '负值 / 超界都不允许改变已有的高水位')
  task.setProgress(0, 0, Number.NaN)
  assert.equal(task.percent, 100)
})

test('task：成功收尾到 100，失败停在断点，取消可序列化', () => {
  const registry = new TaskRegistry()

  const good = registry.begin('export')
  good.setPhase('write', '写入产物', 60)
  good.finish({ direction: 'export' })
  const view = registry.view().task
  assert.equal(view.phase, 'done')
  assert.equal(view.percent, 100)
  assert.deepEqual(view.result, { direction: 'export' })
  assert.equal(JSON.parse(JSON.stringify(view)).percent, 100, 'view 必须可 JSON 化')

  const bad = registry.begin('import')
  bad.setPhase('snapshot', '写前快照', 25)
  bad.fail(Object.assign(new Error('快照失败'), { code: 'SNAPSHOT_FAILED' }))
  const failed = registry.view().task
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.percent, 25, '失败时进度停在断点，用户看得见卡在哪')
  assert.equal(failed.error.code, 'SNAPSHOT_FAILED')

  const canceled = registry.begin('import')
  canceled.setPhase('apply', '写入配置', 30)
  registry.cancel()
  assert.equal(registry.view().task.canceled, true)
  assert.throws(() => canceled.throwIfCanceled(), error => error instanceof CanceledError)
})

test('task：同一时刻只允许一个任务', () => {
  const registry = new TaskRegistry()
  registry.begin('export')
  assert.throws(() => registry.begin('import'), error => error instanceof BusyError)
  assert.equal(registry.cancel('别的 id').canceled, false)
})
