# dsh-BrittleBackup 项目方案

| 项目 | 内容 |
|---|---|
| 项目名 | `dsh-BrittleBackup`（仓库 / 展示名） |
| npm 包名 | `dsh-brittlebackup`（npm 新包名必须全小写，见下方命名约定） |
| 文档版本 | v3（**阶段一：仅本地导出 / 导入**，见 §0.0 与 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)） |
| 编写日期 | 2026-10-01（2026-10-02 重新冻结范围） |
| 基线环境 | DSH Desktop，profile `desktop`，host 版本 `0.2.0-rc.2`，Windows 11；**宿主运行时 Node 24.21.0 / pnpm 11.7.0**（实测 `resources\runtime\primary-runtime\runtime.json`；系统 `node` v22.23.1 不是宿主运行时，勿混用） |
| 状态 | **阶段一范围已冻结（2026-10-02，见 §0.0 与 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)）**：仅本地导出与导入还原、仅中文 |
| 一句话定位 | DSH 的**配置 / 插件 / 模型配置**本地导出与导入还原插件，附带一份"兼容性全炸也能照着重配"的兜底文档（远端传输与一键重启为**阶段二**，见 §0.0） |

> 本文件已落在仓库 `docs/` 下（见 §8.2 目录结构），是设计阶段的方案文档。文中所有"实测"结论均来自对当前这台机器 `C:\Users\Maxxie\.dsh`、DSH Desktop 安装目录（`D:\Program Files (x86)\DeepSeek Harness\resources`）与已安装插件源码的只读检查，**不含任何密钥值**。产品边界以 **§0** 为唯一权威，**本期（阶段一）范围见 §0.0 与 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)**；配套文档为 [FORMAT.md](FORMAT.md) 与 [SECURITY.md](SECURITY.md)。

### 命名约定（全局唯一来源，其它章节一律引用本表）

| 用途 | 取值 | 约束 / 依据 |
|---|---|---|
| 项目 / 仓库 / 展示名 | `dsh-BrittleBackup` | 自由命名 |
| npm 包名 | `dsh-brittlebackup` | npm 对**新包**强制全小写，不能直接叫 `dsh-BrittleBackup` |
| loader entry id | `brittle-backup`（UI 半用 `brittle-backup-ui`） | cordis 对重复 entry id 是整棵树起不来，必须独占前缀（实测 `duplicate loader entry id` 字符串存在于 dsh-market 的 7 个文件里） |
| 设置命名空间 | **与 loader entry id 相同 = `brittle-backup`** | 实测 `settings` 服务的 `update` / `replace` / `mutate` 的 `ns` 参数语义就是 "Profile entry id"，`describe()` 也按 entry id 索引；**另起一个名字会指向不存在的条目**（原稿此处写 `dsh-brittle-backup`，与本表 entry id 自相矛盾，已纠正） |
| 本地产物目录 | `<DSH_HOME>\dsh-brittle-backup\` | 与 profile 目录同级的用户数据目录 |
| 产物形态 | **一个目录**：`dsh-brittle-backup-<YYYYMMDD-HHmmss>\`，内含 `backup.json` + `兜底文档.md` +（勾选时）`skills\` | 阶段一为本地目录，无 zip、无体积硬上限（U30）；`latest.json` 与 skills zip 属阶段二 |
| 产物 `format` 字段 | `dsh-brittle-backup` | 与 `version` 共同构成对外契约 |
| 凭据 ref 名 | **阶段二**：基础名 `DSH_BRITTLE_BACKUP_GITHUB_TOKEN` / `DSH_BRITTLE_BACKUP_WEBDAV_PASSWORD`，按目标派生（如 `…_WEBDAV_PASSWORD__<目标id>`） | 阶段一为本地模式，**不需要任何凭据**；保留本行以免将来重命名 |
| 快照目录 | `<DSH_HOME>\dsh-brittle-backup\snapshots\` | 与 `.dsh-market\snapshots` 分开，互不干涉 |
| 兜底文档标题 | `# DSH 配置兜底文档（dsh-BrittleBackup 生成）` | 便于用户在文件堆里一眼认出 |

---

## 0. 产品边界（2026-10-01 冻结；2026-10-02 收缩为阶段一）

> **本节是唯一权威来源。** 与下文任何章节冲突时，以本节为准。
>
> 编号 `U*` 为边界条目，`D*` 为这些边界的推导结果。全部经用户逐条确认（`U30`–`U33` 为 2026-10-02 新增）。
>
> ⚠️ **2026-10-02 范围变更**：产品收缩为**阶段一 —— 仅本地导出与导入还原、界面与文档仅中文**。本期范围的权威描述是 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)；`U*` 条目中哪些本期撤销 / 后置、哪些收窄、哪些新增，见下方 §0.0。

### 0.0 本期范围（阶段一，2026-10-02 重新冻结）

**本期只做：本地导出备份 + 本地导入还原。** 不涉及任何网络传输；界面与文档仅中文。核心 = 导出、导入还原；导入前必须做兼容性验证；导出必须提供内容勾选。

| 状态 | 条目 |
|---|---|
| **本期撤销 / 后置** | U6 界面双语、U7/U8 一键重启、U9 凭据录入、U12 多目标、U15 凭据按目标派生、U22 文档语言设置、U23 / D2 / D3 历史与保留（导出文件由用户自行管理）、U25 中"导出后台跑"的部分、U26–U29 远端历史与清理、`D1`（语言设置） |
| **本期收窄** | U10 恢复入口 → **只从本地目录**（不再支持 WebDAV 下载与剪贴板粘贴）、U16 → **一份产物导出到用户自选目录**、U17 → skills 文件**以 `skills/` 子目录随导出目录一起走**（不再是 zip 附件） |
| **本期新增** | **U30** 导出形态 = 一个**目录**（`backup.json` + `兜底文档.md` + `skills/`）；**U31** 导出落点 = **用户自选目录**，插件不维护导出历史；**U32** profile 配置读写**走官方 `settings` / `configEditor` 服务**（结构化，放弃"保留注释与行形式"）；**U33** 导入后仍用 `credentials.describe()` 查"本机缺哪个 key" |
| **本期保留不变** | U1–U5（设置页 / 自包含可分享文档）、U11（skills 可勾选，落地为目录）、U13 场景、U14 环境差异对照、U18–U21（**含 §7 全 14 项兼容性验证**、合并写入、快照回滚、agent 忙碌拒绝）、U24（Agent 不可触发） |

**U32 的代价与后果（必须记录）**：

- **收益**：零 YAML 解析代码、零 `js-yaml` 类依赖；`cordis.patch.yml` 的读写走官方路径，天然抗 DSH 升级；同时解决了长期存在的"按 id 合并"与"保留行形式"不可兼得的矛盾。
- **代价**：**丢失配置文件里的注释与行顺序**。产物存"结构化条目"，恢复时按条目 `id` 合并写入。
- **后果（重要）**：原 §8.3 承诺的"服务缺失时降级为行级合并写入"**不再成立**。`settings` / `configEditor` 不可用时，降级收窄为"**只导出 / 导入插件清单与兜底文档，不改动 profile 配置**"，并在 UI 明示。
- **风险**：`settings.describe()` 按 schema 投影，可能漏掉未声明字段。因此读取必须以 `configEditor.configuration()` 的**原始 override** 为准，`settings.describe({ redactSecrets: true })` 只用于获取**密钥路径图**（`secrets[].path`），不用于取值。

### 0.1 形态与交互

| # | 边界 |
|---|---|
| U1 | 全部 UI 收在**一个顶层独立设置页**内：配置、触发、恢复、历史都在这一页 |
| U3 | 座位为 `settings.section`（顶层独立设置页），不是插件管理区里的子页 |
| U4 | 恢复的 diff 预览与逐项勾选**在页内子视图内联完成**；不开全屏浮层、不另开主面板 |
| U6 | 界面**中英双语**（走官方 locale 服务注册字典） |
| U10 | 恢复入口三种：本地文件、从已配置 WebDAV 下载、剪贴板粘贴 |
| U9 | WebDAV 密码 / GitHub Token **只能在本插件 UI 内录入**（DSH 自己的设置页不认识我们的 ref 名），只写凭据服务，**永不回显、永不进产物** |
| U22 | 兜底文档的**语言由用户设置**（中文 / 英文 / 双语，默认跟随界面） |
| U23 | 历史：列表 + 可设上限（超出自动清理）+ 支持手动删除 |
| U24 | **Agent 不能触发备份或恢复**，只能人工操作 |
| U25 | 备份 / 恢复**在后台继续跑**，关闭设置页不中断 |
| U7 | 恢复完成后提供「**一键立即重启**」 |
| U8 | 重启的启动方式**自研推导**（`process.execPath` + `process.argv[1]` + `ELECTRON_RUN_AS_NODE=1`），**不走 PATH 上的 `dsh` 回落**；需移植 Windows 硬化与恢复页（详见 §0.3） |

### 0.2 能力与场景

