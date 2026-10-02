# 备份产物格式（FORMAT）

> **本文是对外契约。** 任何消费本产物的程序都应只依赖本文描述的内容；本文未描述的一律视为实现细节。
>
> **适用范围：阶段一（仅本地导出 / 导入）。** 范围见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)，边界见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §0，安全策略见 [SECURITY.md](SECURITY.md)。

---

## 1. 产物 = 一个目录（U30）

一次导出产生**一个目录**，写在用户自选的位置（U31）：

```
<用户自选目录>\dsh-brittle-backup-<ts>\
├─ backup.json          # 权威产物；导入只读它
├─ 兜底文档.md           # 附件：自包含、可单独分享（U2 / U5）
└─ skills\              # 附件：仅当导出时勾选了"连文件一起"
   ├─ <skill-name>\
   └─ <skill-name>\
```

- `<ts>` = `YYYYMMDD-HHmmss`（导出机器的本地时间）。
- 目录名固定此前缀，便于在文件堆里识别与批量拷贝。
- **没有压缩包**：本地目录不需要 zip，因此不引入压缩依赖，也没有 2 MiB / 256 文件这类为远端限额而设的约束。
- **附件缺失不影响产物有效**：`兜底文档.md` 或 `skills\` 缺失时 `backup.json` 仍然有效，导入侧如实报告"该附件不存在"。
- 换机器迁移 = 拷贝整个目录。

---

## 2. `backup.json` 结构

```jsonc
{
  "format": "dsh-brittle-backup",
  "version": 1,                          // 格式版本；不认识的值一律拒绝执行导入
  "createdAt": "2026-10-02T02:22:55.000Z",
  "producer": {
    "plugin": "dsh-brittle-backup",
    "pluginVersion": "0.1.0",
    "dshVersion": "0.2.0-rc.2",          // 导出时的宿主 desktopVersion
    "hostRuntime": { "node": "24.21.0", "platform": "win32", "arch": "x64" }
  },

  "options": {                           // 本次导出**实际**勾选了哪些，供导入侧如实报告
    "profile": true, "plugins": true, "models": true,
    "skills": true, "skillFiles": false, "doc": true
  },

  "items": {
    // ---- profile 配置：结构化条目（U32，经 configEditor / settings 读取）----
    "config": {
      "source": "config-editor",
      "entries": [
        {
          "id": "llm-pi-ai",
          "name": "@deepseek-ai/dsh-llm-pi-ai",
          "override": {
            "providers": {
              "xiuxian": {
                "displayName": "修仙",
                "apiKeyEnv": "XIUXIAN_API_KEY",
                "api": "openai-completions",
                "baseURL": "https://xiuxian.pro/v1",
                "models": [
                  { "id": "gpt-6-luna", "name": "GPT-6 Luna",
                    "contextWindow": 1000000, "maxTokens": 256000, "input": ["text", "image"] }
                ]
              }
            }
          },
          "inherited": { },              // bundle 层继承值：只读参考，**不参与还原**
          "secrets": [                   // 密钥**路径图**（只有路径与"是否设置"，绝无值）
            { "path": "providers.xiuxian.apiKey", "set": false }
          ]
        }
      ]
    },

    // ---- 无法走结构化服务的文件：按原文或 JSON 保存 ----
    "files": [
      { "path": "package.json",        "json": { /* 原文对象 */ } },
      { "path": "pnpm-workspace.yaml", "text": "allowBuilds:\n  - esbuild\n" }
    ],
    "absent": ["cordis.yml"],             // 导出时确认不存在；**不是删除指令**

    "redactions": [
      {
        "kind": "entry",                  // "entry" | "file"
        "ref": "llm-pi-ai",               // entry id，或文件相对路径
        "pointer": "/override/providers/xiuxian/apiKey",   // 相对该对象的 RFC 6901 JSON Pointer
        "reason": "inline-secret",
        "note": "恢复后请在设置中补 key（原为内联值）"
      }
    ],

    "plugins": [
      {
        "name": "dshmarket", "spec": "^1.66.7", "resolvedVersion": "1.66.7",
        "source": "registry",             // registry | github | local-path | unknown
        "commit": null,                   // git 来源时记录，便于人工核对
        "bundle": true,
        "description": "Visual plugin market …",
        "installCommand": "dsh plugin add dshmarket@1.66.7",
        "unportable": false               // true = 跨机器恢复会失败（如绝对路径依赖）
      }
    ],

    "models": [                           // 从 config 派生，便于生成文档与人工阅读
      { "provider": "xiuxian", "displayName": "修仙", "api": "openai-completions",
        "baseURL": "https://xiuxian.pro/v1", "apiKeyEnv": "XIUXIAN_API_KEY",
        "models": [ { "id": "gpt-6-luna", "name": "GPT-6 Luna",
                      "contextWindow": 1000000, "maxTokens": 256000, "input": ["text", "image"] } ] }
    ],
    "defaultModel": { "provider": "deepseek-account", "model": "deepseek-flash", "reasoningEffort": "high" },

    "requiredCredentials": ["MPLAN_API_KEY", "XIUXIAN_API_KEY"],   // 只有名字

    "skills": [
      { "name": "example-skill", "description": "…", "path": "skills/example-skill",
        "scope": "user", "files": 3,
        "included": false }               // true = 文件已在产物的 skills\ 下
    ],

    "stats": { "entryCount": 8, "fileCount": 2, "bytes": 8123,
               "itemCounts": { "plugins": 5, "models": 2, "skills": 1 } }
  },

  "doc": { "file": "兜底文档.md", "format": "markdown",
           "title": "# DSH 配置兜底文档（dsh-BrittleBackup 生成）" }
}
```

### 关键约束

- `redactions[]` 是**必填字段**（可为空数组）：它让导入侧能精确提示"哪一项需要重新填 key"。
- `format` / `version` 是唯一全局闸门：不等于 `dsh-brittle-backup` / `1` 时**拒绝执行导入，仅允许预览**。
- `absent[]` **不是删除指令**；导入侧永不因它而删除文件（合并语义）。
- 任何文件 `path` 都必须是相对路径、禁止 `..`、禁止命中排除名单。
- **消费者必须忽略未知字段**：新增**可选**字段不提升 `version`；只有破坏性变更才提升。

---

## 3. 结构化配置的取舍（U32）

| 项 | 说明 |
|---|---|
| 读取 | `configEditor.configuration()` 的**原始 override**（完整，不受 schema 投影丢字段影响） |
| 密钥路径图 | `settings.describe({ redactSecrets: true })` 的 `secrets[].path` + `set`（**权威脱敏来源**，不用于取值） |
| 写回 | `configEditor.edit(entry, change)`，**按条目 `id` 合并** |
| **丢失** | 配置文件中的**注释与行顺序** |
| 不还原 | `inherited`（bundle 层继承值）只作参考 |

> 这一取舍顺带解决了原方案长期存在的矛盾："按条目 id 合并"与"保留行形式"本来不可兼得。代价是注释不再保留。

---

## 4. 脱敏（`redactions[]` 与 `secrets[]`）

- `secrets[]` 是**路径图**：只有路径与布尔值，**永不含值**。
- `redactions[]` 记录**实际被剥离**的位置，形状为 `{ kind, ref, pointer, reason, note }`：`pointer` 是相对该 entry / 该文件的 RFC 6901 JSON Pointer。
  （早期草案曾用 `yaml` / `line` 寻址，因为当时配置以**行数组**保存；既然配置已结构化，寻址统一收敛为 JSON Pointer。）
- 剥离必须**幂等**：已剥离的值再次扫描不得报错或重复剥离。
- `apiKeyEnv` 一类的**名字指针不得被剥离**——它是名字不是值。

---

## 5. 导入侧必须做的校验

1. `format` / `version` 闸门。
2. 逐条校验 `path`：相对路径、无 `..`、未命中排除名单、无重复。
3. 写入目标已存在但不是普通文件（目录 / 符号链接）→ 拒绝该项。
4. 条目数 / 体积上限（宽松防爆，见 §7）。
5. 兼容性验证 §7 全 14 项（见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §7）。
6. DSH 版本差异与环境差异对照（U14）→ 报告，**不阻断**。

---

## 6. `skills\` 目录（U11 / U17）

```
skills\
├─ <skill-name>\        # 原样复制的文件树
└─ <skill-name>\
```

- 只包含 `scope: "user"` 的 skills（`<DSH_HOME>\skills`）；项目级 skills 只记录不复制。
- 仅当导出时勾选"连文件一起"才生成；对应 `skills[].included` 为 `true`。
- 同名冲突由用户在导入时选择 覆盖 / 跳过 / 重命名（[PROJECT-PLAN.md](PROJECT-PLAN.md) §7-#9）。
- 目录内文件**不做逐字段脱敏**；取而代之的是导出前的整体密钥自查，命中即拦截（见 [SECURITY.md](SECURITY.md)）。

---

## 7. 上限（宽松防爆）

阶段一没有远端限额，因此不设产品级硬上限，只保留防止异常产物撑爆磁盘的宽松边界：

| 项 | 上限 | 超限行为 |
|---|---|---|
| `backup.json` | 64 MiB | 明确报错，**不静默截断** |
| 文件条目数 | 20000 | 同上 |
| 单个 skill 文件 | 16 MiB | 跳过该文件并在报告中列出 |
| skills 文件总数 | 10000 | 同上 |

---

## 8. 阶段二的预留

远端传输与多目标为**阶段二**，本期不实现。为将来留出空间：

- 本期**不写入** `targets[]`；将来新增该**可选**字段不提升 `version`（消费者必须忽略未知字段）。
- 本期不生成 `latest.json` 与 skills zip；将来引入时同样作为可选附加物。

---

## 9. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-10-01 | 初版：单文件产物 + skills zip + 远端目标 |
| 2026-10-02 | **随阶段一重构**：产物改为一个**目录**；skills 改为 `skills\` 子目录（去掉 zip）；配置改为**结构化条目**；脱敏寻址统一为 JSON Pointer；去掉远端目标 / 历史 / 远端保留；上限改为宽松防爆；新增 `options`（实际勾选）与阶段二预留说明 |
