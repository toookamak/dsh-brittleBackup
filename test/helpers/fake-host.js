/**
 * 测试用假宿主：一个内存版的 DSH 环境（configEditor / settings / pluginManager /
 * credentials / skills / agents / webServer），加一个临时 DSH_HOME 目录树。
 *
 * 只出现在 test/ 下，不参与插件运行。
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDir, writeJsonAtomic, writeTextAtomic } from '../../src/nodefs.js'

export const DEFAULT_PACKAGE_JSON = {
  name: 'dsh-profile-desktop',
  private: true,
  dsh: { profile: { bundles: ['dshmarket'] } },
  dependencies: { dshmarket: '^1.66.7' },
}

/**
 * @param options.records 配置条目：[{id, name, override, inherited}]（会被 configEditor 读写）
 * @param options.secretsByEntry `{ [patchId]: [{ path: ['providers','x','apiKey'], set: false }] }`
 */
export async function makeFakeHost(options = {}) {
  const {
    records = [],
    secretsByEntry = {},
    bundles = [],
    plugins = [],
    agentBusy = false,
    credentialConfigured = [],
    skills = {},
    patch = '# user patch\n',
    packageJson = DEFAULT_PACKAGE_JSON,
    workspace = 'allowBuilds:\n  - esbuild\n',
    lock = '',
    pickResult = null,
    failEditOn = null,
  } = options

  const root = await mkdtemp(join(tmpdir(), 'brittle-backup-'))
  const env = {
    DSH_HOME: join(root, '.dsh'),
    DSH_PROFILE: 'desktop',
    DSH_PROFILE_DIR: join(root, '.dsh', 'profiles', 'desktop'),
  }
  await ensureDir(env.DSH_PROFILE_DIR)
  await ensureDir(join(env.DSH_HOME, 'skills'))

  await writeJsonAtomic(join(env.DSH_PROFILE_DIR, 'package.json'), packageJson)
  await writeTextAtomic(join(env.DSH_PROFILE_DIR, 'pnpm-workspace.yaml'), workspace)
  await writeTextAtomic(join(env.DSH_PROFILE_DIR, 'cordis.patch.yml'), patch)
  if (lock !== '') await writeTextAtomic(join(env.DSH_PROFILE_DIR, 'pnpm-lock.yaml'), lock)

  for (const [name, files] of Object.entries(skills)) {
    await ensureDir(join(env.DSH_HOME, 'skills', name))
    for (const [rel, content] of Object.entries(files)) {
      await writeTextAtomic(join(env.DSH_HOME, 'skills', name, ...rel.split('/')), content)
    }
  }

  // 已安装插件的 node_modules 形态：版本 / peer / patch id 都从这里读（与真宿主一致）。
  for (const bundle of bundles) {
    if (typeof bundle?.name !== 'string') continue
    const dir = join(env.DSH_PROFILE_DIR, 'node_modules', ...bundle.name.split('/'))
    await ensureDir(dir)
    await writeJsonAtomic(join(dir, 'package.json'), {
      name: bundle.name,
      version: bundle.version ?? '0.0.0',
      description: bundle.description ?? '',
      peerDependencies: bundle.peerDependencies ?? {},
    })
    if (Array.isArray(bundle.patchIds) && bundle.patchIds.length > 0) {
      const lines = ['- insert:']
      for (const id of bundle.patchIds) {
        lines.push(`    - id: ${id}`)
        lines.push(`      name: '${bundle.name}'`)
      }
      await writeTextAtomic(join(dir, 'cordis.patch.yml'), `${lines.join('\n')}\n`)
    }
  }

  const calls = []
  const store = records.map(record => ({
    entry: {
      id: record.entryId ?? `include:${record.id}`,
      patchId: record.id,
      name: record.name ?? `@deepseek-ai/${record.id}`,
    },
    override: { ...(record.override ?? {}) },
    inherited: { ...(record.inherited ?? {}) },
  }))

  const configEditor = {
    entries: () => store.map(item => item.entry),
    configuration: async () => store.map(item => ({ entry: item.entry, inherited: item.inherited, override: item.override })),
    edit: async (entry, change) => {
      calls.push(['edit', entry.patchId ?? entry.id])
      if (failEditOn !== null && (entry.patchId === failEditOn || entry.id === failEditOn)) {
        throw new Error(`注入失败：${failEditOn}`)
      }
      const item = store.find(candidate => candidate.entry === entry || candidate.entry.id === entry.id || candidate.entry.patchId === entry.patchId)
      if (item === undefined) throw new Error(`configEditor 不认识条目 ${entry.id}`)
      item.override = change(item.override, item.inherited)
      return undefined
    },
  }

  const ctx = {
    get(key) {
      switch (key) {
        case 'configEditor':
          return configEditor
        case 'settings':
          return { describe: async () => Object.entries(secretsByEntry).map(([ns, secrets]) => ({ ns, secrets })) }
        case 'pluginManager':
          return {
            listBundles: async () => bundles,
            listPlugins: async () => plugins,
            installBundle: async (spec, installOptions = {}) => {
              calls.push(['install', spec, installOptions])
              return { changed: true, application: 'applied', target: spec }
            },
            waitForInstall: async () => null,
            cancelInstall: async () => ({ status: 'cancelled' }),
            setBundleEnabled: async (name, enabled) => {
              calls.push(['setBundleEnabled', name, enabled])
              return { changed: true, application: 'applied', target: name }
            },
            setPluginEnabled: async (id, enabled) => {
              calls.push(['setPluginEnabled', id, enabled])
              return { changed: true, application: 'applied', target: id }
            },
          }
        case 'credentials':
          return { describe: async ref => ({ configured: credentialConfigured.includes(ref) }) }
        case 'skills':
          return { list: async () => Object.keys(skills).map(name => ({ name, description: `desc:${name}` })) }
        case 'agents':
          return { list: () => [{ id: 'session-test', status: agentBusy ? 'running' : 'idle' }] }
        case 'webServer':
          return {
            register: route => {
              calls.push(['route', route.path, route.kind])
              return () => calls.push(['route-dispose', route.path])
            },
          }
        case 'directoryPickerController':
          return { pick: async () => pickResult }
        default:
          return undefined
      }
    },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    effect: callback => callback(),
    inject: (names, callback) => callback(ctx),
  }

  return { root, env, ctx, calls, records, store, entries: store.map(item => item.entry), configEditor }
}