| # | 边界 |
|---|---|
| U12 | 目标数量**不限**：任意多个 WebDAV / GitHub 目标，各自可独立启停 |
| U16 | **一份产物发往所有目标**，逐目标报结果；**本地落盘成功即算"备份已完成"**（远端部分失败不算整体失败） |
| U15 | 每个目标的凭据**独立命名**（按目标派生 ref，见命名约定表） |
| U11 | skills 默认**只存清单**；用户可显式勾选"连文件一起"，以**独立 .zip 附件**带走；**仅本地 / WebDAV 支持，GitHub 因限额不支持** |
| U17 | 上述 skills 文件包为独立 `.zip` 附件，**不内嵌进 JSON**（避免 base64 膨胀与 2 MiB 上限） |
| U13 | 服务场景：**换机器迁移、同机灾后恢复、跨 DSH 版本**；**不含跨 profile** |
| U18 | 不做：定时 / 自动备份、增量与云同步、多用户与团队共享 |
| U19 | 不碰：会话历史、`storages`、`attachments`、`node_modules`、DeepSeek 登录态、`.credentials.yaml` |

### 0.3 行为与承诺

| # | 边界 |
|---|---|
| U20 | 备份内容 = profile 配置 + 插件清单 + 模型配置 + skills + 兜底文档。JSON 含主机名 / 账号名元数据，**绝不含密码 / Token** |
| U2 | UI 只服务**正常流程**；兜底文档必须**完全自包含、可单独分享**（不依赖插件、不依赖其他产物） |
| U5 | 兜底文档**只出 1 份**，**不含配置原文**、零主机信息 |
| U14 | **不写免责声明**；改用「恢复前展示本次备份 vs 当前环境的差异对照」（DSH 版本、缺失插件、缺失 key） |
| U21 | 除 `package.json` 读不到外，任何单项采集失败都不导致整体失败；恢复失败回滚到操作前、回滚不完整必须显式列出残留、有 agent 在运行时**拒绝**恢复 |

**U8 的落地要点（实测得来，不可省略）**：参考实现 dsh-market `lib/restart.js` 在**本机 Desktop 形态下会失败**——其 `dshArgv()` 主路径要求 `process.argv[1]` 以 `bin.js`/`bin.ts`/`dsh` 结尾，而 Desktop 下它是 `…\dsh-desktop-host\lib\cli.js`（不匹配）；回落路径依赖 `PATH` 上的 `dsh`，而本机 `dsh` 不在 PATH。正确配方见 `resources\runtime\cli\bin\dsh.cmd`：`"…\DeepSeek Harness.exe"` + `ELECTRON_RUN_AS_NODE=1` + `--expose-internals` + `<app.asar>\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`。另需移植：Windows 无控制台的隐藏控制台包装、端口释放竞态轮询（固定 sleep 会 `EADDRINUSE`）、失败诊断落盘与恢复页。

### 0.4 由边界推导出的行为（`D*`）

| # | 推导结果 | 依据 |
|---|---|---|
| D1 | 文档语言是设置项（中 / 英 / 双语，默认跟随界面）；选双语时出**同一份对照文档**，不出两个文件 | U22 |
| D2 | 历史显示每份的时间 / 体积 / 各目标结果；每份可**一键进入恢复向导**；手动删除**只删本地**，不动远端 | U23 |
| D3 | 历史默认保留最近 **10** 份（可改） | U23 |
| D4 | 插件**不向模型注册任何工具**，也不提供聊天命令入口（与 U1"只有设置页"、U24 一致） | U24 + U1 |
| D5 | 任务状态由**宿主侧持有**；重开设置页能看到进行中 / 已完成结果；**中途重启 DSH 会中断任务，不承诺续跑** | U25 |
| D6 | 必须提供**取消**；且「取消恢复」= 回滚到操作前 | U25 + U21 |
| D7 | 每个 WebDAV 目标各自带"允许局域网 / 私有地址"开关（双模式按目标落地） | U12 |

### 0.5 按建议生效（未收到异议）

- 卸载插件**不删除**本地产物与快照（那是用户数据）。
- 产物**不加密**（里面没有密码 / Token，但含主机名与模型结构）。
- 没有可用密码时，备份降级为"只落本地并提示"。
- 设置页顶部放一小段「**能做什么 / 不做什么**」的能力说明（用来替代免责声明，明确写出"skills 默认不搬文件""恢复前会给你差异对照"）。
- 每个目标提供「**测试连接**」（否则用户要等第一次备份失败才知道地址或密码错了）。

### 0.6 本次对正文的同步修改（2026-10-01，已完成）

> **2026-10-02 说明**：其中涉及**远端传输**与**重启**的修改项已随后续范围收缩而**后置**，以 §0.0 为准。本节保留为变更记录。

| 位置 | 原描述 | 已改为 |
|---|---|---|
| §1.1 / §3.5 / §5.1 / §5.2 | `dshmarket 1.66.6` | `1.66.7`（实测版本，profile spec `^1.66.7`） |
| §1.1 / §15 | `restoreBackup` 约 1176–1300 行 | 实测 1191–约 1294 行 |
| §15 | `webdavParents` | `webdavParentCollections`（保留原误写以便对照） |
| 文首基线 / §3.5 | "Node 22.x" | 宿主运行时 Node 24.21.0 / pnpm 11.7.0（并区分系统 node v22.23.1） |
| §1.2 | 密钥启发式只列 `config.toml`/`.env`/`secrets.json` | 补全 `SECRET_FILE_HINTS`（含 `pnpm-workspace.yaml`）、`SKIP_NAMES`、`.bak` |
| 命名约定 / §6.3 / §16-D4 | 设置命名空间 `dsh-brittle-backup`；固定单一凭据 ref | 命名空间 = entry id `brittle-backup`；凭据按目标派生 |
| §4.1 | skills"文件搬运放 v1.1" | 可选独立 zip 附件（U11 / U17） |
| §4.3 | 多目标 / skills 文件搬运列为 v1.1–v2.0 | 加注"已被 §0 部分取代" |
| §5.1 | "超限即拒绝并提示 skills 文件搬运请用 v1.1" | 附件超限只跳附件、保留 JSON |
| §5.2 | 文档模板第 6 节"完整配置原文" | 删除该节；补语言规则与"不得含主机名 / 原文" |
| §6.6 | "不得承诺自动生效"，仅提示 | 一键立即重启 + 宿主无重启服务的事实 + 失败必须留证据 |
| §8.1 / §8.2 | "Client 半（可选）"、"client/ 可选 UI（v1.1）" | 首版范围内的设置页 UI |
| §15 | `dsh-cli.js` "不推荐采用" | 补 `restart.js` / `recovery.js` / `dsh.cmd` 为**首版需移植**的参考 |
| §16 | Q1 / Q2 未决 | 已解决；D4 命名同步 |
| 附录 A 第 4 条 | "UI 放最后" | UI 是首版交付 |

### 0.7 追加边界（Q3 结案，2026-10-01）🔜 阶段二

> **本节全部条目（U26–U29）已随后续范围收缩而撤销 / 后置**，以 §0.0 为准；保留在此仅供阶段二参考。
>
> 原结论摘要：Gist = 覆盖式；WebDAV 与 GitHub 私有仓库 = 保留历史；远端也自动保留最近 N 份（需 `PROPFIND` 枚举 + `DELETE` 清理，且删除目标只能来自枚举结果）；GitHub 两个后端都做。

| # | 边界 |
|---|---|
| U26 | **每个目标有自己的历史模式**：Gist = 覆盖（远端只留最新一份）；WebDAV = 保留历史（按时间戳逐份上传）；GitHub 私有仓库 = 保留历史 |
| U27 | **GitHub 两个后端都做**：Gist + 私有仓库 Contents API（后者由"后置"提前进首版范围） |
| U28 | **远端也自动保留最近 N 份**：超出后删除旧版本。这要求新增两项本项目此前没有的能力——**远端枚举**（WebDAV `PROPFIND` / Contents API list）与**远端删除**（`DELETE`）。⚠️ 本机参考实现 dsh-market **两者都没有**，属从零实现 |
| U29 | **远端清理的安全约束**：只允许删除本插件按自身命名规则生成的版本文件；删除目标**只能来自远端枚举结果**，绝不由备份文件内容构造；`N` 下限为 1；删除失败不阻断备份成功；`DELETE` 与上传走同一套 SSRF 硬化 |

> 推论：为让 `U28` 的"保留最近 N 份"对所有后端语义一致，**GitHub 私有仓库也采用"每份一个时间戳文件"的布局**，而不是"单文件覆盖提交"——后者虽能靠 commit 保留全部历史，却无法按份数清理。（若更想要"单文件 + commit 历史"，则 `U28` 对它不适用，需另议。）
>
> 本次随之同步的正文：§4.3（v1.2 行）、§5.1（latest 语义）、§6.3（补 `PROPFIND` / `DELETE`）、§6.4（Contents API 提前）、§9（新增威胁 8）、§12（M4 / M5）、§16（Q3 结案）。

### 0.8 正文中属于阶段二的内容索引（本期不实现）

> §0.0 已把范围收缩为阶段一。下列章节描述的是**远端传输 / 重启 / 多语言**能力，本期**不实现**；保留在正文是为了阶段二不必从零重写。实现阶段一时请以 §0.0 与 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) 为准。

| 章节 | 属于阶段二的内容 |
|---|---|
| §2.1 G4 / §2.3 S3 | 传输层支持 GitHub 与 WebDAV；公网 / 局域网 WebDAV 演练 |
| §4.1 传输行 / §4.3 版本路线 | WebDAV、GitHub 后端、远端历史 |
| §5.3 | 上传策略与 `.latest.json` |
| §6.1 步骤 ⑥ / §6.3 / §6.4 | 上传、多目标汇报、WebDAV 双模式、GitHub 后端 |
| §6.6 | 一键立即重启 |
| §9 威胁 2–3 与威胁 8 / §10 网络项 | 出站 SSRF、远端删除、上传失败与服务商差异 |
| §11 / §12 M4–M5 / §13 R8 / §14 | mock WebDAV、重启演练、公网 / 局域网 WebDAV 验收 |
| §16 Q3 与 §0.7 | 远端历史与清理 |

