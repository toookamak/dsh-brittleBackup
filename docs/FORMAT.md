# 备份产物格式（FORMAT）

> **本文是对外契约。** 任何消费本产物的程序都应只依赖本文描述的内容；本文未描述的一律视为实现细节。
>
> **本文是产物 schema 的唯一权威。** [PROJECT-PLAN.md](PROJECT-PLAN.md) §5.1 的早期 JSON 草案（单文件、`files[].lines`、内嵌 `doc.content`、zip 附件、上传语义）**已作废**，只保留为历史记录，与本文件冲突时以本文件为准。
>
> **适用范围：阶段一（仅本地导出 / 导入）。** 范围见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)，边界见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §0，安全策略见 [SECURITY.md](SECURITY.md)，服务签名与路由见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §17。

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
- **重名**：目标位置已存在同名目录时追加 `-2`、`-3` 后缀，**绝不覆盖**既有数据。
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
    "dshVersion": "0.2.0-rc.2",          // 取核心 bundle @deepseek-ai/dsh-base 的版本；取不到写 "unknown"
    "hostRuntime": { "node": "24.21.0", "platform": "win32", "arch": "x64" },
    "hostname": "DESKTOP-EXAMPLE"        // U36：主机名。属本机信息，**只进 JSON，绝不进兜底文档**
  },

  "options": {                           // 本次导出**实际**勾选了哪些，供导入侧如实报告
    "profile": true, "plugins": true, "models": true,
    "skills": true, "skillFiles": false, "doc": true
  },

  "items": {
    // ---- profile 配置：结构化条目（U32 / U36，经 configEditor / settings 读取）----
    "config": {
      "source": "config-editor",
      "entries": [
        {
          "id": "llm-pi-ai",             // patch 目标 id，即 profile 的 cordis.patch.yml 里 `- id:` 的值
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
            { "path": ["providers", "xiuxian", "apiKey"], "set": false }
          ]
        }
      ]
    },

    // ---- 无法走结构化服务的文件：按原文或 JSON 保存 ----
    "files": [
      { "path": "package.json",        "json": { /* 原文对象；只读采集，本插件不写回（U37） */ } },
      { "path": "pnpm-workspace.yaml", "text": "allowBuilds:\n  - esbuild\n" }
    ],
    "absent": ["cordis.yml"],             // 导出时确认不存在；**不是删除指令**

    "redactions": [
      {
        "kind": "entry",                  // "entry" | "file"
        "ref": "llm-pi-ai",               // entry id，或文件相对路径
        "pointer": "/override/providers/xiuxian/apiKey",   // 相对 kind 所指对象的 RFC 6901 JSON Pointer
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
        "enabled": true,                  // U36：启用状态；false = 已装但被禁用/取消选择
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
- `producer.dshVersion` 是**必填字符串**，取不到宿主版本时写 `"unknown"`（不得省略字段）。

### 字段语义要点（补齐，避免实现者各自发明）

| 字段 | 口径 |
|---|---|
| `items.config.entries[]` | **只收录"用户 patch 层有 override"的条目**（U36）：`configEditor.configuration()` 里 `override` 为空的条目（纯 bundle 默认值 / 未定制）**不入产物**。loader 内部条目 id（实测形如 `include:llm-pi-ai`）不是产物标识，产物用 **patch 目标 id**（实测为 `llm-pi-ai`） |
| `items.config.entries[].inherited` | 只读参考，**不参与还原**；导入侧不得把它写进 profile |
| `items.files[]` | 只放**无法走结构化服务**的文件：`package.json`（JSON）与 `pnpm-workspace.yaml`（原文）。`cordis.patch.yml` **不在这里**，它的内容在 `items.config.entries[]` |
| `items.plugins[].enabled` | 导入侧据此决定分支：目标机**缺失** → `installBundle(spec, { enabled })`；**已装** → 用 `setBundleEnabled` / `setPluginEnabled` 对齐启用状态，**不重装** |
| `items.redactions[].pointer` | `kind: "entry"` 时基准对象是 `{ id, name, override, … }` 整个条目（故示例含 `/override/…` 前缀）；`kind: "file"` 时基准对象是该文件条目（`json` 或 `text`） |
| `items.redactions[]` 的构成 | **条目级剥离与文件级剥离都汇总到这里**：条目级写 `kind: "entry"` + `ref` = patch 目标 id；文件级写 `kind: "file"` + `ref` = 文件相对路径。（`items.config.entries[].redactions` 是实现侧镜像，方便 UI 定位；消费者只依赖 `items.redactions[]`） |
| `items.plugins[].installCommand` | registry 来源优先用解析到的**精确版本**（`dsh plugin add <name>@<resolvedVersion>`）；拿不到版本时用 `dsh plugin add <name>`；`github:` / `link:` / `file:` 等来源原样用 spec |
| `items.skills[].path` | 相对产物根的**逻辑路径**（`skills/<name>`），不是导出机器上的绝对路径 |
| `options` | 记录**实际**勾选结果，导入侧据此区分"用户没要"与"采集失败"：关掉的项在 `options` 里为 `false`，且对应内容**确实为空数组 / 缺省** |

---

## 3. 结构化配置的取舍（U32）

| 项 | 说明 |
|---|---|
| 读取 | `configEditor.configuration()` 的**原始 override**（完整，不受 schema 投影丢字段影响） |
| 密钥路径图 | `settings.describe({ redactSecrets: true })` 的 `secrets[].path`（**是字符串数组**，宿主契约 `RedactedSecret = { path: string[]; set: boolean }`）+ `set`（**权威脱敏来源**，不用于取值） |
| 收录范围 | 只有 `override` 非空的条目（U36）；bundle 提供的 insert 与默认值不导出 |
| 写回 | `configEditor.edit(entry, change)`，**按 patch 目标 `id` 合并**；同 id 已存在且值不同 → 展示 diff，**默认保留目标机**（§7-#12），用户显式勾选才覆盖 |
| **丢失** | 配置文件中的**注释与行顺序** |
| 不还原 | `inherited`（bundle 层继承值）只作参考 |
| 本插件自身 entry | 同其他条目处理（会随配置导出）；因为它可能含"上次导出目录"这类本机路径，导入时按同 id 冲突处理，默认保留目标机当前值 |

> 这一取舍顺带解决了原方案长期存在的矛盾："按条目 id 合并"与"保留行形式"本来不可兼得。代价是注释不再保留。

---

## 4. 脱敏（`redactions[]` 与 `secrets[]`）

- `secrets[]` 是**路径图**：`path` 为**字符串数组**（宿主契约），只有路径与布尔值，**永不含值**。
  > ⚠️ 早期草案把它写成点分字符串（`"providers.xiuxian.apiKey"`），与宿主 `RedactedSecret.path: string[]` 不符，**已纠正为数组**。
- `redactions[]` 记录**实际被剥离**的位置，形状为 `{ kind, ref, pointer, reason, note }`：`pointer` 是相对该 entry / 该文件对象的 RFC 6901 JSON Pointer（基准见 §2 字段语义要点）。
- **条目级与文件级的剥离都汇总进 `items.redactions[]`**（`kind` 区分），它是验收"`redactions[]` 与实际剥离项一致"的唯一依据。
- 剥离必须**幂等**：已剥离的值再次扫描不得报错或重复剥离。
- `apiKeyEnv` 一类的**名字指针不得被剥离**——它是名字不是值。
- **`<REDACTED>` 不参与任何还原**：导入侧**绝不**把占位符写回配置或 YAML 片段，只在报告里列出被跳过的位置（`redactedSkipped`），并在兜底文档里提示"这一项要自己填"。
- **自查扫描的防假阳性**：`long-hex` / `long-base64` 在哈希状指针（`commit` / `dshVersion` / `pluginVersion` / `createdAt` / `hostname` / `node` / `platform` / `arch` / `resolvedVersion`）上跳过，纯十六进制串不按 base64 判 —— 否则含 git commit 的产物会被自己拦下。

---

## 5. 导入侧必须做的校验

1. `format` / `version` 闸门。
2. **来源选择**：所选目录自身含 `backup.json` → 直接用；否则在其直接子目录里找匹配 `dsh-brittle-backup-*` 且含 `backup.json` 的目录 —— 一个 → 直接用，多个 → 列出候选让用户选，零个 → 报错并说明期望结构。
3. 逐条校验 `path`：相对路径、无 `..`、未命中排除名单、无重复。
4. 写入目标已存在但不是普通文件（目录 / 符号链接）→ 拒绝该项。
5. 条目数 / 体积上限（宽松防爆，见 §7）。
6. 兼容性验证 §7 全 14 项（见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §7）。
7. DSH 版本差异与环境差异对照（U14）→ 报告，**不阻断**。

> **第 1–7 步全程只读**：校验与预览（含 diff）**不得写任何文件**；写入只发生在用户勾选并确认之后（见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §2.2）。

---

## 6. `skills\` 目录（U11 / U17）

```
skills\
├─ <skill-name>\        # 原样复制的文件树（可含子目录与二进制文件）
└─ <skill-name>\
```

- 只包含 `scope: "user"` 的 skills（`<DSH_HOME>\skills`）；项目级 skills 只记录不复制。
- 仅当导出时勾选"连文件一起"才生成；对应 `skills[].included` 为 `true`。
- **原样 = 逐字节**：子目录结构、空目录、二进制文件都要保留（不能用只写文本的接口搬运）。
- 同名冲突由用户在导入时选择 覆盖 / 跳过 / 重命名（[PROJECT-PLAN.md](PROJECT-PLAN.md) §7-#9）。
- 目录内文件**不做逐字段脱敏**；取而代之的是导出前的整体密钥自查，命中即拦截（见 [SECURITY.md](SECURITY.md)）。
- 目录树的复制 / 删除需要宿主 `fs` 服务没有的原语，因此本项使用**受限 `node:fs`**（[SCOPE-PHASE1.md](SCOPE-PHASE1.md) §4.6，U34）。

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
| 2026-10-02 | **第二次修订（契约收口）**：`secrets[].path` 纠正为**字符串数组**；`plugins[]` 新增 `enabled`（U36）；`producer` 新增 `hostname`，并明确 `dshVersion` 取不到时写 `"unknown"`；新增"字段语义要点"（entries 收录范围与 patch 目标 id、pointer 基准、files 边界、自身 entry 处理）；§5 新增来源选择规则与"1–7 步只读"；§6 明确 skills 为逐字节复制；顶部声明本文为 schema 唯一权威、PROJECT-PLAN §5.1 作废 |
