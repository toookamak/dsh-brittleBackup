/**
 * 采集 skills（FORMAT.md §6）。
 *
 * 元数据优先走宿主 `skills` 服务（`list()`），缺失则直接扫 `<DSH_HOME>\skills`
 * （user 级；项目级 skills 只记录不搬运，且本期不采集项目目录）。
 * 文件本体不在这一步搬运 —— 那是导出时"连文件一起"勾选项的事。
 */
import { join } from 'node:path'
import { skillsRoot } from '../paths.js'
import { service, hasMethod } from '../services.js'
import { listNames, listTree, pathExists, readTextFile } from '../nodefs.js'

/** 从 SKILL.md 的 front matter 里取 description（只读启发式，取不到就留空，不编造）。 */
export function descriptionFromSkillMd(text) {
  if (typeof text !== 'string' || text === '') return ''
  const lines = text.split(/\r?\n/)
  let index = 0
  if (lines[0]?.trim() === '---') index = 1
  const end = index === 1 ? lines.findIndex((line, at) => at > 0 && line.trim() === '---') : -1
  const limit = end === -1 ? Math.min(lines.length, 40) : end
  for (let cursor = index; cursor < limit; cursor += 1) {
    const matched = /^description:\s*(.*)$/.exec(lines[cursor])
    if (!matched) continue
    let value = matched[1].trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const parts = []
      for (let next = cursor + 1; next < limit; next += 1) {
        if (/^\s+\S/.test(lines[next])) parts.push(lines[next].trim())
        else if (parts.length > 0) break
      }
      value = parts.join(' ')
    }
    return value.replace(/^['"]|['"]$/g, '').trim()
  }
  return ''
}

/**
 * @returns {{skills:Array, root:string, rootExists:boolean, source:string, warnings:Array}}
 */
export async function collectSkills({ ctx, env = process.env } = {}) {
  const warnings = []
  const root = skillsRoot(env)
  const rootExists = await pathExists(root)
  const fromService = new Map()
  let source = 'dir'

  const skillsService = service(ctx, 'skills')
  if (hasMethod(skillsService, 'list')) {
    try {
      const listed = await skillsService.list({})
      if (Array.isArray(listed)) {
        source = 'service+dir'
        for (const item of listed) {
          const name = typeof item?.name === 'string' ? item.name : typeof item?.id === 'string' ? item.id : ''
          if (name !== '') fromService.set(name, item)
        }
      }
    } catch (error) {
      warnings.push(`skills 服务 list() 失败，改用目录扫描：${error?.message ?? String(error)}`)
    }
  } else {
    warnings.push('宿主没有可用的 skills 服务，skills 元数据来自目录扫描')
  }

  if (!rootExists) {
    return { skills: [], root, rootExists: false, source, warnings }
  }

  const skills = []
  for (const entry of await listNames(root)) {
    if (!entry.directory) continue
    const dir = join(root, entry.name)
    const tree = await listTree(dir)
    const fileCount = tree.filter(item => item.type === 'file').length
    const summary = fromService.get(entry.name)
    let description = typeof summary?.description === 'string' ? summary.description : ''
    if (description === '') {
      const skillMd = join(dir, 'SKILL.md')
      if (await pathExists(skillMd)) {
        try {
          description = descriptionFromSkillMd(await readTextFile(skillMd))
        } catch (error) {
          warnings.push(`读不到 ${entry.name}/SKILL.md：${error?.message ?? String(error)}`)
        }
      }
    }
    skills.push({
      name: entry.name,
      description,
      path: `skills/${entry.name}`,
      scope: 'user',
      files: fileCount,
      included: false,
      symlinks: tree.filter(item => item.type === 'symlink').length,
    })
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills, root, rootExists: true, source, warnings }
}
