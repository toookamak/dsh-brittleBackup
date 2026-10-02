# dsh-BrittleBackup

DSH（DeepSeek Harness）的**配置 / 插件 / 模型配置**本地导出与导入还原插件，附带一份"兼容性全炸也能照着重配"的兜底文档。

远端传输（WebDAV / GitHub）与一键重启为**阶段二**，本期不做。

> ## 当前状态：M0–M4 已实现，等你装进 DSH 验证（M5）
>
> **阶段一范围已冻结**（2026-10-02，见 [SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md)）；同日**第二次修订补齐实现契约**（服务签名 / 路由 / 客户端半 / 回滚策略，见 [PROJECT-PLAN.md](docs/PROJECT-PLAN.md) §17）。
>
> 已完成 **M0 骨架 + M1 采集与产物 + M2 导入还原 + M3 兜底文档定稿 + M4 设置页 UI**：宿主半与客户端半都是**纯手写 ESM、零依赖、零构建**。
>
> 验证方式：`npm run verify`（语法/打包契约自检 + 95 个 `node --test` 断言，含客户端半的宿主侧仿真与**走本机路由的端到端**用例）。**真实 DSH 里的加载与卸载尚未验证** —— 那正是留给你的 M5（安装步骤见下文）。

---

## 安装到 DSH（本地路径）

本插件还没发布到 npm，所以用**本地路径**安装（DSH Desktop）：

1. 打开 **设置 → 插件**（插件管理器），在安装输入框里填本仓库的绝对路径，例如 `F:\Git\dsh-brittleBackup`。
2. 安装会往当前 profile 的依赖里加一条 `dsh-brittlebackup`，**需要重启 DSH** 才生效。
3. 重启后打开 **设置 → 兜底备份**，应能看到三个功能区：导出 / 导入（含备份配置查询）/ 任务进度。

> 本机 `dsh` 不在 PATH 上（桌面版由宿主启动），所以别用命令行 `dsh plugin add`；走插件管理器里的安装入口。

**验证清单（M5，装好后逐条打勾）**

- [ ] 设置页出现「兜底备份」，顶部显示服务探测（configEditor / pluginManager / credentials / skills）。
- [ ] 选一个空目录 → 勾选项 → 默认开始导出 → 落点里得到 `dsh-brittle-backup-<ts>.zip`（取消压缩则得到同名目录）；zip 内有 `backup.json` + `兜底文档.md`（勾了 skills 文件还会有 `skills\`）。
- [ ] 从含 zip 的目录预览 → 自动解压并跑验证；目录形态仍可用 `node scripts/doc-audit.mjs "<产物目录>"` 打印「盲测检查通过」。
- [ ] 预览一份产物（只读）→ 人话摘要、可展开的 14 项验证表与导入计划出现 → 勾选 → 开始导入 → 报告含成功 / 失败 / 需手工 / 需补 key。
- [ ] 在②导入还原中选择备份目录或 zip → 打开「备份配置查询 / 复制」→ 读取 backup.json 生成安全摘要；需要时勾选详细结构 → 复制或下载文本。查询文本不包含密钥值、主机名和本机绝对路径。
- [ ] 导入中途点「取消」→ 报告显示已回滚；`<DSH_HOME>\dsh-brittle-backup\snapshots\` 里有本次快照。
- [ ] 卸载插件后 profile 无残留（本插件**不写** profile 配置，`cordis.patch.yml` 里只有它自己的一个 insert 条目）。

**出问题先看这里**

- 设置页没出现：确认 DSH 已重启，且 `package.json` 里的 `dsh.client` / `exports["./client"]` 没被改动。
- 提示「服务不可用 / 降级」：宿主缺 `configEditor` 或 `settings` 时配置条目不自动还原，其余功能照常（见 [SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md) §4.2）。
- 路由返回 403：请用 `http://127.0.0.1:<端口>` 打开（同源 + loopback 是硬要求）。

---

## 常用命令

```powershell
npm run verify                       # 自检（语法 + 打包契约 + 无网络代码）+ 95 个 node:test 断言
npm run check                        # 只跑自检
npm test                             # 只跑测试
node scripts/doc-audit.mjs "<产物目录>"   # 审计一份目录形态产物的兜底文档（S4 盲测）
```

---

## 阶段一做什么

只做**本地**，核心就是两件事：

| 能力 | 说明 |
|---|---|
| **导出备份** | 把配置、插件清单、模型配置、skills 导出成目录并默认压缩为同名 ZIP（写到用户自选位置），内容**逐项可勾选**；成功结果显示最终完成时间 |
| **导入还原** | 从该目录导入还原；**导入前做完整兼容性验证**（14 项），再预览 diff、逐项勾选、合并写入、失败回滚 |

