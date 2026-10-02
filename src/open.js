/**
 * 「打开备份路径」：把目录交给系统文件管理器（体验优化项 1）。
 *
 * 与 `node:child_process` 的关系：本模块是全仓库**唯一**会启动外部进程的地方，只用它做
 * 一件无副作用的事 —— 让操作系统打开一个已经存在的目录窗口。约束：
 *   - 参数只有「已存在的绝对目录」，路由层已经校验过，不存在命令注入面（不经 shell）；
 *   - `detached + stdio: 'ignore'` + `unref()`：不阻塞宿主、不因为子进程还活着而吊住退出；
 *   - 一律挂 `error` 监听：spawn 失败（比如系统缺 `xdg-open`）只记日志，绝不让宿主抛未捕获异常；
 *   - 不支持的平台明确返回 `OPEN_UNSUPPORTED`，让 UI 说人话，而不是静默什么都不做。
 */
import { spawn } from 'node:child_process'

export const OPEN_COMMAND_BY_PLATFORM = Object.freeze({
  win32: 'explorer.exe',
  darwin: 'open',
  linux: 'xdg-open',
})

/** 平台 → 命令；不支持的平台返回 null（调用方据此报 OPEN_UNSUPPORTED）。 */
export function resolveOpenCommand(platform, target) {
  const command = OPEN_COMMAND_BY_PLATFORM[platform]
  if (command === undefined) return null
  // Windows 的 explorer 对带空格路径只接受"原样单参数"，不做任何引号拼装（spawn 不走 shell）。
  return { command, args: [target] }
}

/**
 * @returns `{ ok, code?, reason?, command?, path? }`（永不抛错）
 */
export async function openInFileManager(target, { platform = process.platform, spawnImpl = spawn, logger = null } = {}) {
  const spec = resolveOpenCommand(platform, target)
  if (spec === null) {
    return { ok: false, code: 'OPEN_UNSUPPORTED', reason: `当前平台（${platform}）没有可用的文件管理器打开方式` }
  }
  try {
    const child = spawnImpl(spec.command, spec.args, { detached: true, stdio: 'ignore' })
    child.on?.('error', error => {
      logger?.warn?.(`打开目录失败（${spec.command}）：${error?.message ?? String(error)}`)
    })
    child.unref?.()
    return { ok: true, command: spec.command, path: target }
  } catch (error) {
    return { ok: false, code: 'OPEN_FAILED', reason: error?.message ?? String(error) }
  }
}