**阶段一已对齐的部分**：§0.0–§0.8（本节）、§4.1 skills 行、§5.1–§5.2 产物形态（见 [FORMAT.md](FORMAT.md)）、§7（14 项检查**全部适用**）、§8.1–§8.4。

---

## 1. 背景与问题定义

### 1.1 现状：dsh-market 已经做了什么

dsh-market（`1.66.7`，MIT 许可，npm 包内含完整 TypeScript 源码）的"备份"功能已经实现了一条完整链路：

| 能力 | 实现位置（本机路径） |
|---|---|
| profile 配置文件全量/选择性备份 | `…\node_modules\dshmarket\lib\backup.js`（`createProfileBackup`） |
| 排除项 | `node_modules`、`.dsh-market`、`.git`、`pnpm-lock.yaml`；上限 2 MiB / 256 文件 |
| WebDAV 上传/下载（含 SSRF 硬化、MKCOL 建目录、重定向处理） | `lib\backup.js`（`uploadWebdav` / `downloadWebdav`） |
| GitHub Gist 导入导出 | `lib\gist.js` + `lib\routes.js`（`/dsh-market/gist`） |
| 恢复时重装插件（`dsh plugin install`，失败逐个 `plugin add` 兜底、失败回滚） | `lib\routes.js`（`restoreBackup`，实测 1.66.7 下起于 **1191** 行、止于约 1294 行） |
| 合并式恢复（不删目标机已有插件） | `lib\backup.js`（`mergeRestoreManifest`） |
| 本地快照 / 一键回滚 | `lib\snapshot.js`（v2 快照，原子写 + 失败反向回滚） |
| host 版本探测与兼容性判定 | `lib\dsh-install.js`（`dshHostInfo`）、`lib\discovery-compatibility.js` |

**结论：不要重写这些。** 新项目只补它没有的部分，其余按需借鉴（MIT，注明来源即可）。

### 1.2 三个真实缺口（本项目的存在理由）

1. **skills 完全不在备份范围内**。skill 文件在 `<DSH_HOME>\skills`（skills-manager 源码 `join(resolveDshHome(), 'skills')`），dsh-market 只扫 profile 目录，skill 一个字节都不备。
2. **模型配置没有"去 key"能力**。模型 provider 声明就写在 profile 的 `cordis.patch.yml` 里（`llm-pi-ai` 条目），所以会被**整文件**备走；一旦有人在该文件里内联了 `apiKey`，就会连同备份一起被上传。dsh-market 只有"文件名看着像密钥"的启发式（实测 `SECRET_FILE_HINTS` = `config.toml` / `.env(.x)` / `secrets*.json` / **`pnpm-workspace.yaml`**；目录级排除另有 `SKIP_NAMES` = `node_modules` / `.dsh-market` / `.git` / `pnpm-lock.yaml` 与 `.bak` 正则），对 `cordis.patch.yml` 里的内联密钥**完全无效**。（本机实测该文件目前**没有**内联 `apiKey`，只有 `apiKeyEnv` 指针，属潜在风险而非已发生。）
3. **局域网 / 自建 WebDAV 被硬拒**。dsh-market 的 WebDAV 只允许 https + 公网 IP 目标，自建 NAS、RF1918 内网、Tailscale（`100.64/10`）、`*.local` 一律直接报错。

另外还缺一个**兜底文档**：dsh-market 的备份是给程序读的 JSON，一旦跨版本恢复失败，用户手里没有一份"照着敲就能重配"的人类可读材料。

### 1.3 需求来源之一：原故障根因（已定位）

用户使用 dsh-market 备份时始终得到 `Error: invalid WebDAV URL`。逐行核对 `lib\backup.js` 后确认，这条错误由该插件自己的 SSRF 网关抛出，触发条件如下（**每一项都会得到这条一模一样的报错，或旁边标注的那一条**）：

| 输入 | 实际报错 |
|---|---|
| `http://…` | `WebDAV requires an https:// URL` |
| 其他 scheme（`ftp:`、`webdav:`、无 scheme） | `invalid WebDAV URL` |
| URL 内嵌 `user:pass@host` | `invalid WebDAV URL` |
| host 解析到 `127.*` / `10.*` / `172.16-31.*` / `192.168.*` / `169.254.*` / **`100.64-127.*`（Tailscale）** | `invalid WebDAV URL` |
| hostname 为 `localhost` / `*.local` / `*.internal` / `*.localhost` | `invalid WebDAV URL` |
| 域名有多条 A 记录且**任意一条**是私网（hosts、公司 DNS、分流代理） | `invalid WebDAV URL` |
| DNS 查询失败 | `invalid WebDAV URL` |

即：**如果 WebDAV 目标是自建/局域网地址，URL 再正确也永远失败**——这是设计上的取舍，不是用户配置错误。另外两个已知坑：URL 必须指向**文件**（`…/dsh/backup.json`），不是目录；部分服务商（如坚果云）不允许在根目录放文件。

顺带发现（与本项目相关）：`~\.dsh\.credentials.yaml` 中存在一条 `DSH_CONFIG_MANAGER_SYNC_WEBDAV_PASSWORD`，但当前安装的 5 个插件**没有任何一个引用它**，属于历史遗留密钥记录（可清理）。这一版 dsh-market 的 WebDAV 密码**并未持久化**（UI 文案"密码存于服务端"已过时），URL/用户名存在浏览器 `localStorage` 的 `dshm-webdav`。

---

## 2. 目标、非目标与成功标准

### 2.1 目标（v1）

- **G1** 一键备份：profile 配置 + 插件清单 + 模型配置（**强制剥离密钥**）+ skills 清单（仅名字/描述）+ 兜底文档。
- **G2** 备份前可勾选内容；恢复前可预览 diff 并逐项勾选。
- **G3** 恢复时执行兼容性检查，能自动恢复的自动恢复，不能的给出**可照做**的结论。
- **G4** 传输层同时支持 GitHub 与 WebDAV；WebDAV 支持"公网硬化"与"显式放行私有目标"两种模式。
- **G5** 无论兼容性检查是否通过，用户手里始终有一份人类可读、可复制粘贴的兜底文档。
- **G6** 插件自身尽量少依赖 DSH 内部实现，降低 DSH 升级导致的崩溃概率。

### 2.2 非目标（v1 明确不做）

会话历史与 `sessions`、`storages`（含 session 投影缓存）、`attachments`、workspace 列表、`node_modules` 内容、`.credentials.yaml` 内容、DeepSeek 账号登录态、DSH 本体与运行时、定时/自动备份（仅预留接口）、多用户/团队共享、云端增量同步。

### 2.3 成功标准

| 编号 | 标准 | 验证方式 |
|---|---|---|
| S1 | 在干净 profile 上能从备份恢复到"插件齐全、模型可用（补 key 后）、skills 就位" | 端到端演练（§11） |
| S2 | 备份文件中不含任何真实密钥（用正则扫描 + 人工抽查） | 自动扫描测试 + 演练 |
| S3 | 局域网 WebDAV 与公网 WebDAV 都能上传/下载 | 各有一次真实演练 |
| S4 | 兼容性全失败时，仅凭兜底文档可在新机器完成重配 | 盲测：只看文档不问作者 |
| S5 | DSH 升级一个小版本后，插件加载不失败（功能可降级，但不得阻断启动） | 升级演练 |
| S6 | 恢复过程任一步失败都能回滚到操作前状态 | 注入失败测试 |

---

## 3. 事实基线（实测，实现时以此为准）

### 3.1 目录布局

```
C:\Users\Maxxie\.dsh\                     ← DSH_HOME（由 DSH_HOME 环境变量决定）
├─ .credentials.yaml                      ← 所有密钥（不入备份）
├─ profiles\
│   └─ desktop\                           ← 当前 profile（DSH_PROFILE_DIR）
│       ├─ package.json                   ← 插件清单 + dsh.profile.bundles
│       ├─ cordis.yml                     ← 空数组（不要改，注释明确写了"编辑 cordis.patch.yml"）
│       ├─ cordis.patch.yml               ← 用户 patch 层：含 llm-pi-ai 模型声明、agent-default-model、UI 偏好
│       ├─ pnpm-workspace.yaml            ← allowBuilds（git 依赖/原生包能否执行安装脚本）
│       ├─ pnpm-lock.yaml                 ← 版本与 git commit 锁定（v1 不搬运，仅读取）
│       ├─ node_modules\                  ← 已装插件（不备份）
│       ├─ .dsh-market\                   ← 市场状态、快照、日志（不备份）
│       └─ .plugin-manager\logs\          ← 插件管理日志（不备份）
├─ skills\                                ← ★ skill 文件根（本机目前不存在，需容忍缺失）
├─ skills-manager\                        ← skills-manager 自己的状态（v1 不备份）
├─ storages\  sessions\  attachments\     ← 均不在 v1 范围
└─ dsh-runtimes\ .pideck\
```

项目级 skill 另有 `<project>\.dsh\skills`（skills-manager 已支持，v1 仅记录、不搬运）。

### 3.2 配置内容与来源