**官方能力优先、尽量少写代码**：配置读写走宿主的 `settings` / `configEditor` 服务，不自己解析 YAML；导出默认将产物目录打成同名 `.zip`（可取消勾选保留目录），导入支持目录与 zip 自动解压。唯一例外是**文件系统操作**——宿主 `fs` 服务没有删除 / 建目录 / 写二进制原语，快照与回滚、skills 目录树复制、zip 临时落盘因此用**受限 `node:fs`**（三处范围见 [SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md) §4.6）。目标是在阶段一**不搬运任何参考实现的代码**，把 DSH 升级导致的兼容风险压到最低。

---

## 它解决什么问题

DSH 生态里已有的备份能力（以 MIT 许可的 **dsh-market** 为代表）覆盖了 profile 配置与插件重装，但留下三个真实缺口：

| # | 缺口 | 后果 |
|---|---|---|
| 1 | **skills 完全不在备份范围内** | `<DSH_HOME>\skills` 一个字节都不备（实测：dsh-market 的备份代码里 `skills` 零命中） |
| 2 | **模型配置没有"去 key"能力** | provider 声明就在 `cordis.patch.yml` 里，会被整文件备走；一旦有人内联了 `apiKey`，就会随备份一起被带走（dsh-market 只有"文件名看着像密钥"的启发式，对该文件无效） |
| 3 | 局域网 / 自建 WebDAV 被硬拒（**阶段二**） | 只允许 https + 公网 IP，自建 NAS、RFC1918 内网、Tailscale（`100.64/10`）、`*.local` 一律直接报错 |

另外还缺一份**人类可读的兜底文档**：已有备份都是给程序读的 JSON，一旦跨版本恢复失败，用户手里没有"照着敲就能重配"的材料。

本项目的定位就是**补齐这些缺口 + 交付一份可单独分享的兜底文档**，而不是重写已有能力。

---

## 文档

| 文档 | 内容 |
|---|---|
| [docs/SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md) | **阶段一的权威范围**：做什么、不做什么、对产品边界的修订、技术取舍与验收清单 |
| [docs/PROJECT-PLAN.md](docs/PROJECT-PLAN.md) | 完整项目方案。**§0 是产品边界的唯一权威来源**（U1–U37 + D1–D7），**§0.0** 是本期的冻结范围，**§17 是实现契约**（服务签名 / 路由接口 / 客户端半 / 回滚策略 / 采集口径 / 里程碑 / 待确认项） |
| [docs/FORMAT.md](docs/FORMAT.md) | 备份产物的**对外契约**：目录结构、`backup.json` 结构、脱敏寻址、skills 目录、上限 |
| [docs/SECURITY.md](docs/SECURITY.md) | 密钥策略、脱敏三道防线、入站路由硬化、导入路径安全 |

---

## 阶段一边界（摘要）

