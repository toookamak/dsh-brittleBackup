/** 测试用样例产物（结构对齐 FORMAT.md，不是真实导出结果）。 */
import { buildArtifact } from '../../src/artifact.js'

export const DEFAULT_ENTRIES = [
  {
    id: 'llm-pi-ai',
    name: '@deepseek-ai/dsh-llm-pi-ai',
    override: {
      providers: {
        xiuxian: {
          displayName: '修仙',
          apiKeyEnv: 'XIUXIAN_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://xiuxian.pro/v1',
          models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 1000000, maxTokens: 256000, input: ['text', 'image'] }],
        },
      },
    },
    inherited: {},
    secrets: [{ path: ['providers', 'xiuxian', 'apiKey'], set: false }],
    redactions: [],
  },
  {
    id: 'agent-default-model',
    name: '@deepseek-ai/dsh-agent-default-model',
    override: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
    inherited: {},
    secrets: [],
    redactions: [],
  },
]

export function sampleArtifact(overrides = {}) {
  const clone = value => (value === undefined ? undefined : structuredClone(value))
  return buildArtifact({
    options: { profile: true, plugins: true, models: true, skills: true, skillFiles: false, doc: true, ...overrides.options },
    producer: {
      plugin: 'dsh-brittle-backup',
      pluginVersion: '0.1.0',
      dshVersion: '0.2.0-rc.2',
      hostRuntime: { node: '22.23.1', platform: 'win32', arch: 'x64' },
      hostname: 'DESKTOP-TEST',
      ...overrides.producer,
    },
    items: {
      config: { source: 'config-editor', entries: clone(overrides.entries) ?? clone(DEFAULT_ENTRIES) },
      files: clone(overrides.files) ?? [
        { path: 'package.json', json: { name: 'dsh-profile-desktop', dependencies: { dshmarket: '^1.66.7' } } },
        { path: 'pnpm-workspace.yaml', text: 'allowBuilds:\n  - esbuild\n' },
      ],
      absent: ['cordis.yml'],
      redactions: overrides.redactions ?? [],
      plugins: clone(overrides.plugins) ?? [
        {
          name: 'dshmarket', spec: '^1.66.7', resolvedVersion: '1.66.7', source: 'registry', commit: null,
          bundle: true, enabled: true, description: '可视化插件市场', installCommand: 'dsh plugin add dshmarket@1.66.7', unportable: false,
        },
      ],
      models: clone(overrides.models) ?? [
        {
          provider: 'xiuxian', displayName: '修仙', api: 'openai-completions', baseURL: 'https://xiuxian.pro/v1',
          apiKeyEnv: 'XIUXIAN_API_KEY', models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 1000000, maxTokens: 256000, input: ['text', 'image'] }],
        },
      ],
      defaultModel: clone(overrides.defaultModel) ?? { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
      requiredCredentials: clone(overrides.requiredCredentials) ?? ['XIUXIAN_API_KEY'],
      skills: clone(overrides.skills) ?? [{ name: 'example-skill', description: '示例', path: 'skills/example-skill', scope: 'user', files: 1, included: false }],
      stats: { entryCount: 2, fileCount: 2, bytes: 0, itemCounts: { plugins: 1, models: 1, skills: 1 } },
    },
  })
}