| 目标数据 | 文件 | 关键字段 |
|---|---|---|
| 插件清单 | `package.json` | `dependencies`（name → spec）、`dsh.profile.bundles`（加载顺序） |
| 模型 provider | `cordis.patch.yml` | `id: llm-pi-ai` → `config.providers.<key>.{displayName,apiKeyEnv,api,baseURL,models[]}` |
| 默认模型 | `cordis.patch.yml` | `id: agent-default-model` → `config.{provider,model,reasoningEffort}` |
| 其他 UI/功能偏好 | `cordis.patch.yml` | `locale`、`ui-theme`、`ui-chat`、`better-sidebar` 等条目（随文件整体备份，文档中不细列） |
| 构建脚本许可 | `pnpm-workspace.yaml` | `allowBuilds` |
| 版本/commit | `pnpm-lock.yaml` + `node_modules\*\package.json` | 只读，用于记录 `resolvedVersion` / `commit` |

### 3.3 密钥在哪里（结构，无值）

`~\.dsh\.credentials.yaml` 是凭据服务的落盘形态，含两类内容：

- `records`：`client-connection/browser-session`（含 `secret`）、`deepseek-account-platform/device`、`deepseek-account-platform/default`（含 `token`，即账号登录态）→ **全部排除**。
- `refs`：以环境变量名形式保存的键值，本机存在 `MPLAN_API_KEY`、`XIUXIAN_API_KEY`、`DSH_CONFIG_MANAGER_SYNC_WEBDAV_PASSWORD` → **只记录"需要哪些名字"，不记录值**。

模型配置里的 `apiKeyEnv`（例：`MPLAN_API_KEY`、`XIUXIAN_API_KEY`）就是指向这些 ref 的指针。因此"备份模型不含 key"的正确实现是：**备份配置条目 + 记录所需 ref 名单**，恢复后提示"缺哪个"，由用户在设置里补。

### 3.4 可用的公开服务（来自本机运行时只读内省）

| Service | 本项目用到的成员 | 用途 |
|---|---|---|
| `pluginManager` | `installBundle(spec, options?)`、`waitForInstall(requestId)`、`cancelInstall(requestId)`、`listPlugins()`、`listBundles()`、`removeBundle(name)`、`setBundleEnabled(name, enabled)`、`setPluginEnabled(id, enabled)` | 恢复时重装插件、读取当前插件/包信息 |
| `credentials` | `describe(ref)`、`listRecords()`、`describeRecord(key)` | 生成"缺哪些 key"清单（**不读值**） |
| `skills` | `list(options?)`、`snapshot(options?)`、`get(name, options?)` | 取 skill 名称/描述（文件本体需走 fs） |
| `settings` | `describe()`、`update(ns, patch)`、`replace(ns, section)`、`mutate(ns, ops)` | 存放本插件自己的配置（含目标地址、开关状态） |
| `webServer` | `register(route)` | 注册本机 HTTP 路由（与客户端 UI 通信） |
| `configEditor` | `entries()`、`configuration()`、`edit(entry, change)` | **可选**：以"官方编辑路径"读写 `cordis.patch.yml` 条目，比直接写文件更抗升级 |
| `storageDomain` | `open(spec)`、`get(name)` | **可选**：需要结构化持久化时的备选 |

> 注：`pluginManager` 是官方插件管理能力的服务形态，用它重装插件比 spawn `dsh plugin add` 更稳（本机 `dsh` **不在 PATH** 上，桌面版由宿主启动，外部进程方案天然脆弱）。

### 3.5 环境事实

- `DSH_HOME=C:\Users\Maxxie\.dsh`，`DSH_PROFILE=desktop`，`DSH_PROFILE_DIR=C:\Users\Maxxie\.dsh\profiles\desktop`。
- 已装 bundle：`dshmarket 1.66.7`（profile spec `^1.66.7`）、`dsh-better-sidebar 0.24.1`、`@michengai/dsh-skills-manager 1.1.8`、`@michengai/dsh-agency-agents 1.0.7`、`dsh-context 0.62.2`；核心 bundle `@deepseek-ai/dsh-base` / `dsh-web-app` 等为 `0.2.0-rc.2`（与实测 `desktopVersion: 0.2.0-rc.2` 一致）。
- `node`：`C:\Program Files\nodejs\node.exe`（v22.23.1，**这是系统 node，不是宿主进程的运行时**）；`pnpm`：`C:\Users\Maxxie\AppData\Roaming\npm\pnpm.ps1`；`dsh`：**不在 PATH**（实测 `Get-Command dsh` 无结果）。宿主运行时为 Node 24.21.0 / pnpm 11.7.0，见文首基线。
- `skills` 目录**当前不存在**（实测 `<DSH_HOME>\skills` 为 False）；`.dsh-market` 下只有 `discovery-compatibility-v1.json` / `log.ndjson` / `state.json`，**尚无 `snapshots` 目录**（dsh-market 的 `SNAPSHOT_DIR = .dsh-market/snapshots` 按需创建）。
- dsh-market 日志显示：**有 agent 正在运行时，profile 变更会被拒绝**（`install-blocked`）。其实测实现为 `lib\routes.js` 的 `runningAgentsForGuard()`：`ctx.get('agents')` → `service.list()`，**服务缺失时只记一次 warn 日志并降级**，绝不抛错。本插件必须遵循同一约束与同一降级姿势。
- dsh-market 是 MIT；npm 包内含 `src/*.ts` 全量源码，是最佳参考实现。

---

## 4. 产品边界

### 4.1 v1 范围

| 分类 | v1 包含 | 说明 |
|---|---|---|
| profile 配置 | `package.json`、`cordis.patch.yml`、`pnpm-workspace.yaml` | 保留行形式（含注释/顺序），**强制密钥剥离** |
| 插件清单 | name / spec / 实际版本 / 来源类型 / commit / 一句话用途 | 不搬运 `node_modules` |
| 模型配置 | provider（key、displayName、api、baseURL、apiKeyEnv）+ models[] + 默认模型 | 无任何密钥值 |
| skills | 默认**仅名字 + 描述 + 路径**；用户可勾选"连文件一起" | 文件走**独立 `.zip` 附件**，仅本地 / WebDAV 支持；GitHub 因限额不支持（见 §0 的 U11 / U17） |
| 兜底文档 | Markdown，含插件表、provider 表与可粘贴 YAML、模型表、skill 名、手工重建步骤 | 与 JSON 同源同版本 |
| 传输 | GitHub（Gist 优先）、WebDAV（公网硬化 + 显式私有目标模式）；**目标数量不限、可多目标并行** | 见 §6.3 / §6.4 与 §0 的 U12 / U16 |
| 恢复 | 预览 diff、逐项勾选、兼容性闸门、环境差异对照、合并应用、缺 key 提示、**一键立即重启**、失败回滚 | 见 §6.2 / §6.6 / §7 |
| 本地能力 | 导出到本地文件、从本地文件导入、恢复前自动快照 | 保证离线可用 |
| 历史与保留 | 历史列表、可设保留上限并自动清理、支持手动删除、每份可一键进入恢复向导 | 见 §0 的 U23 / D2 / D3 |

### 4.2 明确排除（v1）

见 §2.2；此外**不备份也不修改** `cordis.yml`（DSH 明确要求改 patch 文件而非它）、`.dsh-market`、`.plugin-manager`、任何 `*.bak*` 残骸文件（dsh-market 踩过把残骸一起备份再恢复的坑）。

### 4.3 版本路线

| 版本 | 增量 |
|---|---|
| v1.0 | 本方案 §4.1 全部 |
| v1.1 | pnpm-lock 可选携带（精确复现）。~~skills 文件搬运~~ 已进入首版范围（U11 / U17） |
| v1.2 | 恢复计划"演练模式"（只报告不写入）。~~GitHub 私有仓库 Contents API~~ 已进入首版范围（U27） |
| v2.0 | 定时/变更触发自动备份、多目标、备份加密（用户口令派生密钥） |

> ⚠️ 本表已被 §0 部分取代：**多目标已进入首版范围**（U12），**skills 文件搬运（独立 zip）已进入首版范围**（U11 / U17），**一键重启已进入首版范围**（U7 / U8）。其余（定时自动备份、备份加密、Gist 之外的历史版本能力）仍按本表后置。

---

## 5. 备份产物

### 5.1 JSON 主体（权威产物）

文件建议名：`dsh-brittle-backup-<YYYYMMDD-HHmmss>.json`。**WebDAV 与 GitHub 私有仓库目标按时间戳逐份上传，以保留历史**（U26）；`dsh-brittle-backup.latest.json` 只用于**覆盖式后端（Gist）**与"最新指针"语义。