| 维度 | 结论 |
|---|---|
| 界面 | 全部 UI 收在**一个顶层独立设置页**（`settings.section`）；**仅中文** |
| 导出形态 | 默认一个同名 `.zip` 压缩包（取消压缩则为目录），内容仍是 `backup.json` + `兜底文档.md` +（勾选时）`skills\` |
| 导出落点 | **用户自选目录**；插件记住上次成功导出路径，可一键回填并打开文件管理器 |
| 导出可选项 | profile 配置 / 插件清单 / 模型配置 / skills 清单 / skills 文件 / 兜底文档 / zip 压缩，逐项可关；压缩默认开启 |
| 导入入口 | **只从本地目录**（不含远端下载与剪贴板粘贴） |
| 导入验证 | **§7 全 14 项兼容性验证**，逐项给出 可自动恢复 / 有风险 / 只能手工 |
| 导入取消 | 提供「取消」：停止剩余项 + 回滚已写入项；导出不可取消 |
| 配置处理 | 走官方 `settings` / `configEditor`；**放弃保留注释与行顺序**，按条目 `id` 合并（只收录有 override 的条目） |
| skills | 清单默认包含；文件需显式勾选，落地为 `skills\` 子目录（**不用 zip**，逐字节含二进制） |
| 文件操作 | 快照目录 / 用户选定导出目录 / `<DSH_HOME>\skills` 三处用**受限 `node:fs`**（宿主 `fs` 服务没有删除 / 建目录 / 写二进制原语） |
| 兜底文档 | **自包含、可单独分享**，不含配置原文、主机信息与本机路径 |
| 重启 | 导入完成后**只提示**需要重启，不自动重启 |
| 密钥 | 永不读取值、永不写入产物；脱敏以 `settings.describe({ redactSecrets: true })` 为权威依据 |
| 安装类写入 | `package.json` / `pnpm-lock.yaml` / bundle 启停由 `pluginManager` 独占，本插件只读采集 |
| 自身设置 | 存 `<DSH_HOME>\dsh-brittle-backup\settings.json`，**不写 profile 配置**（避免本机路径被备份带走，也避免为一个偏好项引静态依赖） |
| Agent | **不能**触发导出或导入，只能人工操作 |
| 明确不做 | 远端传输、一键重启、双语、定时自动备份、增量与云同步、多用户共享、产物加密、账号名采集 |

完整条目见 [SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md) 与 [PROJECT-PLAN.md](docs/PROJECT-PLAN.md) §0.0。

### 一条重要的降级边界

配置读写依赖宿主的 `settings` / `configEditor` 服务。**两者不可用时，本插件不改动 profile 配置**，只导出 / 导入插件清单、模型信息、skills 与兜底文档，并在界面明确提示——不再有"自己解析文件"的兜底路径（这是"少写代码"的代价）。

---

## 命名约定

| 用途 | 取值 |
|---|---|
| 仓库 / 展示名 | `dsh-BrittleBackup` |
| npm 包名 | `dsh-brittlebackup`（npm 新包强制全小写） |
| loader entry id | `brittle-backup`（UI 半 `brittle-backup-ui`） |
| 设置命名空间 | **与 entry id 相同**（DSH 的 settings 契约要求它是 profile entry id） |
| 插件内部工作目录 | `<DSH_HOME>\dsh-brittle-backup\`（仅用于快照与临时文件，**不是**导出历史） |

---

## 仓库结构

```
dsh-BrittleBackup/
├─ README.md             # ✅
├─ LICENSE               # ✅ MIT
├─ package.json          # ✅ 零依赖；main = src/index.js
├─ cordis.patch.yml      # ✅ insert: id = brittle-backup
├─ docs/                 # ✅ 方案 / 阶段一范围 / 格式契约 / 安全策略
├─ scripts/
│   ├─ selfcheck.mjs     # ✅ 语法 + 打包契约 + 无网络代码断言
│   └─ doc-audit.mjs     # ✅ 兜底文档审计（S4 盲测自动化）
├─ src/
│   ├─ index.js          # 插件入口（name + apply，只挂路由）
│   ├─ routes.js         # 本机 HTTP 路由 + loopback/同源/白名单硬化
│   ├─ paths.js  log.js  nodefs.js  services.js  settings.js  task.js
│   ├─ redact.js  doc.js  artifact.js  export.js  credentials.js  semver.js  diff.js
│   ├─ collect/          # profile 条目 / 插件清单 / 模型 / skills + 总编排
│   └─ restore/          # host 现状 / 14 项检查 / 计划 diff / 快照回滚 / 应用 / 编排
├─ client/
│   └─ client.js         # ✅ 设置页 UI（手写、零构建的 __ModuleLoader__ bundle）
├─ test/                 # ✅ node:test（单元 + 端到端 + 路由硬化 + 客户端半仿真）
```

---

## 环境基线（实测）

| 项 | 值 |
|---|---|
| DSH Desktop | `0.2.0-rc.2`（`runtime.json` 的 `desktopVersion`） |
| 宿主运行时 | **Node 24.21.0 / pnpm 11.7.0**（`resources\runtime\primary-runtime\runtime.json`） |
| 系统 `node` | `C:\Program Files\nodejs\node.exe` v22.23.1 —— **不是宿主运行时**，勿混用 |
| `dsh` | **不在 PATH**（阶段二做一键重启时这一点是硬约束） |
| 平台 | Windows 11 |

---

## 许可与致谢

- 本仓库以 **MIT 许可证**发布，见 [LICENSE](LICENSE)（`Copyright (c) 2026 toookamak`）。
- 设计与实现参考 **dsh-market**（`dshmarket`，**MIT** 许可），尤其是 `lib/backup.js`（采集与排除项）、`lib/snapshot.js`（快照与回滚）、`lib/profile.js`（清单合并）。
- **阶段一的目标是不搬运其任何代码**（见 [SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md) §4.3）：上述参考仅用于设计思路。将来若实际借鉴代码，需额外保留其 MIT 声明（建议新增 `THIRD-PARTY-NOTICES`）。
- 参考 **@michengai/dsh-skills-manager** 的 skill 根目录解析方式。
