/**
 * 插件入口（宿主半）。
 *
 * 硬约束（PROJECT-PLAN §8.4）：
 *   - loader 阶段零副作用：不抛错、不请求网络、不做重活；
 *   - 只通过 `ctx.*` 服务访问宿主能力，不深路径 import DSH 内部模块；
 *   - 不向模型注册任何工具，也不提供聊天命令入口（U24 / D4）。
 *
 * 服务缺失时 `ctx.inject` 的回调根本不执行 —— 这就是降级，不是失败。
 */
import { createLogger } from './log.js'
import { TaskRegistry } from './task.js'
import { mountRoutes } from './routes.js'

export const name = 'brittle-backup'

/**
 * @param ctx 宿主上下文
 * @param config loader 传入的配置（本期不需要任何配置项；预留参数位）
 */
export function apply(ctx, config) { // eslint-disable-line no-unused-vars
  const logger = createLogger(ctx)
  const tasks = new TaskRegistry()

  ctx.inject(['webServer'], hostCtx => {
    const disposeRoutes = mountRoutes({ ctx: hostCtx, tasks, logger })
    ctx.effect(() => disposeRoutes, 'brittle-backup: http routes')
  })
}