```jsonc
{
  "format": "dsh-brittle-backup",
  "version": 1,                       // 产物格式版本；不认识的版本一律拒绝执行恢复
  "createdAt": "2026-10-01T10:22:55.000Z",
  "producer": { "plugin": "dsh-brittle-backup", "pluginVersion": "1.0.0", "dshVersion": "0.2.0-rc.2" },
  "items": {
    "profile": {
      "files": [
        { "path": "package.json",         "json":  { /* 原文对象 */ } },
        { "path": "cordis.patch.yml",     "lines": ["# ...", "- id: llm-pi-ai", "  ..."] },
        { "path": "pnpm-workspace.yaml",  "lines": ["allowBuilds:", "  ..."] }
      ],
      "absent": ["cordis.yml"],
      "redactions": [
        { "path": "cordis.patch.yml", "pointer": "/8/config/providers/xiuxian/apiKey",
          "reason": "inline-secret", "note": "恢复后请在设置中补 key（原为内联值）" }
      ]
    },
    "plugins": [
      { "name": "dshmarket", "spec": "^1.66.7", "resolvedVersion": "1.66.7",
        "source": "registry", "bundle": true, "description": "Visual plugin market …",
        "installCommand": "dsh plugin add dshmarket@1.66.7" },
      { "name": "@mylab/local-plugin", "spec": "link:F:\\Git\\local-plugin", "source": "local-path",
        "unportable": true, "note": "绝对路径依赖，跨机器恢复会失败" }
    ],
    "models": [
      { "provider": "xiuxian", "displayName": "修仙", "api": "openai-completions",
        "baseURL": "https://xiuxian.pro/v1", "apiKeyEnv": "XIUXIAN_API_KEY",
        "models": [ { "id": "gpt-6-luna", "name": "GPT-6 Luna", "contextWindow": 1000000,
                      "maxTokens": 256000, "input": ["text", "image"] } ] }
    ],
    "defaultModel": { "provider": "deepseek-account", "model": "deepseek-flash", "reasoningEffort": "high" },
    "requiredCredentials": [ "MPLAN_API_KEY", "XIUXIAN_API_KEY" ],   // 只有名字
    "skills": [ { "name": "example-skill", "description": "…", "path": "skills/example-skill",
                  "scope": "user", "files": 3 } ],
    "stats": { "fileCount": 3, "bytes": 8123, "itemCounts": { "plugins": 5, "models": 2, "skills": 1 } }
  },
  "doc": { "format": "markdown", "content": "# DSH 配置兜底文档\n…" }
}
```

约束：

- 上限：JSON ≤ 2 MiB（沿用 dsh-market 的额度，文档内嵌后仍有余量）；文件数 ≤ 256。**skills 文件不在 JSON 内**，走独立 `.zip` 附件（U17）：附件超限时**只跳过附件并保留 JSON**，不整体失败；JSON 本身超限才拒绝上传并提示关闭部分项。
- 所有 `path` 必须是相对路径、禁止 `..`、禁止命中排除名单（逐条校验，写前与读后各校验一次）。
- `redactions[]` 是**必填字段**（可为空数组）：它让恢复侧能精确提示"哪一项需要重新填 key"。

### 5.2 兜底文档（Markdown，强制的第二产物）

文档必须**自包含、可粘贴、不依赖本插件**。模板：

```markdown
# DSH 配置兜底文档（dsh-BrittleBackup 生成）
生成时间：2026-10-01 18:22 (+08:00)　DSH 版本：0.2.0-rc.2　备份格式：v1
本文件包含：插件清单、模型供应商与模型、skills 清单、手工重建步骤。
本文件不包含：任何 API Key / Token / 密码。请自备。

## 1. 手工重建步骤（照这个顺序做）
1. 安装插件：见 §2 的 `安装命令` 列，逐条执行（或在本插件的"恢复"里勾选自动安装）。
2. 填密钥：见 §3，每个供应商都列出"需要的设置项名称"，在 设置 → 模型/凭据 中填写。
3. 粘贴模型配置：把 §3 里每段 ```yaml 原样粘进 profile 的 `cordis.patch.yml`（或在本插件的"恢复"里勾选"模型配置"）。
4. 恢复 skills：把 §4 的 skill 目录放回 `<DSH_HOME>\skills\<name>\`。
5. 重启 DSH。

## 2. 插件（共 5 个）
| 插件名 | 版本 | 用途 | 安装命令 |
|---|---|---|---|
| dshmarket | 1.66.7 | 可视化插件市场 | `dsh plugin add dshmarket@1.66.7` |
| … | | | |

> ⚠️ 本地路径依赖（跨机器不可用）：`@mylab/local-plugin` → `link:F:\Git\local-plugin`

## 3. 模型供应商与模型
### 3.1 xiuxian（修仙）
- api：`openai-completions`　baseURL：`https://xiuxian.pro/v1`
- **需要填写的设置项**：`XIUXIAN_API_KEY`（当前状态：已配置 / 缺失）
- 模型：
  | 模型 id | 名称 | 上下文 | 最大输出 | 能力 |
  |---|---|---|---|---|
  | gpt-6-luna | GPT-6 Luna | 1000000 | 256000 | text, image |
- 可直接粘贴的配置：
```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      xiuxian:
        displayName: 修仙
        apiKeyEnv: XIUXIAN_API_KEY
        api: openai-completions
        baseURL: https://xiuxian.pro/v1
        models:
          - id: gpt-6-luna
            name: GPT-6 Luna
```
### 3.2 …（每个供应商一节）

## 4. 默认模型
provider `deepseek-account` / model `deepseek-flash` / reasoningEffort `high`
```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high
```

## 5. skills
| 名称 | 描述 | 原路径 | 本备份是否含文件 |
|---|---|---|---|
| example-skill | … | `<DSH_HOME>\skills\example-skill` | 否（仅清单） |

> skills 文件**不在本文件里**。若备份时勾选了"连文件一起"，文件在同目录的 `…-skills.zip` 附件中（仅本地 / WebDAV 目标存在该附件）。
> 本文件**刻意不含配置原文**（U5）：只给可粘贴的片段与步骤，以便安全地单独分享。
```

生成规则：
- provider 段落中的 YAML 片段必须是**可直接粘贴回 `cordis.patch.yml` 的合法条目**（缩进正确、含 `id`/`name`/`config` 三层）。
- "需要填写的设置项"必须结合 `requiredCredentials` + 恢复时 `credentials.describe()` 的实时结果，标注 `已配置` / `缺失`。
- 用途列取已装包 `package.json` 的 `description`；取不到就留空，**不得编造**。
- 若某项数据采集失败（文件读不到、skill 目录不存在），文档中写"未采集到"，不要省略整节。
- **文档语言**按用户设置输出（中 / 英 / 双语，默认跟随界面）；选双语时**同一份文档内中英对照**，不出两个文件（U22 / D1）。
- 文档**不得包含**：任何密钥值、任何主机名 / 地址 / 账号名、任何配置原文（U5 / U20）。这是"可以安全单独分享"的前提。

### 5.3 命名与版本策略

- 产物格式版本 `version` 独立于插件版本；恢复侧只接受 `version === 1`（未来接受 `<= 当前支持` 并提供"仅预览"）。
- 文件名带时间戳用于留存历史；`*.latest.json` 用于覆盖式上传（WebDAV 单一目标场景）。
- 上传时可选同时上传兜底文档与 skills zip 附件；**JSON 是权威，md 与 zip 都是附件**，附件失败不影响备份成功，只在结果中提示（GitHub 目标本就不接受 zip 附件，见 U11）。

---

## 6. 功能规格

### 6.1 备份流程

```
① 选择内容（默认全选：profile 配置 / 插件清单 / 模型配置 / skills 清单 / 兜底文档）
② 采集（逐项 try/catch，缺失记 absent，不中断）
③ 剥离密钥（对 profile 文件做结构化扫描与替换）
④ 生成 JSON + 文档，本地落盘（<DSH_HOME>\dsh-brittle-backup\）
⑤ 密钥自查扫描：命中即拦截上传，除非用户显式勾选"我已确认该值可外传"
⑥ 上传（GitHub / WebDAV / 仅本地）
⑦ 报告：产物路径、体积、被剥离项数量、上传结果、文档路径
```

- 采集阶段的每一次失败都必须转化为"结果里的一个警告条目"，不允许整次备份失败（唯一的硬失败：无法读取 `package.json`，因为那是恢复的最低要求）。
- 上传失败不删除本地产物，且明确提示本地产物路径。

### 6.2 恢复流程

```
① 取得备份（下载 / 本地文件 / 剪贴板粘贴）
② 严格校验（format/version/路径安全/文件数/体积）→ 失败即止，不写任何文件
③ 只读预览：逐项 diff（新增 / 覆盖 / 删除 / 跳过 / 无法自动恢复）
   每项标注：✅ 可自动恢复 ｜ ⚠️ 可恢复但有风险 ｜ ❌ 只能照文档手工做
④ 用户逐项勾选
⑤ 应用：
   a. 写前自动快照（本插件自己的快照目录，独立于 .dsh-market）
   b. profile 文件：合并语义写入（temp + rename，原子）
   c. 插件：pluginManager.installBundle(spec) 逐项安装，逐项汇报；失败项不影响其他项
   d. skills：v1 只做"清单核对"，不写文件
   e. 缺 key 清单：credentials.describe(ref)
