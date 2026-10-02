# dsh-BrittleBackup

DSH（DeepSeek Harness）的**配置 / 插件 / 模型配置**本地导出与导入还原插件，附带一份"兼容性全炸也能照着重配"的兜底文档。

远端传输（WebDAV / GitHub）与一键重启为**阶段二**，本期不做。

> ## 当前状态：设计阶段，尚未实现
>
> 仓库里目前**只有文档**，没有可安装的插件。**阶段一范围已冻结**（2026-10-02，见 [SCOPE-PHASE1.md](docs/SCOPE-PHASE1.md)），代码尚未开始。
>
> 不要尝试安装——`package.json` 与 `src/` 都还不存在。

---

## 阶段一做什么

只做**本地**，核心就是两件事：

| 能力 | 说明 |
|---|---|
| **导出备份** | 把配置、插件清单、模型配置、skills 导出成**一个目录**（写到用户自选位置），内容**逐项可勾选** |
| **导入还原** | 从该目录导入还原；**导入前做完整兼容性验证**（14 项），再预览 diff、逐项勾选、合并写入、失败回滚 |

**官方能力优先、尽量少写代码**：配置读写走宿主的 `settings` / `configEditor` 服务，不自己解析 YAML；产物是普通目录，不做压缩。目标是在阶段一**不搬运任何参考实现的代码**，把 DSH 升级导致的兼容风险压到最低。

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
| [docs/PROJECT-PLAN.md](docs/PROJECT-PLAN.md) | 完整项目方案。**§0 是产品边界的唯一权威来源**（U1–U33 + D1–D7），**§0.0** 是本期的冻结范围 |
| [docs/FORMAT.md](docs/FORMAT.md) | 备份产物的**对外契约**：目录结构、`backup.json` 结构、脱敏寻址、skills 目录、上限 |
| [docs/SECURITY.md](docs/SECURITY.md) | 密钥策略、脱敏三道防线、入站路由硬化、导入路径安全 |

---

## 阶段一边界（摘要）

| 维度 | 结论 |
|---|---|
| 界面 | 全部 UI 收在**一个顶层独立设置页**（`settings.section`）；**仅中文** |
| 导出形态 | **一个目录**：`backup.json` + `兜底文档.md` +（勾选时）`skills\` |
| 导出落点 | **用户自选目录**；插件不维护导出历史 |
| 导出可选项 | profile 配置 / 插件清单 / 模型配置 / skills 清单 / skills 文件 / 兜底文档，逐项可关 |
| 导入入口 | **只从本地目录**（不含远端下载与剪贴板粘贴） |
| 导入验证 | **§7 全 14 项兼容性验证**，逐项给出 可自动恢复 / 有风险 / 只能手工 |
| 配置处理 | 走官方 `settings` / `configEditor`；**放弃保留注释与行顺序**，按条目 `id` 合并 |
| skills | 清单默认包含；文件需显式勾选，落地为 `skills\` 子目录（**不用 zip**） |
| 兜底文档 | **自包含、可单独分享**，不含配置原文、主机信息与本机路径 |
| 重启 | 导入完成后**只提示**需要重启，不自动重启 |
| 密钥 | 永不读取值、永不写入产物；脱敏以 `settings.describe({ redactSecrets: true })` 为权威依据 |
| Agent | **不能**触发导出或导入，只能人工操作 |
| 明确不做 | 远端传输、一键重启、双语、定时自动备份、增量与云同步、多用户共享、产物加密 |

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
├─ docs/                 # ✅ 方案 / 阶段一范围 / 格式契约 / 安全策略
├─ package.json          # ⏳ 待创建
├─ cordis.patch.yml      # ⏳ 待创建
├─ src/                  # ⏳ 采集 / 脱敏 / 文档 / 导出 / 导入 / 快照
├─ client/               # ⏳ 设置页 UI
└─ test/                 # ⏳ 单元 + 集成 + fixtures
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