⑥ 汇总报告：成功项 / 失败项 / 需手工项 / 需要补的 key / 是否需要重启
⑦ 出错时整体回滚到快照；回滚不完整必须显式报告（写明残留文件）
```

硬性规则：

- **合并语义**：备份里没有的插件、配置条目一律不删。
- **有 agent 运行时拒绝写 profile**，提示"请等当前会话空闲或稍后重试"。
- **恢复后必须明确告知"需要重启 DSH 才能生效"**（本机 dsh-market 的日志与配置说明都表明 profile 变更是重启/热加载级别的事，不能假装即时生效）。
- 目标文件若存在且其实是目录/符号链接 → 拒绝该项，不越权删除。
- 不写 `cordis.yml`、不写 `node_modules`、不写 `.credentials.yaml`。

### 6.3 WebDAV 双模式

| 模式 | 放行 | 仍然拒绝 | 默认 |
|---|---|---|---|
| **硬化（默认）** | `https:` + hostname 解析到的**全部**地址都是公网 IP | 非 https、URL 内嵌 `user:pass`、RFC1918、CGNAT、link-local、`localhost`/`.local`/`.internal`/`.localhost`、DNS 失败 | 每个目标独立默认开启 |
| **私有目标（显式开关）** | 在硬化基础上额外放行 RFC1918、**CGNAT `100.64.0.0/10`（Tailscale）**、IPv6 ULA、`.local`/`.internal`、`localhost`，并允许 `http:`（明文，给出显著警告） | `169.254.0.0/16`（链路本地 / 云 metadata）、`metadata.google.internal`；**任何模式下都拒绝 URL 内嵌用户密码** | 默认关，按目标地址分别保存 |

实现要点：
- 连接使用"先解析、校验后再连到该 IP"的方式（避免 DNS rebinding），并设置 `servername` 保证 TLS SNI/证书校验正确。
- 上传前逐步 `MKCOL` 建父目录（已存在返回 405 视为成功）；`PUT` 非 2xx 时给出可操作文案（404 → "目标目录不存在且无法创建；部分服务商不允许在根目录放文件，请使用子目录路径"）。
- **枚举与清理远端历史**（U28）：列目录用 `PROPFIND`（`Depth: 1`，解析 207 Multi-Status XML）；清理旧版本用 `DELETE`。⚠️ **dsh-market 完全没有这两项**（全库 grep `PROPFIND` 零命中，`DELETE` 命中全是 JS `Map.delete` 之类），属本项目从零实现，需自带 XML 解析、命名空间与编码处理。
- 下载仅对 `GET` 跟随重定向（上限 5 跳），跨源跳转不携带 Basic 凭据。
- 单请求超时 30 s；响应体上限：GET 2 MiB，其他 64 KiB。
- 凭据：URL、用户名、"是否私有目标"开关存在本插件设置里（设置命名空间 = loader entry id `brittle-backup`，见命名约定表）；**密码走凭据服务，按目标派生 ref 名**（如 `DSH_BRITTLE_BACKUP_WEBDAV_PASSWORD__<目标id>`，见 U15——原稿写的单一固定 ref 名无法同时保存多目标密码，已纠正）。密码**永不回显、永不写入备份产物**；URL / 用户名属连接元数据，会随 `cordis.patch.yml` 进入备份 JSON（U20），但**不进入可分享文档**（U5）。

### 6.4 GitHub 后端

| 后端 | v1 | 说明 |
|---|---|---|
| Gist（推荐先做） | ✅ | 与 dsh-market 同形状；单 gist 可放 `backup.json` + `README.md` 两个文件；单文件 1 MiB 上限 |
| 私有仓库 Contents API | ✅ 首版 | 保留 commit 历史；需要 repo + path + PAT。**本机无参考实现**（dsh-market 只有 Gist，`gist.js` 里也无 revision 处理） |
| `gh` CLI | ❌ | 不引入外部进程依赖（本机 `dsh` 都不在 PATH，外部 CLI 方案脆弱） |

- Token 存 `credentials`（ref 名 `DSH_BRITTLE_BACKUP_GITHUB_TOKEN`），**不写入备份**，UI 中只显示"已配置/未配置"。
- 网络全部用 `node:https`，走系统代理环境变量；超时与体积上限同上。

### 6.5 缺 key 提示

备份时记录 `requiredCredentials[]`（只有名字）。恢复时对每个 ref 调 `credentials.describe(ref)`，报告：

```
需要补的密钥：2 项
  XIUXIAN_API_KEY  → 已配置
  MPLAN_API_KEY    → 缺失（请在 设置 → 模型 中填写）
```

绝不尝试读取、显示、传输任何密钥值。

### 6.6 重启语义

恢复完成后提示"配置已写入，需要重启 DSH 生效"，并提供「**一键立即重启**」按钮（U7 / U8）。

- 宿主**不提供**重启服务（实测宿主服务目录中 `restart` / `relaunch` 均无命中），因此必须自行重启；启动方式见 §0.3 的 U8 落地要点，**照抄 dsh-market 的 `dshArgv()` 在本机会失败**。
- 重启端点只接受**同源 loopback** 请求（无转发头），且插件操作进行中一律拒绝——照搬 dsh-market 的安全模型。
- 检测到不适合自动重启的环境（如挂了 inspector）时降级：明确提示 + 给出可手动重启的方式。
- 重启失败**必须留下证据**（诊断文件 + 恢复页），不得出现"点了没反应"；且失败后用户仍能手动启动 DSH。

---

## 7. 兼容性检查清单

恢复前按顺序执行；任一项为"拦截"级别则该项不可自动恢复，但**不影响其他项**，并且必须给出"照兜底文档怎么办"的指引。

| # | 检查项 | 判定 | 级别 | 动作 |
|---|---|---|---|---|
| 1 | 产物 `format` / `version` | 不等于 `dsh-brittle-backup` / `1` | 拦截（全局） | 拒绝执行，仅允许预览 |
| 2 | 路径安全 | 绝对路径、含 `..`、命中排除名单、重复路径 | 拦截（该项） | 跳过该项并报告 |
| 3 | DSH 版本差异 | 记录版本 ≠ 当前版本 | 警告（全局） | 继续，但报告差异与已知风险 |
| 4 | 插件 peerDependencies | 对当前 host 版本做 semver 判定（含 prerelease） | 拦截（该插件） | 不自动安装，列入"照文档手工处理" |
| 5 | 本地路径依赖 | spec 形如 `link:`/`file:` 且为绝对路径 | 拦截（该插件） | 同上，并在报告中点名 |
| 6 | loader entry id 冲突 | 新插件的 `insert:` id 与已装 bundle 冲突 | 拦截（该插件） | cordis 撞 id 会导致整棵树起不来，必须前置拦截 |
| 7 | 插件已装但版本不同 | 同名不同版本 | 警告 | 默认保留目标机版本，用户可显式选择按备份覆盖 |
| 8 | 包管理器可用性 | `pluginManager.installBundle` 不可用 | 警告 | 降级为"只恢复配置文件 + 文档指引" |
| 9 | skills 同名 | `<DSH_HOME>\skills` 下已存在同名 | 警告 | 让用户选择 覆盖 / 跳过 / 重命名；**勾选了文件附件时才真正落盘，仅清单时只提示**（见 U11） |
| 10 | skills 清单缺失 | 备份中 `skills` 为空或目录不存在 | 信息 | 正常继续，不报错 |
| 11 | 模型配置结构 | `providers` 结构不符合当前 `llm-pi-ai` 形状 | 警告 | 不盲写；在报告中展示文档里的 YAML 让用户自行粘贴 |
| 12 | 配置条目冲突 | `cordis.patch.yml` 同 `id` 条目在目标机已存在且值不同 | 警告 | 默认保留目标机并列出差异 diff |
| 13 | agent 忙碌 | 有 agent 正在运行 | 拦截（全局） | 拒绝写入，提示稍后重试 |
| 14 | 密钥缺失 | `credentials.describe(ref)` 为空 | 信息 | 列入"需补 key"，附设置入口说明 |

---

## 8. 技术架构

### 8.1 插件形态

- **Host 半**：Cordis 插件，负责采集、剥离、生成、网络传输、恢复编排、**任务状态持有**、HTTP 路由。
- **Client 半**（**首版范围内的交付**，见 §0 的 U1 / U3）：一个顶层独立设置页（`settings.section`），承载配置、触发、恢复、历史；通过 host 注册的本机路由通信。
- 分发形态：DSH 社区插件（npm 包 `dsh-brittlebackup`，仓库名 `dsh-BrittleBackup`），`dsh.bundle.patch` 指向自带 patch；**必须声明 `dsh.client`**。自带的 patch 使用独占 entry id 前缀 `brittle-backup`。
- **不向模型注册任何工具**，也不提供聊天命令入口（U24 / D4）。

### 8.2 建议目录结构

```
dsh-BrittleBackup/                 ← 仓库根（npm 包名 dsh-brittlebackup）
├─ package.json                 # name/version/dsh.bundle/dsh.client/peerDependencies
├─ cordis.patch.yml             # 本插件插进 profile 的 loader 条目
├─ README.md
├─ LICENSE                      # MIT
├─ docs/
│   ├─ PROJECT-PLAN.md          # 本文件
│   ├─ SCOPE-PHASE1.md          # 阶段一（本地导出 / 导入）权威范围
│   ├─ FORMAT.md                # 备份产物格式说明（对外契约）
│   └─ SECURITY.md              # 密钥与传输安全策略
├─ src/
│   ├─ index.ts                 # 插件入口：注册服务/路由/配置 schema
│   ├─ config.ts                # Config schema（schemastery/zod），含 version
│   ├─ collect/
│   │   ├─ profile.ts           # 读结构化配置条目 + 两个文件（容忍缺失、记录 absent）
│   │   ├─ plugins.ts           # 清单 + 实际版本 + lock commit + unportable 检测
│   │   ├─ models.ts            # 从结构化配置派生 provider / models / 默认模型
│   │   └─ skills.ts            # skills.list + 目录扫描（元数据 + 可选文件复制）
│   ├─ redact.ts                # 脱敏：settings 密钥路径图 + 字段名 + 正则自查
│   ├─ doc.ts                   # 兜底文档生成器（中文，自包含可分享）
│   ├─ artifact.ts              # 产物组装、校验、原子落盘（目录形态）
│   ├─ export.ts                # 本地导出：目录选择 + 逐项勾选 + 写盘
│   ├─ restore/
│   │   ├─ validate.ts          # 产物严格校验（路径安全等）
│   │   ├─ plan.ts              # 生成导入计划（逐项/级别/原因）
│   │   ├─ checks.ts            # §7 的全部 14 项检查
│   │   ├─ apply.ts             # 按条目 id 合并写入、逐插件安装编排
│   │   └─ snapshot.ts          # 自有快照与回滚
│   └─ routes.ts                # 本机 HTTP 路由（同源 loopback 校验）
├─ client/                      # 设置页 UI（settings.section，仅中文）
├─ test/
│   ├─ unit/                    # redact / plan / checks / artifact / config-merge
│   └─ fixtures/                # 样例 profile、样例导出目录
└─ 🔜 阶段二新增：src/transport/（webdav.ts、gist.ts）、src/restart.ts、src/recovery.ts
```

### 8.3 服务依赖与调用点

| 调用点 | 依赖 | 降级行为 |
|---|---|---|
| 结构化配置读写 | `ctx.configEditor.configuration()` / `edit()` + `ctx.settings.describe()` | **不可用 → 不读写 profile 配置**，只导出 / 导入插件清单、模型信息、skills 与兜底文档，并明确提示（U32；**不再有"行级合并写入"的兜底**） |
| 恢复插件 | `ctx.pluginManager.installBundle` + `waitForInstall` | 服务不存在 → 只还原配置与文档，插件列入"照文档手工安装" |
| 缺 key 清单 | `ctx.credentials.describe` | 不可用 → 只输出 `requiredCredentials` 名单 |
| skill 元数据 | `ctx.skills.list` | 不可用 → 直接扫 `<DSH_HOME>\skills` 目录 |
| 自身设置 | `ctx.settings`（命名空间 = entry id `brittle-backup`） | 不可用 → 本次不改动自身设置，仅用默认值 |
| 目录选择 | `ctx.directoryPicker`（宿主）/ `uiWorkspace.pickDirectory()`（客户端） | 不可用 → 写入 `<DSH_HOME>\dsh-brittle-backup\` 并提示路径 |
| 路由 | `ctx.webServer.register` | 不可用 → 无 UI（本插件**不注册工具 / 命令**，见 U24） |

**能力探测统一写法**：每次调用前检查 `typeof service?.method === 'function'`，缺失走降级分支；**禁止**在插件加载（loader）阶段因服务缺失而抛错。

### 8.4 编码硬约束（防"升级即崩"）

1. 不深路径 import DSH 内部模块（如 `@deepseek-ai/dsh-x/lib/y.js`）；只通过 `ctx.*` 服务。
2. 不在 loader 阶段抛异常、不做网络请求、不做重活（异步、懒加载、失败只记日志）。
3. 不修改 DSH 内部文件：`cordis.yml`、`node_modules`、`.credentials.yaml`、`.dsh-market`、`.pideck` 一律不碰。
4. 一次性依赖的 schema 全部带 `version`；读到不认识的版本 → 拒绝并只读展示。
5. `peerDependencies` 声明 `@deepseek-ai/cordis` / `@deepseek-ai/dsh-settings` 等为可选（`peerDependenciesMeta.optional`），避免版本漂移导致装不上。
6. 不使用原生扩展（native addon）：Windows 上无法卸载已加载的 `.node`，会让"卸载→重装"变成 EPERM 死锁。
7. 自己的 loader entry id 用独占前缀 `brittle-backup`（UI 半为 `brittle-backup-ui`），避免与第三方 bundle 撞 id（撞了会导致整个 profile 起不来）。

### 8.5 数据流

```
              ┌─────────────── 备份 ───────────────┐
profile 文件 ─┐                                     ├─ backup.json（含 doc）
node_modules ─┤→ 采集 → 剥离密钥 → 组装 → 自查扫描 ─┤─ backup.md + skills.zip（附件，可选上传）
credentials ──┘   (只取 ref 名)                     └─ 本地目录 <DSH_HOME>\dsh-brittle-backup\
                          │
                          ├─→ GitHub Gist API
                          └─→ WebDAV（硬化 / 私有目标）

              ┌─────────────── 恢复 ───────────────┐
远端/本地 ──→ 严格校验 → 只读预览(diff+级别) → 用户勾选 → 快照
                                                      │
                              ┌───────────────────────┴────────────────────────┐
                       profile 合并写入                     pluginManager.installBundle 逐项
                              └───────────────┬────────────────────────────────┘
                                       汇总 + 缺 key + 重启提示
                                       失败 → 回滚到快照
```

---

## 9. 安全设计

| # | 威胁 | 对策 |
|---|---|---|
| 1 | 备份把密钥传到云端 | 结构化剥离（`apiKey`/`token`/`password`/`secret` 字段）+ 上传前正则自查（`sk-`、长十六进制/base64 串、`Authorization:`）+ 命中即拦截，需显式确认才放行；`.credentials.yaml` 从设计上不在读取范围内 |
| 2 | 备份文件被恶意构造（路径穿越、超大、符号链接） | 严格 schema 校验 + 相对路径白名单 + `..`/绝对路径拒绝 + 体积/数量上限 + 写入前拒绝非常规文件目标 |
| 3 | SSRF（被网页脚本诱导请求内网/元数据地址） | 默认硬化模式；私有目标必须显式逐目标开启；`169.254.0.0/16` 与云 metadata 域名任何模式都拒绝；先解析校验再连 IP，防 DNS rebinding；跨源重定向不带凭据 |
| 4 | 凭据泄露到日志/UI | WebDAV 密码、GitHub token 只经 `credentials`/配置，日志统一脱敏（URL 去 userinfo、key 只显示前 4 位或"已配置"） |
| 5 | 恢复过程破坏现有环境 | 合并语义 + 写前快照 + 原子写 + 失败回滚 + agent 忙碌时拒绝写入 |
| 6 | 依赖供应链 | 恢复安装时优先使用备份里**精确版本**的 spec；对 `github:`/`https:` 来源的 git spec，记录并在报告中展示 commit（便于人工核对） |
| 7 | 备份产物被篡改 | `format`/`version` 严格校验 + 每次恢复都展示 diff 供人工确认；v2 可加 HMAC（用户口令） |
| 8 | **远端旧版本清理误删 / 被诱导删除**（U28 新增的删除路径） | 只删**本插件自己按命名规则生成**的版本文件；删除目标**只来自远端枚举结果**，绝不由备份文件内容构造；逐条校验文件名模式与目标目录前缀；保留数 `N` 下限为 1；删除失败不阻断备份；所有 `DELETE` 与上传走同一套 SSRF 硬化（U29） |

---

## 10. 错误与降级矩阵

| 场景 | 行为 |
|---|---|
| 某配置文件不存在 | 记 `absent`，继续；报告中列出 |
| 某配置文件不可读（权限/占用） | 记警告，继续（该文件标 `skipped`） |
| `package.json` 不可读或非法 JSON | 备份失败（唯一硬失败），给出路径与原因 |
| 无 `skills` 目录 | 正常，`skills: []`，文档中写"本机未发现 skills" |
| 产物体积超限 | 拒绝上传，提示"关闭某些项（如包含完整配置原文的文档）后重试" |
| 上传网络失败/超时 | 保留本地产物，报告 HTTP 状态与可操作建议（404 → 目录问题；401/403 → 凭据问题；私网被拒 → 提示开启私有目标模式） |
| WebDAV URL 非法 | 按 §6.3 分类给出**具体**原因（不是笼统的 invalid URL） |
| Gist 超过 1 MiB | 拒绝并建议改用私有仓库后端或仅上传精简 JSON |
| 恢复时 DSH 版本不同 | 警告 + 继续，逐项标注风险 |
| 某插件安装失败 | 该插件标失败并从 manifest 回退（避免幽灵依赖让 pnpm 全盘拒装），其余继续 |
| 恢复中途异常 | 回滚到快照；回滚不完整则显式列出残留文件 |
| 服务缺失（老/新 DSH） | 走 §8.3 降级分支，UI 明示"当前版本不支持自动 X" |
| 有 agent 在运行 | 拒绝写 profile，提示稍后重试 |

---

## 11. 测试方案

**单元测试**
- `redact`：内联 `apiKey`、嵌套 provider、`apiKeyEnv`（不应被剥）、注释中的疑似密钥、已 `REDACTED` 的值（幂等）。
- WebDAV URL 策略：公网/私网/CGNAT/`.local`/`localhost`/userinfo/scheme × 两种模式，逐条断言"接受/拒绝 + 具体原因"。
- 产物校验：路径穿越、绝对路径、重复路径、超大、缺 `package.json`、未知 `version`。
- 恢复计划：§7 每一条检查各一例，断言级别（拦截/警告/信息）。
- 合并语义：目标机多出的插件不消失、同名冲突按规则处理、bundle 列表取并集。
- 文档生成：给定 JSON → 文档包含全部 provider/模型/skill 名称与可粘贴 YAML（用快照测试固定模板）。

**集成测试**
- mock WebDAV 服务器（本地 http 服务器）：MKCOL 405、PUT 404、302 跳转、超大响应、401。
- fixture profile（样例 `package.json` + `cordis.patch.yml`）：备份 → 修改 → 恢复 → 断言文件内容。

**端到端演练（发版前必做）**
1. 备份当前 profile → 上传到**公网** WebDAV → 下载 → 恢复 → 与原状态一致。
2. 同上换**局域网** WebDAV（私有模式）。
3. 干净 profile 上仅凭兜底文档手工重配 → 能跑起来。
4. 注入失败（断网、只读目录、有 agent 在跑）→ 断言回滚与提示。

---

## 12. 里程碑与任务拆分

| 里程碑 | 交付 | 验收 |
|---|---|---|
| **M0 骨架** | 插件可被 DSH 加载；配置 schema；能力探测与降级框架；日志脱敏 | 加载不报错；卸载后 profile 无残留 |
| **M1 采集与产物** | profile/插件/模型/skills 采集；密钥剥离；JSON + 文档生成；本地导入导出 | 单元测试通过；S2 达成 |
| **M2 恢复** | 校验、预览计划、§7 检查项、合并写入、快照回滚 | 集成测试通过；S6 达成 |
| **M3 兜底文档** | 文档模板定稿 + 恢复报告联动 | S4 盲测通过 |
| **M4 WebDAV** | 双模式、MKCOL/PUT/**PROPFIND**/GET/**DELETE**、重定向、超时/上限、错误文案、**远端保留清理** | S3 达成 + 历史保留与清理验证 |
| **M5 GitHub** | Gist（覆盖式）+ **私有仓库 Contents API（历史 + 清理）** | 真实 Gist 与私有仓库演练均通过 |
| **M6 UI** | **顶层设置页（`settings.section`）**：目标管理、触发、恢复向导（页内子视图）、历史与保留 | 手工验收 + §0 边界逐条对照 |

每个里程碑都要求：**默认不产生任何写操作**（本地落盘除外），恢复类写操作必须先有快照。

---

## 13. 风险登记册

| # | 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|---|
| R1 | DSH 服务签名变化导致功能不可用 | 中 | 高 | 能力探测 + 降级 + 只依赖公开服务；把"服务缺失"当作正常分支测试 |
| R2 | 恢复时 pnpm 因幽灵依赖全盘拒装 | 高 | 中 | 逐项安装、失败即回退该行 manifest（dsh-market 已验证该模式） |
| R3 | 恢复后 DSH 起不来（entry id 冲突/坏包） | 低 | 极高 | §7-#6 前置拦截 + 快照回滚 + 报告"回滚命令" |
| R4 | 密钥意外外传 | 低 | 极高 | 结构化剥离 + 正则自查 + 拦截 + 演练；`.credentials.yaml` 不在读取面 |
| R5 | Windows 文件占用导致写入失败 | 中 | 中 | 原子写 + 重试一次 + 明确提示"关闭占用进程后重试" |
| R6 | 备份体积随 skills/文档增长超限 | 中 | 低 | JSON 与 skills 附件分离（U17）：附件超限**只跳附件、保留 JSON**，并给明确提示 |
| R7 | 用户误以为恢复是即时生效 | 中 | 中 | 强制"需重启"提示；不承诺热加载 |
| R8 | 第三方服务商限制（根目录、重定向、路径） | 中 | 中 | 逐个错误码给可操作文案；文档里记录已知服务商差异 |
| R9 | 本插件自身成为"起不来"的来源 | 低 | 高 | loader 阶段零副作用；不自带原生模块；独有 entry id 前缀 |

---

## 14. 验收清单（v1.0 发布前逐条打勾）

- [ ] 备份产物 JSON 通过 schema 校验，且 `redactions[]` 与实际剥离项一致。
- [ ] 对当前 profile 做一次全量备份，正则扫描无密钥命中。
- [ ] 兜底文档在**不看源码、不问题作者**的情况下能指导完成重配（S4）。
- [ ] 公网 WebDAV 与局域网 WebDAV 各完成一次上传 + 下载 + 恢复。
- [ ] 备份文件指向目录而非文件、URL 带 userinfo、目标解析到私网，三种情况都给出**具体**错误原因。
- [ ] 恢复一次含 5 个插件的备份：逐项安装、失败项隔离、合并语义生效。
- [ ] 人为制造中途失败：断言回滚到操作前状态。
- [ ] 有 agent 运行时发起恢复：断言被拒绝且不写任何文件。
- [ ] 卸载本插件后，profile 不残留：manifest 无条目、无孤儿文件、`cordis.patch.yml` 无残留 `insert:`。
- [ ] 升级 DSH 一个小版本后插件仍能加载（功能可降级）。

---

## 15. 参考实现索引（本机，供实现时对照）

| 主题 | 位置 |
|---|---|
| 备份采集、排除项、密钥启发式、体积上限 | `C:\Users\Maxxie\.dsh\profiles\desktop\node_modules\dshmarket\lib\backup.js` |
| 同上（可读性更好的 TS 源码） | `…\dshmarket\src\backup.ts` |
| WebDAV 请求、SSRF 判定、MKCOL、重定向 | `lib\backup.js` 的 `webdavRequest` / `resolvePublicAddress` / `webdavParentCollections`（原稿误写作 `webdavParents`）/ `downloadWebdav` |
| 恢复编排（合并、逐项安装、回滚、unportable） | `lib\routes.js` 的 `restoreBackup`（实测 1.66.7 下 **1191**–约 1294 行） |
| 清单合并语义 | `lib\backup.js` 的 `mergeRestoreManifest` / `extractPluginSelection` / `unportableDeps` |
| 快照 v2 + 原子写 + 反向回滚 | `lib\snapshot.js` |
| host 版本探测 / 兼容性判定 | `lib\dsh-install.js`（`dshHostInfo`）、`lib\discovery-compatibility.js` |
| loader entry id 冲突检测 | `lib\profile.js`（`bundlePatchInsertedIds` / `conflictingEntryIds`） |
| 读 lockfile 中的 git commit | `lib\profile.js`（`readLockCommits` / `readGitResolutionCommit`） |
| 插件安装的外部进程方案 | `lib\dsh-cli.js`——其 `dshArgv()` 的 **PATH 回落在本机 Desktop 形态下不成立**，详见 §0.3 |
| 自重启实现（**首版需移植并改造**，不是"不推荐采用"） | `lib\restart.js`（28 KB）+ `lib\recovery.js`（48 KB）+ `resources\runtime\cli\bin\dsh.cmd`（正确的启动配方） |
| skill 根目录解析 | `…\@michengai\dsh-skills-manager\lib\core.js`（`join(resolveDshHome(), "skills")`） |
| 目录/凭据布局 | `C:\Users\Maxxie\.dsh\`、`…\profiles\desktop\` |

> dshmarket 为 **MIT** 许可；借鉴代码请在新项目 README 中注明来源与许可。

---

## 16. 决策记录与未决问题

### 已决策（2026-10-01）

> 产品边界（UI 形态、多目标、skills 打包、一键重启、历史保留、文档语言等）已逐条确认并**单独冻结在 §0**；本节只保留原始四条立项决策。

| # | 决策 | 结论 |
|---|---|---|
| D1 | 路线 | **独立插件**，先做 MVP，不依赖 dsh-market 排期 |
| D2 | WebDAV 目标 | **公网与私有（局域网/自建/Tailscale）都要**：默认硬化，另设显式私有目标开关（按目标保存） |
| D3 | v1 备份范围 | **profile 配置 + 插件清单 + 模型配置（不含 key）**，并**必须生成兜底文档**（含插件名、模型供应商、baseURL、模型与配置数值、skill 名），保证兼容性全失败时用户可照文档手工重配 |
| D4 | 命名 | 项目 / 仓库名 `dsh-BrittleBackup`；npm 包名 **`dsh-brittlebackup`**（npm 新包强制小写）；loader entry id 前缀 `brittle-backup`；**设置命名空间与 entry id 相同**（原稿写 `dsh-brittle-backup`，实测契约要求它是 profile entry id，已纠正）；凭据 ref 基础名 `DSH_BRITTLE_BACKUP_*` 并**按目标派生**（完整约定见文首"命名约定"表） |

### 未决（需要确认后才能定稿/开工）

| # | 问题 | 影响 |
|---|---|---|
| ~~Q1~~ | ~~新仓库放在哪个路径~~ | **已解决**：仓库落在 `F:\Git\dsh-brittleBackup`，remote `origin = https://github.com/toookamak/dsh-brittleBackup.git`。注意目录名 / 仓库名是小写 `b`，与文档命名表的展示名 `dsh-BrittleBackup` 存在大小写差异，实现时统一 |
| ~~Q2~~ | ~~v1 是否包含客户端 UI~~ | **已解决：包含**。形态 = 顶层独立设置页（`settings.section`），全部边界见 §0 |
| ~~Q3~~ | ~~GitHub 后端 v1 只做 Gist，还是同时做私有仓库 Contents API~~ | **已解决**：**两个都做**（U27）；历史模式与远端保留见 U26 / U28 / U29 |

---

## 附录 A：给实现者的最短路径建议

1. 先做 **M1 + M3**（采集、剥离、兜底文档、本地导出）——即使不做任何网络与恢复，这份文档本身就已经解决了用户"兼容性全炸"的痛点，价值密度最高、风险最低。
2. 再做 **M2**（恢复），优先把 §7-#1/#2/#6/#13 四条"拦截"级检查做实。
3. 传输层最后做：先 WebDAV（你的主要诉求，含私有模式），后 GitHub。
4. UI 是**首版范围内的交付**（§0 的 U1 / U3），不是"最后再加"：一个顶层独立设置页承载配置、触发、恢复、历史。演练可先用 host 路由手动触发，但发版必须带 UI。
