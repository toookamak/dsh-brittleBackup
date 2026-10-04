# dsh-BrittleBackup 项目方案

| 项目 | 内容 |
|---|---|
| 项目名 | `dsh-BrittleBackup`（仓库 / 展示名） |
| npm 包名 | `dsh-brittlebackup`（npm 新包名必须全小写，见下方命名约定） |
| 文档版本 | v4（**阶段一：仅本地导出 / 导入**；2026-10-02 第二次修订补齐实现契约，见 §17） |
| 编写日期 | 2026-10-01（2026-10-02 重新冻结范围；同日第二次修订补齐实现契约） |
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
| 插件工作目录（快照 / temp） | `<DSH_HOME>\dsh-brittle-backup\` | 与 profile 目录同级的用户数据目录；**不是导出落点**（导出落点由用户自选，U31） |
| 产物形态 | 先生成 `dsh-brittle-backup-<YYYYMMDD-HHmmss>\`，默认交付同名 `.zip`；取消压缩则交付目录。内容为 `backup.json` + `兜底文档.md` +（勾选时）`skills\` | zip 是本地运输层封装，导入自动解压；`latest.json` 与独立 skills zip 属阶段二 |
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
| **本期收窄** | U10 恢复入口 → **只从本地目录或本地 zip**（不支持 WebDAV 下载与剪贴板粘贴）、U16 → **一份产物导出到用户自选目录**、U17 → skills 文件**以 `skills/` 子目录随导出目录一起走**（不再是独立 zip 附件；整体目录可封装为 zip） |
| **本期新增** | **U30** 导出形态 = 一个**目录**（`backup.json` + `兜底文档.md` + `skills/`）；**U31** 导出落点 = **用户自选目录**，插件不维护导出历史；**U32** profile 配置读写**走官方 `settings` / `configEditor` 服务**（结构化，放弃"保留注释与行形式"）；**U33** 导入后仍用 `credentials.describe()` 查"本机缺哪个 key" |
| **本期新增（第二次修订）** | **U34** 三处受限 `node:fs` 例外（快照目录 / 用户选定导出目录 / `<DSH_HOME>\skills`）；**U35** 导入可取消（取消 = 回滚）；**U36** 产物补 `enabled` 与 `producer.hostname`，`entries[]` 只收 override 非空条目，账号名不采集；**U37** 安装类写入（`package.json` / `pnpm-lock.yaml` / bundle 启停）由 `pluginManager` 独占。明细见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §3 与本文 §17 |
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
| D6 | 必须提供**取消**（**本期保留**，落为 U35）；且「取消恢复」= 回滚到操作前 | U25 + U21 |
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
| §6.3 / §6.4 | 多目标汇报、WebDAV 双模式、GitHub 后端 |
| §6.6 | 一键立即重启 |
| §9 威胁 2–3 与威胁 8 / §10 网络项 | 出站 SSRF、远端删除、上传失败与服务商差异 |
| §13 R8 | 第三方服务商限制（WebDAV 路径 / 重定向 / 根目录） |
| §16 Q3 与 §0.7 | 远端历史与清理 |
| §5.1（**整节作废**） | 早期 JSON 草案（单文件、`files[].lines`、内嵌 `doc.content`、zip 附件、上传语义）—— 产物 schema 以 [FORMAT.md](FORMAT.md) 为唯一权威 |
| §6.1 ④ | "本地落盘 `<DSH_HOME>\dsh-brittle-backup\`" —— 本期落盘到**用户自选目录**（U31），内部目录只存快照与临时文件 |
| §10 其余行 | "体积超限 → 拒绝上传"等表述已随 U31 改写为"明确报错，不静默截断" |
| §12 | M6 / M7 为阶段二；本期里程碑 **M0–M5** 见 §12 与 §17.6 |
| §14 | 已整体改写为阶段一验收清单 |

**阶段一已对齐的部分**：§0.0–§0.8（本节）、§4.1（配置读写行；`package.json` 写回归属见 U37）、§4.2、§5.2（兜底文档模板与语言规则；产物字段以 [FORMAT.md](FORMAT.md) 为准）、§6.1–§6.2、§6.5、§7（14 项检查**全部适用**）、§8.1–§8.5（文件操作例外见 §17.4）、§10、§11、§12（M0–M5）、§14、§17。

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

### 3.4 可用的公开服务（2026-10-02 重新内省；签名以下表为准）

> 所有服务的访问契约都是 **optional**（`ctx.get('x')` + `typeof service?.method === 'function'` 探测）；下表的"必需"指**功能必需**，不是加载硬依赖。

| Service | 本项目用到的成员（实测签名） | 用途 |
|---|---|---|
| `pluginManager` | `listPlugins()`、`listBundles()`、`installBundle(spec, { enabled?, requestId?, approvedBuilds?, registry? })`、`waitForInstall(requestId)`、`cancelInstall(requestId)`、`removeBundle(name)`、`setBundleEnabled(name, enabled)`、`setPluginEnabled(id, enabled)`、`inspect(spec)` | 恢复时安装插件、对齐**启用状态**、读取当前插件/包信息。**它独占 `package.json` / `pnpm-lock.yaml` 的写入**（U37） |
| `credentials` | `describe(ref)`、`describeRecord(key)`、`listRecords()` | 生成"缺哪些 key"清单（**不读值**，U33） |
| `skills` | `list(options?)`、`snapshot(options?)`、`get(name, options?)` | 取 skill 名称/描述（文件本体走 §17.4 的受限 `node:fs`） |
| `settings` | `describe(options?)`（**同步**，返回 `SettingsDescriptor[]`，含 `secrets?: { path: string[]; set: boolean }[]`）、`update/replace/mutate(ns, …, expectedRevision?)` | 脱敏的权威依据 + 存放本插件自己的配置（`ns` = profile entry id = `brittle-backup`） |
| `webServer` | `register(route)` | 注册本机 HTTP 路由（与客户端 UI 通信；接口契约见 §17.2） |
| `configEditor` | `entries()`、`configuration(): Array<{ entry, inherited, override }>`、`edit(entry, change)` | 以"官方编辑路径"读写 profile 配置条目。**功能必需**：缺失时配置条目不自动还原（§4.2） |
| `agents` | `list()` | agent 忙碌闸门：判定 `agent.status === 'running'`，服务缺失 / 状态未知 fail-open（§17.5） |
| `fs` | `resolve`/`stat`/`lstat`/`readText`/`streamText`/`readBytes`/`listDir`/`writeText`/`editText` 等 | 读文本与目录列举。**没有删除、没有建目录、没有写二进制** —— 目录树复制、快照与回滚因此走受限 `node:fs`（§17.4） |
| `directoryPicker` / `directoryPickerController` / 客户端 `uiWorkspace` | `directoryPicker.capability()`；`directoryPickerController.pick()`（Remote）；客户端 `uiWorkspace.pickDirectory()` | 导出落点与导入来源的目录选择。注意：**`directoryPicker` 本身不能发起选择**，它只有 `capability()` |
| `slots`（客户端） | `register` / `registerFactory` / `inject` | 注册顶层设置页 `settings.section`（注册参数 `{ id, order, label }`，见 §17.3） |
| `storageDomain` | `open(spec)`、`get(name)` | **可选**：需要结构化持久化时的备选 |

> 注：`pluginManager` 是官方插件管理能力的服务形态，用它装插件比 spawn `dsh plugin add` 更稳（本机 `dsh` **不在 PATH** 上，桌面版由宿主启动，外部进程方案天然脆弱）。

### 3.5 环境事实

- `DSH_HOME=C:\Users\Maxxie\.dsh`，`DSH_PROFILE=desktop`，`DSH_PROFILE_DIR=C:\Users\Maxxie\.dsh\profiles\desktop`。
- 已装 bundle：`dshmarket 1.66.7`（profile spec `^1.66.7`）、`dsh-better-sidebar 0.24.1`、`@michengai/dsh-skills-manager 1.1.8`、`@michengai/dsh-agency-agents 1.0.7`、`dsh-context 0.62.2`；核心 bundle `@deepseek-ai/dsh-base` / `dsh-web-app` 等为 `0.2.0-rc.2`（与实测 `desktopVersion: 0.2.0-rc.2` 一致）。
- `node`：`C:\Program Files\nodejs\node.exe`（v22.23.1，**这是系统 node，不是宿主进程的运行时**）；`pnpm`：`C:\Users\Maxxie\AppData\Roaming\npm\pnpm.ps1`；`dsh`：**不在 PATH**（实测 `Get-Command dsh` 无结果）。宿主运行时为 Node 24.21.0 / pnpm 11.7.0，见文首基线。
- `skills` 目录**当前不存在**（实测 `<DSH_HOME>\skills` 为 False）；`.dsh-market` 下只有 `discovery-compatibility-v1.json` / `log.ndjson` / `state.json`，**尚无 `snapshots` 目录**（dsh-market 的 `SNAPSHOT_DIR = .dsh-market/snapshots` 按需创建）。
- dsh-market 日志显示：**有 agent 正在运行时，profile 变更会被拒绝**（`install-blocked`）。其实测实现为 `lib\routes.js` 的 `runningAgentsForGuard()`：`ctx.get('agents')` → `service.list()`，**服务缺失时只记一次 warn 日志并降级**，绝不抛错。本插件必须遵循同一约束与同一降级姿势。
- dsh-market 是 MIT；npm 包内含 `src/*.ts` 全量源码，是最佳参考实现。

---

## 4. 产品边界

### 4.1 阶段一范围

> 本表已按 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) 的阶段一范围重写；带 🔜 的行属**阶段二**，本期不实现。产物字段以 [FORMAT.md](FORMAT.md) 为准。

| 分类 | 阶段一包含 | 说明 |
|---|---|---|
| profile 配置 | `cordis.patch.yml` **结构化条目**（只收录有 override 的 patch 目标条目）、`package.json`、`pnpm-workspace.yaml` 原文 | **放弃注释与行顺序**（U32）；密钥强制剥离；`package.json` **只读采集**，写入由 `pluginManager` 独占（U37） |
| 插件清单 | name / spec / 实际版本 / 来源类型 / commit / **enabled** / 一句话用途 / `unportable` | 不搬运 `node_modules`；`enabled` 让"已装但被禁用"能被还原（U36） |
| 模型配置 | provider（key、displayName、api、baseURL、apiKeyEnv）+ models[] + 默认模型 | 无任何密钥值 |
| skills | 默认**仅名字 + 描述 + 路径**；用户可勾选"连文件一起" | 文件落地为导出目录下的 `skills\` **子目录**（逐字节，含子目录与二进制文件），不再是独立 skills zip；整个导出目录默认可封装为 zip（U17 收窄） |
| 兜底文档 | Markdown，含插件表、provider 表与可粘贴 YAML、模型表、skill 名、手工重建步骤 | 与 JSON 同源同版本；零主机名 / 零本机路径 |
| 恢复 | 预览 diff、逐项勾选、兼容性闸门（§7 全 14 项）、环境差异对照、合并应用、缺 key 提示、**取消 = 回滚**、失败回滚 | 见 §6.2 / §7；入口只有本地目录（U10 收窄），新增 U35 |
| 本地能力 | 导出到用户自选目录、从本地目录导入、导入前自动快照 | 保证离线可用；不维护导出历史（U31） |
| 文件操作 | 三处受限 `node:fs` 例外（快照目录 / 用户选定导出目录 / `<DSH_HOME>\skills`） | 宿主 `fs` 服务缺删除 / 建目录 / 写二进制，见 §17.4（U34） |
| 🔜 传输 | GitHub（Gist 优先）、WebDAV（公网硬化 + 显式私有目标模式）、多目标 | 阶段二；见 §6.3 / §6.4 |
| 🔜 重启 | 一键立即重启 | 阶段二；本期导入完成后只提示"需要重启 DSH 生效" |
| 🔜 历史与保留 | 历史列表、保留上限、手动删除、一键进入恢复向导 | 阶段二；本期导出文件由用户自行管理 |

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

### 5.1 JSON 主体（🔴 本节已作废，仅作历史记录）

> **产物 schema 的唯一权威是 [FORMAT.md](FORMAT.md)。** 本节以下的 JSON 草案（单文件 `.json`、`items.profile.files[].lines`、内嵌 `doc.content`、zip 附件、WebDAV/GitHub 上传语义）**已随阶段一作废**：实现、测试与验收一律以 [FORMAT.md](FORMAT.md) §2 为准，冲突时以它为准。保留本节只为记录设计演进。

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

约束（**旧草案的下限口径已作废**，数值以 [FORMAT.md](FORMAT.md) §7 的"宽松防爆"表为准）：

- 🔴 已作废：以下三条按旧草案（单文件 + zip 附件 + 上传）写；阶段一的产物是**一个目录**（U30），skills 文件是 `skills\` 子目录、没有 zip、没有上传。
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

> skills 文件**不在本文件里**。若备份时勾选了"连文件一起"，文件在同目录的 `skills\` 子目录中（阶段一形态，U17 收窄）。
> 本文件**刻意不含配置原文**（U5）：只给可粘贴的片段与步骤，以便安全地单独分享。
```

生成规则：
- provider 段落中的 YAML 片段必须是**可直接粘贴回 `cordis.patch.yml` 的合法条目**（缩进正确、含 `id`/`name`/`config` 三层）。
- "需要填写的设置项"必须结合 `requiredCredentials` + 恢复时 `credentials.describe()` 的实时结果，标注 `已配置` / `缺失`。
- 用途列取已装包 `package.json` 的 `description`；取不到就留空，**不得编造**。
- 若某项数据采集失败（文件读不到、skill 目录不存在），文档中写"未采集到"，不要省略整节。
- **文档语言**按用户设置输出（中 / 英 / 双语，默认跟随界面）；选双语时**同一份文档内中英对照**，不出两个文件（U22 / D1）。
- 文档**不得包含**：任何密钥值、任何主机名 / 地址 / 账号名、任何配置原文（U5 / U20）。这是"可以安全单独分享"的前提。

### 5.3 命名与版本策略 🔜 阶段二

> 本节描述上传 / 覆盖式后端 / 附件命名，**本期不适用**（本期产物形态见 [FORMAT.md](FORMAT.md) §1）。

- 产物格式版本 `version` 独立于插件版本；恢复侧只接受 `version === 1`（未来接受 `<= 当前支持` 并提供"仅预览"）。
- 文件名带时间戳用于留存历史；`*.latest.json` 用于覆盖式上传（WebDAV 单一目标场景）。
- 上传时可选同时上传兜底文档与 skills zip 附件；**JSON 是权威，md 与 zip 都是附件**，附件失败不影响备份成功，只在结果中提示（GitHub 目标本就不接受 zip 附件，见 U11）。

---

## 6. 功能规格

### 6.1 备份流程

```
① 选择内容（默认：profile 配置 / 插件清单 / 模型配置 / skills 清单 / 兜底文档；skills 文件默认关）
② 选择落点（系统目录选择器 → 本次返回值写入宿主白名单，U31 / §17.2）
③ 采集（逐项 try/catch，缺失记 absent，不中断）
④ 剥离密钥（结构化扫描 + 替换，记录 redactions[]）
⑤ 生成 backup.json + 兜底文档（+ 勾选时的 skills\），用受限 node:fs 原子落盘到用户目录
⑥ 密钥自查扫描：命中即拦截整次导出并提示命中位置
⑦ 报告：产物目录、体积、被剥离项数量、文档路径、警告条目
```

- 采集阶段的每一次失败都必须转化为"结果里的一个警告条目"，不允许整次导出失败（唯一的硬失败：无法读取 `package.json`，因为那是恢复的最低要求）。
- **本期没有上传步骤**（远端属阶段二）；导出只写用户自选目录与插件内部工作目录。
- 目标目录重名时派生 `-2`、`-3` 后缀，绝不覆盖既有数据。

### 6.2 恢复流程

```
① 取得备份（本期只有一种：本地目录 / 目录内的 backup.json；来源规则见 §17.5）
② 严格校验（format/version/路径安全/条目数/体积）→ 失败即止，不写任何文件
③ 只读预览：逐项 diff（新增 / 覆盖 / 跳过 / 无法自动恢复）
   每项标注：✅ 可自动恢复 ｜ ⚠️ 可恢复但有风险 ｜ ❌ 只能照文档手工做
④ 用户逐项勾选
⑤ 应用：
   a. 写前自动快照（本插件自己的快照目录，独立于 .dsh-market）
   b. profile 配置条目：configEditor.edit(entry, change) 按 patch 目标 id 合并（U32 / U36）
   c. package.json / pnpm-workspace.yaml：只读比对；`allowBuilds` 需展示 diff 并显式确认
   d. 插件：已装 → setBundleEnabled / setPluginEnabled 对齐启用状态；缺失 → installBundle(spec, { enabled }) 逐项安装；失败项不影响其他项
   e. skills：勾选了文件附件才写 `<DSH_HOME>\skills\<name>\`（逐字节，含子目录与二进制）；否则只做清单核对
   f. 缺 key 清单：credentials.describe(ref)
⑥ 汇总报告：成功项 / 失败项 / 需手工项 / 需要补的 key / 是否需要重启
⑦ 出错或用户取消 → 回滚到快照；回滚不完整必须显式报告（写明残留文件）
```

硬性规则：

- **合并语义**：备份里没有的插件、配置条目一律不删；`absent[]` 不是删除指令。
- **有 agent 运行时拒绝写 profile**：判定为 `agents.list()` 中存在 `agent.status === 'running'`；服务缺失或状态未知时 **fail-open**（只记一次 warn，不阻断）。
- **可取消**（U35 / `D6`）：取消 = 停止剩余项 + 回滚已写入项；正在进行的安装调 `pluginManager.cancelInstall(requestId)`，返回 `too-late` 时必须在报告里说明该项可能已生效。
- **①–⑤ 之前全程只读**：校验与预览不产生任何写操作。
- **恢复后必须明确告知"需要重启 DSH 才能生效"**（本机 dsh-market 的日志与配置说明都表明 profile 变更是重启/热加载级别的事，不能假装即时生效）；一键重启属阶段二（U7 后置）。
- 目标文件若存在且其实是目录/符号链接 → 拒绝该项，不越权删除。
- 不写 `cordis.yml`、不写 `node_modules`、不写 `.credentials.yaml`。
- 目录树复制、快照与回滚所需的删除 / 建目录 / 写二进制走受限 `node:fs`（§17.4 / U34）。

### 6.3 WebDAV 双模式 🔜 阶段二

> **本期不做网络传输**，本节保留以备阶段二（安全细则同样见 [SECURITY.md](SECURITY.md) §3）。

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

### 6.4 GitHub 后端 🔜 阶段二

> **本期不做网络传输**，本节保留以备阶段二。

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

### 6.6 重启语义 🔜 阶段二

> **本期只提示"需要重启 DSH 生效"**（见 §6.2 硬性规则与 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §2.3）；一键立即重启属阶段二。

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

### 8.2 目录结构（已实现；2026-10-02 更新）

> **与早期草案的差异**：源码是**纯 ESM JavaScript**（`src/*.js`），没有 TypeScript、没有构建步骤 —— 这台机器的 profile `node_modules` 里没有 `typescript` / `tsdown`，而"零依赖、零构建"同时服务了"抗升级"与"离线可跑"两个目标。原草案的 `*.ts` 文件名只在语义上对应（见下表）。
> 插件自身设置也**不写 profile 配置**，落在 `<DSH_HOME>\dsh-brittle-backup\settings.json`（理由见 §17.1）。

```
dsh-BrittleBackup/                 ← 仓库根（npm 包名 dsh-brittlebackup）
├─ package.json                 # name/version/dsh.bundle/peerDependencies（零 dependencies）
├─ cordis.patch.yml             # 本插件插进 profile 的 loader 条目（insert: id = brittle-backup）
├─ README.md  LICENSE  .gitignore
├─ docs/                        # 本文件 / SCOPE-PHASE1 / FORMAT / SECURITY
├─ scripts/
│   └─ selfcheck.mjs            # 语法自检 + "无网络代码 / 不碰 .credentials.yaml" 断言
├─ src/
│   ├─ index.js                 # 插件入口：export name + apply（只挂路由，不做别的）
│   ├─ routes.js                # 本机 HTTP 路由 + loopback / 转发头 / 同源 / 选择器白名单
│   ├─ paths.js                 # 路径与命名常量、包含关系守卫、产物路径合法性
│   ├─ log.js                   # 日志（必先脱敏；宿主 logger 缺失则 console）
│   ├─ nodefs.js                # 受限 node:fs 原语（原子写 / 目录树复制 / 删除 / 列举）
│   ├─ services.js              # 服务探测与降级（ctx.get + 方法存在性）
│   ├─ settings.js              # 自身设置（工作目录 settings.json）
│   ├─ task.js                  # 任务状态（宿主侧内存）+ 单任务闸门 + 取消
│   ├─ redact.js                # 三道防线：密钥路径图 / 字段名剥离 / 正则自查
│   ├─ doc.js                   # 兜底文档生成器（中文，自包含可分享）
│   ├─ artifact.js              # 产物组装、严格校验、落盘、读取与定位
│   ├─ export.js                # 导出编排：采集 → 剥离 → 自查 → 文档 → 落盘 → 报告
│   ├─ credentials.js           # 凭据状态（只问有没有，永不读值）
│   ├─ semver.js                # peerDependencies 判定（含 prerelease 语义）
│   ├─ diff.js                  # 结构化 diff / 深度合并
│   ├─ collect/
│   │   ├─ index.js             # 采集总编排（逐项 try/catch，唯一硬失败 = package.json）
│   │   ├─ profile.js           # 结构化配置条目 + package.json / pnpm-workspace.yaml
│   │   ├─ plugins.js           # 清单 + 版本 + lock commit + enabled + unportable
│   │   ├─ models.js            # 从结构化配置派生 provider / models / 默认模型
│   │   └─ skills.js            # skills.list + 目录扫描（元数据与文件数）
│   └─ restore/
│       ├─ import.js            # 导入编排：预览（只读）→ 拦截判定 → 应用
│       ├─ host.js              # 宿主现状快照（配置条目 / 插件 / patch id / agent / skills）
│       ├─ checks.js            # §7 的全部 14 项检查
│       ├─ plan.js              # 逐项计划 + diff + 默认勾选规则
│       ├─ snapshot.js          # 写前快照、回滚、剪枝
│       └─ apply.js             # 配置 / 文件 / 插件 / skills 的应用与回滚包装
├─ test/                        # node:test：单元 + 端到端 + 路由硬化（fake-host 内存宿主）
├─ client/                      # ✅ 设置页 UI（手写零构建 bundle，settings.section，仅中文）
└─ 🔜 阶段二新增：src/transport/（webdav.js、gist.js）、src/restart.js、src/recovery.js
```

### 8.3 服务依赖与调用点

| 调用点 | 依赖 | 降级行为 |
|---|---|---|
| 结构化配置读写 | `ctx.configEditor.configuration()` / `edit()` + `ctx.settings.describe()` | **不可用 → 不读写 profile 配置**，只导出 / 导入插件清单、模型信息、skills 与兜底文档，并明确提示（U32；**不再有"行级合并写入"的兜底**） |
| 恢复插件 | `ctx.pluginManager.installBundle` + `waitForInstall` | 服务不存在 → 只还原配置与文档，插件列入"照文档手工安装" |
| 缺 key 清单 | `ctx.credentials.describe` | 不可用 → 只输出 `requiredCredentials` 名单 |
| skill 元数据 | `ctx.skills.list` | 不可用 → 直接扫 `<DSH_HOME>\skills` 目录 |
| 自身设置 | `ctx.settings`（命名空间 = entry id `brittle-backup`） | 不可用 → 本次不改动自身设置，仅用默认值 |
| 目录选择 | `ctx.directoryPickerController.pick()`（宿主 Remote）/ 客户端 `uiWorkspace.pickDirectory()`（注意：`ctx.directoryPicker` **本身只有 `capability()`**） | 不可用 → 写入 `<DSH_HOME>\dsh-brittle-backup\exports\<ts>\` 并提示路径（选择器白名单见 §17.2） |
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
8. **文件操作例外（U34）**：除 §17.4 列出的三个路径（快照目录 / 用户选定导出目录 / `<DSH_HOME>\skills`）外，一律不直接用 `node:fs`；第 1 条（不深路径 import DSH 内部模块）不因本例外而放宽。

### 8.5 数据流（阶段一）

```
              ┌──────────────── 导出 ────────────────┐
profile 条目 ─┐                                      ├─ <用户自选目录>\dsh-brittle-backup-<ts>\
package.json ─┤→ 采集 → 剥离密钥 → 组装 → 自查扫描 ──┤   ├─ backup.json
pnpm-workspace┤   (credentials 只取 ref 名)          │   ├─ 兜底文档.md
credentials ──┘                                      │   └─ skills\（勾选时，逐字节）
                                                     └─ 内部目录 <DSH_HOME>\dsh-brittle-backup\（快照 / temp）

              ┌──────────────── 导入 ────────────────┐
本地目录 ──→ 严格校验 → 只读预览(diff+级别) → 用户勾选 → 快照
                                                      │
                    ┌─────────────────────────────────┴────────────────────────────┐
             configEditor.edit 按 id 合并                     pluginManager 安装 / 启停对齐
             （package.json 只读，不写，U37）                    （失败项隔离，不整体失败）
                    └─────────────────┬───────────────────────────────────────────┘
                              汇总 + 缺 key + "需要重启"提示
                              失败或取消 → 回滚到快照（残留必须列出）
```

> 🔜 阶段二才有的分支：上传到 GitHub Gist / WebDAV、下载、远端保留与清理、一键立即重启。

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
| 产物体积超限 | **明确报错**并给出当前体积与上限，**不静默截断**；提示关闭某些勾选项后重试 |
| 🔜 上传网络失败/超时（阶段二） | 保留本地产物，报告 HTTP 状态与可操作建议（404 → 目录问题；401/403 → 凭据问题；私网被拒 → 提示开启私有目标模式） |
| 🔜 WebDAV URL 非法（阶段二） | 按 §6.3 分类给出**具体**原因（不是笼统的 invalid URL） |
| 🔜 Gist 超过 1 MiB（阶段二） | 拒绝并建议改用私有仓库后端或仅上传精简 JSON |
| 恢复时 DSH 版本不同 | 警告 + 继续，逐项标注风险（`dshVersion` 为 `unknown` 时降级为信息级） |
| 某插件安装失败 | 该插件标失败并从 manifest 回退（避免幽灵依赖让 pnpm 全盘拒装），其余继续 |
| 恢复中途异常 | 回滚到快照；回滚不完整则显式列出残留文件 |
| 用户取消导入 | 停止剩余项 + 回滚已写入项；`cancelInstall` 返回 `too-late` 的项单独说明；报告列出无法回滚的残留 |
| 目录选择器不可用 | 退化为写 `<DSH_HOME>\dsh-brittle-backup\exports\<ts>\` 并提示路径；不维护历史列表 |
| 导出目录重名（同秒） | 派生 `-2`、`-3` 后缀，绝不覆盖既有数据 |
| 导入来源同时存在多份产物 | 列出候选目录让用户选择；均无 `backup.json` 时明确报错并说明期望结构 |
| 快照无法写入 / 剪枝失败 | 视为**硬失败**：不进入写入阶段；剪枝失败只记警告（不影响本次导入结果） |
| 服务缺失（老/新 DSH） | 走 §8.3 降级分支，UI 明示"当前版本不支持自动 X" |
| 有 agent 在运行 | 拒绝写 profile，提示稍后重试（判定与 fail-open 见 §6.2 硬性规则） |

---

## 11. 测试方案（阶段一）

**单元测试**
- `redact`：内联 `apiKey`、嵌套 provider、`apiKeyEnv`（不应被剥）、注释中的疑似密钥、已 `REDACTED` 的值（幂等）；`secrets[].path` 为字符串数组时的路径匹配。
- 采集筛选（U36）：`override` 为空的条目**不入产物**；`enabled: false` 的插件被正确标记。
- 产物校验：format / version 闸门、路径穿越、绝对路径、重复路径、超大、缺 `package.json`、未知 `version`。
- 恢复计划：§7 每一条检查各一例，断言级别（拦截 / 警告 / 信息）。
- 合并语义：目标机多出的插件不消失；同 `id` 条目默认保留目标机；`enabled` 分支（已装被禁用 → `setBundleEnabled`，不重装）。
- agent 闸门：`status === 'running'` 才拦；服务缺失 / 状态异常 fail-open。
- 来源选择：目录自身含 `backup.json` / 子目录多份 / 零份 三条分支。
- 文档生成：给定 JSON → 文档包含全部 provider/模型/skill 名称与可粘贴 YAML（快照测试固定模板）；断言文档**不含**主机名与本机路径。

**集成测试（fixture profile：样例 `package.json` + `cordis.patch.yml`）**
- 导出 → 改动 → 导入 → 断言文件内容与配置条目一致。
- skills 目录树往返：含子目录、空目录、二进制文件（如 png）逐字节一致。
- 中途取消 / 注入失败（只读目录、agent 在跑、安装失败）→ 断言回滚与报告；`cancelInstall` 返回 `too-late` 的分支单独断言。
- 路由硬化：非 loopback、`Forwarded` / `X-Forwarded-For`、`Origin` ≠ `Host`、GET 触发写操作 —— 四类请求均被拒绝。
- 预览只读：①–⑤ 期间不写 profile / skills / 用户落点；若来源是 zip，仅允许在插件工作目录 `dsh-brittle-backup\extracted\` 生成解压缓存，再做只读校验。

**端到端演练（发版前必做）**
1. 在本机 profile 导出 → 换一台机器 / 干净 profile 导入 → 断言"插件齐全、模型可用（补 key 后）、skills 就位"。
2. 干净 profile 上**仅凭兜底文档**手工重配 → 能跑起来（S4 盲测）。
3. 注入失败（只读目录、有 agent 在跑、安装失败）→ 断言回滚与提示。
4. 人为制造"服务缺失"（模拟 `configEditor` / `settings` 不可用）→ 断言不写配置条目且提示正确。

> 🔜 阶段二测试（mock WebDAV、公网 / 局域网演练、SSRF 判定矩阵、重启恢复页）见 §0.8 与 [SECURITY.md](SECURITY.md) §3。

---

## 12. 里程碑与任务拆分

| 里程碑 | 交付 | 验收 |
|---|---|---|
| ✅ **M0 骨架** | 插件可被 DSH 加载；能力探测与降级框架；日志脱敏；路由骨架与硬化 | 自检通过；`apply()` 在无任何服务时不抛错；卸载后 profile 无残留（`cordis.patch.yml` 只有一个 insert entry） |
| ✅ **M1 采集与产物** | profile/插件/模型/skills 采集；密钥剥离；JSON + 文档生成；本地导出 | 单元测试通过；S2 达成（产物零密钥） |
| ✅ **M2 恢复** | 校验、预览计划、§7 全部 14 项检查、深度合并写入、快照回滚、取消 | 集成测试通过；S6 达成（失败 / 取消都能回滚） |
| ✅ **M3 兜底文档定稿** | 文档模板（含"本次包含什么"、可粘贴片段、默认模型回落）+ 自动化盲测脚本 | 模板完成；**盲测脚本** `scripts/doc-audit.mjs` 已能对真实产物逐项判定"只看文档能否重配"，并有正反两个用例；人工盲测仍留给你 |
| ✅ **M4 UI** | 顶层设置页（`settings.section`）：导出勾选与落点复用 / 打开、默认 zip、导入人话摘要 + 可展开 14 项检查表、百分比进度 / 彩色结果 / 取消、降级提示 | 客户端契约实测确认（`__ModuleLoader__` 工厂 + `slots.register`）；宿主侧仿真断言装载形状 / 注册参数 / 渲染内容 / 无服务降级 |
| ⏳ **M5 阶段一验收** | 降级分支演练、密钥扫描、盲测、卸载无残留、**真实 DSH 加载** | §14 全表打勾（**需要你在真实 DSH 里装一次**） |
| 🔜 **M6 WebDAV**（阶段二） | 双模式、MKCOL/PUT/**PROPFIND**/GET/**DELETE**、重定向、超时/上限、错误文案、**远端保留清理** | S3 达成 + 历史保留与清理验证 |
| 🔜 **M7 GitHub**（阶段二） | Gist（覆盖式）+ **私有仓库 Contents API（历史 + 清理）** | 真实 Gist 与私有仓库演练均通过 |

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

## 14. 验收清单（阶段一发布前逐条打勾）

> 行为级验收以 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §6 为准；下表是发布前的总检查单。

- [ ] 导出目录结构正确（`backup.json` + `兜底文档.md` + 勾选时的 `skills\`），同秒重名派生后缀且不覆盖旧目录。
- [ ] `backup.json` 通过 schema 校验（含 `producer.hostname`、`plugins[].enabled`），且 `redactions[]` 与实际剥离项一致。
- [ ] `entries[]` 只含**有 override 的 patch 目标条目**；`inherited` 不参与还原。
- [ ] 对当前 profile 做一次全量导出，正则扫描无密钥命中。
- [ ] 兜底文档在**不看源码、不问题作者**的情况下能指导完成重配（S4）。
- [ ] 兜底文档不含主机名 / 账号名 / 配置原文 / 本机路径。
- [ ] 导入来源三分支正确（目录自身含 `backup.json` / 子目录多份列出候选 / 零份报错）。
- [ ] 校验与预览阶段不写 profile / skills / 用户落点；zip 预览仅允许在插件工作目录生成解压缓存。
- [ ] 导入一次含 5 个插件的产物：已装项对齐启用状态、缺失项逐项安装、失败项隔离、合并语义生效。
- [ ] skills 目录树（含子目录与二进制）逐字节往返一致。
- [ ] 缺 key 提示正确区分"已配置 / 缺失"。
- [ ] 人为制造中途失败：断言回滚到操作前状态，残留被列出。
- [ ] 中途取消：断言停止剩余项 + 回滚已写入项。
- [ ] 有 agent 运行时发起导入：断言被拒绝且不写任何文件；`agents` 缺失时断言不阻断。
- [ ] `configEditor` / `settings` 不可用时不写配置条目、提示正确，且 `package.json` / `pnpm-workspace.yaml` 采集展示仍正常。
- [ ] `pnpm-workspace.yaml`（`allowBuilds`）还原必须显式确认 diff 才写入。
- [ ] 路由硬化：非 loopback / 转发头 / 跨源 / GET 写操作 四类请求均被拒绝。
- [ ] UI 闭环：一个顶层设置页内完成 选目录 → 勾选 → 导出 → 预览 → 勾选 → 导入 → 报告 → 取消。
- [ ] 卸载本插件后，profile 不残留：manifest 无条目、无孤儿文件、`cordis.patch.yml` 无残留 `insert:`。
- [ ] 升级 DSH 一个小版本后插件仍能加载（功能可降级）。
- [ ] 全仓库无网络代码（无 `node:https` / `undici` / WebDAV / GitHub 调用）。

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
| 自重启实现（🔜 **阶段二**需移植并改造） | `lib\restart.js`（28 KB）+ `lib\recovery.js`（48 KB）+ `resources\runtime\cli\bin\dsh.cmd`（正确的启动配方） |
| agent 忙碌闸门（`status === 'running'` + fail-open） | `…\dshmarket\lib\agents.js`（`runningAgentIds`） |
| 客户端半契约（`dsh.client` 声明、slot 注册、client 构建链） | `…\dshmarket\package.json`（`dsh.client.inject` / `platform` / `exports["./client"]`）+ `…\dshmarket\client\client.js` |
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
| ~~Q3~~ | ~~GitHub 后端 v1 只做 Gist，还是同时做私有仓库 Contents API~~ | **已解决**：**两个都做**（U27）；历史模式与远端保留见 U26 / U28 / U29。**该决策已随阶段一后置到阶段二** |
| **Q4** | 宿主 `directoryPicker.capability()` 是否提供"发起选择"的能力？若否，落点校验走"客户端选择器返回值 + 宿主白名单"（§17.2） | 决定导出落点 / 导入来源是否需要在页面与宿主之间传路径，以及如何满足 [SECURITY.md](SECURITY.md) §4.5 |
| **Q5** | `configEditor.entries()` 返回的条目如何映射到"patch 目标 id"（实测 loader 内部 id 形如 `include:llm-pi-ai`，而 profile patch 用 `llm-pi-ai`） | 决定 `entries[].id` 与 `edit(entry, change)` 的取值 |
| **Q6** | 宿主 `connection.requestRejection` / `admit` / `authorizeIndex` 是否覆盖 [SECURITY.md](SECURITY.md) §4 的第 1–3 条 | 决定路由硬化是复用官方信任闸门还是自研 |

---

## 17. 实现契约（2026-10-02 第二次修订补齐）

> 本节把"原文里不够明确、会让实现者各自发明"的部分收敛成可执行规格。依据：2026-10-02 对本机宿主的只读内省（Service / Slots / Config provider）、本机 profile 实测、dsh-market `1.66.7` 源码。
>
> 本节与 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) / [FORMAT.md](FORMAT.md) / [SECURITY.md](SECURITY.md) 一致；冲突时以那三份为准（范围 → SCOPE；产物 → FORMAT；安全 → SECURITY）。

### 17.1 服务调用规范

服务签名清单见 §3.4。三条容易踩的补充：

1. `settings.describe()` 是**同步**方法；`describe({ redactSecrets: true })` 的 `secrets[].path` 是**字符串数组**（`RedactedSecret = { path: string[]; set: boolean }`），不是点分字符串。
2. 写自己的设置要带**乐观锁**：先 `describe()` 取 `revision` → `update(ns, patch, revision)`；revision 冲突时重新 `describe()` 重试一次，仍失败则提示用户，不静默覆盖。
3. `configEditor.edit(entry, change)` 需要 **Entry 对象**（来自 `entries()`），不是 id 字符串；产物里记录的是 **patch 目标 id**（见 §17.5）。
4. **源码形态：纯 ESM JavaScript、零依赖、零构建**（`src/*.js`）。这台机器的 profile 里没有 `typescript` / `tsdown`；"零依赖"同时满足"抗升级"与"离线可跑"。验收靠 `npm run verify`（自检 + `node --test`）。
5. **插件自身设置不写 profile 配置**：落在 `<DSH_HOME>\dsh-brittle-backup\settings.json`（见 [SECURITY.md](SECURITY.md) §2.4）。因此本插件**不导出 `Config` schema** —— 宿主 0.2 代的 settings 命名空间由 Config schema 派生，为一个"上次导出目录"静态 import `@deepseek-ai/schemastery` 会引入"依赖缺失 = 宿主起不来"的风险，与"loader 零副作用"冲突。代价：宿主通用的插件配置页不会显示本插件的偏好（本插件的偏好由 M4 的设置页自己读写）。

### 17.2 宿主 ↔ 客户端接口契约

路由统一前缀 `/brittle-backup`，全部经 [SECURITY.md](SECURITY.md) §4 硬化：

| 方法 | 路径 | 请求体 | 响应 | 副作用 |
|---|---|---|---|---|
| GET | `/brittle-backup/state` | — | `{ task: { id, kind: 'export' \| 'import', phase, progress, percent, startedAt, result?, error? } }` | **无** |
| POST | `/brittle-backup/export` | `{ options, targetDir }`（`options.compress` 默认 `true`） | `{ taskId }` | 写导出目录或 zip |
| POST | `/brittle-backup/open` | `{ path }` | `{ opened, path, via }` | 调起系统文件管理器，不写文件 |
| POST | `/brittle-backup/query` | `{ sourceDir, detail }` | `{ ok, text, source, zip?, summary }` | 从②导入来源读取 backup.json / zip，生成安全查询文本 |
| POST | `/brittle-backup/inspect` | `{ sourceDir }` | `{ artifact, checks[14], diff[], plan }` | **无**（只读预览） |
| POST | `/brittle-backup/pick` | `{ path? }` | `{ path, via: 'host-picker' \| 'registered' }` | 宿主发起目录 / zip 选择，或登记一次客户端选择器的返回值 |
| POST | `/brittle-backup/import` | `{ sourceDir, selection }` | `{ taskId }` | 写 profile 配置 / skills |
| POST | `/brittle-backup/cancel` | `{ taskId }` | `{ canceled, rolledBack, residuals[] }` | 回滚已写入项 |

- **任务状态由宿主侧持有**（内存）：页面轮询 `GET state`，重开设置页可见进度、结果与导出最终完成时间（`finishedAt`）；DSH 重启则任务丢失，**不承诺续跑**（D5）。
- **同一时刻只允许一个写任务**；已有写任务进行中时，第二个写请求返回 `409`。
- `targetDir` / `sourceDir` **必须命中"最近一次选择器返回值"白名单**（一次性、用后失效）；否则 `403`。页面自由构造的路径一律拒绝。
- 错误响应统一 `{ error: { code, message, detail? } }`，`code` 取稳定枚举：`ARTIFACT_INVALID`、`ARTIFACT_VERSION_UNSUPPORTED`、`ARCHIVE_INVALID`、`ZIP_FAILED`、`AGENTS_RUNNING`、`SERVICE_UNAVAILABLE`、`PICKER_NOT_ALLOWED`、`PATH_UNSAFE`、`BUSY`、`CANCELED`、`ROLLBACK_INCOMPLETE`。
- 无 UI（`webServer` 或客户端 slots 不可用）时，宿主侧仍按 §4.2 降级：本期**不提供**命令 / 工具入口（U24），因此这种情况下仅内部能力可用。

### 17.3 客户端半契约（M4 已实现，2026-10-02 实测确认）

**宿主装载契约（从参考实现的产物逆向确认）**：客户端半是一个由宿主 web shell 注入的**单文件 ESM**，必须以

```js
window.__ModuleLoader__.load({ id: '<npm 包名>', factory: (require) => { /* … */ return module.exports } })
```

登记自己；`factory` 通过宿主给的 `require()` 取外部模块（`react` 属于基线模块表，无需在 `dsh.client.inject` 里声明）。`module.exports` 必须是 `{ name, inject, apply }`：`inject` 是**客户端服务名**数组，`apply(ctx)` 里注册 slot。

- `package.json` 声明 `dsh.client = { inject: ["@deepseek-ai/dsh-client-ui-settings"], platform: "web" }`；`exports["./client"] = "./client/client.js"`；`dsh.bundle.patch` 指向自带 patch。`id` 必须等于 npm 包名（实测 dsh-market 也是这么做的：包名 `dshmarket` → `id: "dshmarket"`）。
- **零构建**：本插件的客户端半是**手写**的（只用 `React.createElement`，不用 JSX、不引 UI primitives、不依赖打包工具），所以这台没有 `tsdown`/`esbuild` 的机器也能交付 UI；`files` 里带 `client/`，`npm pack --dry-run` 已确认产物包含它。
- **注册方式**：客户端 `slots` 服务，注册到 **`settings.section`**：
  ```js
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'brittle-backup', order: 41, label: '兜底备份' },
    Section,   // React 组件；ownerProps 提供 { close }
  ))
  ```
  `id` 必须自用（复用已存在 id 会顶掉那一页）；当前占用 id：`account`、`general`、`models`、`plugins`、`agency-agents`、`skills-manager`、`agent-presets`、`market`、`better-sidebar`。
- **导入来源选择**：客户端 `uiWorkspace.pickDirectory()` 选择目录；若宿主提供 `pickFile` / `pickFilePath`，额外提供「选择 ZIP…」直接选择压缩包；两者都缺失时退化为手动登记绝对目录或 zip 文件路径。
- 页面**只**通过 §17.2 的路由与宿主通信，不直接操作文件系统；不注册工具、不注册聊天命令（U24 / D4）。
- 页面结构（U1 / U3 / U4）：一个设置页内三个功能区 —— ① 导出（7 个勾选项，含默认开启的 zip 压缩 + 落点复用 / 打开按钮）、② 导入（来源 → 人话摘要 → 可展开的完整 14 项验证表 + 备份配置查询 / 复制 + 逐项勾选 + `allowBuilds` 显式确认 → 开始导入）、③ 任务进度（阶段 / 百分比进度条 / 彩色成功失败结果 / 警告 / 取消）；备份配置查询（从②导入来源读取 backup.json 或 zip，生成安全摘要 / 脱敏详细结构 / 预览 / 复制 / 下载）。

### 17.4 文件写入与回滚策略（U34）

- 允许 `node:fs` 的三个范围见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §4.6；越界即 bug。所有写 / 删前先 `path.resolve` + 前缀校验，防 `..` 穿越。
- **快照**：写到 `<DSH_HOME>\dsh-brittle-backup\snapshots\<ts>\`，内容 = 本次将覆盖文件的**原内容** + 本次将新建文件的**路径清单**（`manifest.json`）。保留最近 10 份，超出按时间戳剪枝（剪枝失败只记警告）。
- **回滚**（顺序固定）：删除 manifest 中"本次新建"的路径 → 还原"本次覆盖"的原内容 → 删除本条 manifest。任何一步失败都要记入 `residuals[]` 并在报告中列出（U21）。
- **原子写**：同目录 temp 文件 + rename，不跨盘；`pnpm-workspace.yaml` 的写入必须展示 diff 并显式确认。
- **深度合并**：产物里有的键覆盖目标，**产物里没有的键一个都不动** —— 所以被剥离的 `apiKey` 不会抹掉目标机原有的值（浅合并会，这是踩过的坑）。
- **剥离值不往返**：产物的 `<REDACTED>` 只进报告（`redactedSkipped`），**绝不写回配置**，也绝不出现在兜底文档的可粘贴片段里（那里会换成"请自己填这一项"的提示）。
- **单项失败不整体回滚**：某文件被占用 / 权限不足 → 该项标失败 + 警告，继续其他项；但**快照阶段失败是硬失败**，不进入写入阶段。
- **目录树复制**（skills 与导出目录）：递归复制并**保留子目录、空目录与二进制内容**；导入同名 skill 时按用户选择 覆盖 / 跳过 / 重命名，绝不删除目标机其它 skill。
- **取消**：停止剩余项 → 对正在进行的安装调 `pluginManager.cancelInstall(requestId)`（`too-late` 必须在报告中说明）→ 执行回滚。

### 17.5 采集与判定口径（把 §7 的检查落到实处）

| 议题 | 口径 |
|---|---|
| `entries[]` 收录范围 | 只收 `configEditor.configuration()` 中 `override` **非空**的条目；`entries[].id` = profile patch 里的 `- id:`（patch 目标 id，Q5） |
| `package.json` 写入 | 本插件**不写**（U37）：只读采集；安装 / 启停全部走 `pluginManager`（其失败时自行还原 `package.json` 与 lock） |
| `enabled` 来源 | `pluginManager.listBundles()` / `listPlugins()` 的 `enabled` |
| 恢复插件分支 | 目标机**缺失** → `installBundle(spec, { enabled })`；**已装** → `setBundleEnabled` / `setPluginEnabled` 对齐启用状态，**不重装**；**已装但版本不同** → 默认保留目标机版本（§7-#7），用户显式勾选才按精确版本覆盖 |
| DSH 版本来源 | 取核心 bundle `@deepseek-ai/dsh-base` 的 `version`（`listBundles()`）；取不到写 `"unknown"`，此时 §7-#3 降级为信息级 |
| agent 忙碌判定 | `agents.list()` 中存在 `agent.status === 'running'`；服务缺失 / 抛错 / 状态未知 → **fail-open**（只 warn 一次） |
| 目录选择 | 见 §17.2 白名单；`directoryPicker` 只有 `capability()`，**不能发起选择**（Q4） |
| 导入来源 | 目录自身含 `backup.json` → 用它；否则在直接子目录里找匹配 `dsh-brittle-backup-*` 且含 `backup.json` 的候选：1 个直接用，多个列出让用户选，0 个报错并说明期望结构 |
| 本插件自身 entry | 随配置导出（它可能含"上次导出目录"这类本机路径）；导入时按同 id 冲突（§7-#12）**默认保留目标机当前值** |
| `absent[]` | 只在报告中展示，**永不触发删除** |
| 勾选通道 `selection`（2026-10-03 定稿） | `{ overrides: { [planId]: boolean }, overwriteSkills: [name], overwritePlugins: [name], ackBuildScripts: boolean }`。`overrides` 是**三态**：键缺省 = 听计划默认值（UI 复选框直接回显计划里的 `selected`），显式 `true` / `false` = 用户改过。**必须有 `overrides`**：单靠"取消勾选"一个通道无法实现 §7-#12 的"默认保留目标机、勾选才覆盖"—— 默认关闭的项需要一条能把它重新打开的路 |
| 拦截级检查的落地 | §7 里 `level: "block"` 的**条目级**结论（路径安全 / peer 不兼容 / entry id 撞车）必须真的拦住写入：`runChecks` 输出的 `blockedItems[].target = { kind, ref }` 由 `buildPlan` 消费，命中的计划项降级为 `manual` + `selected: false`，`writeTargets()` 自然不再带上它（条目仍留在计划表里，让用户看到"为什么只能手工"）。只有 `scope: "global"` 的拦截才整体拒绝执行 |
| skills 扫描回退 | `skills` 服务缺失 → 直接扫 `<DSH_HOME>\skills`（user 级） |
| 导出重名 | 目标目录已存在（同秒）→ 派生 `-2`、`-3` 后缀 |
| spec → 来源类型 | `link:`/`file:` → local-path（绝对路径标 `unportable`）、`github:`/`git+*`/`http(s):` → github、`npm:` → registry、其余协议 → unknown，**裸 semver / 范围（`^1.66.7`）→ registry** |
| 安装命令 | registry 用解析到的精确版本（`dsh plugin add <name>@<version>`），拿不到版本时 `dsh plugin add <name>`；其他来源原样用 spec |
| 自查扫描假阳性 | `long-hex` / `long-base64` 在哈希状指针（`commit` / `*Version` / `createdAt` / `hostname` / `node` / `platform` / `arch`）上跳过，纯 hex 不按 base64 判 |

### 17.6 阶段一里程碑

见 §12 的 **M0–M5**（骨架 → 采集与产物 → 导入 → 兜底文档 → UI → 验收）；M6 / M7 为阶段二。

### 17.7 待实测确认（结论随实现回填）

| # | 事项 | 状态 / 影响 |
|---|---|---|
| Q4 | `directoryPicker.capability()` 是否提供发起选择的能力 | **仍未实测**。代码已两条路都实现：宿主 `directoryPickerController.pick()` 优先，客户端选择器走 `POST /pick { path }` 一次性登记 |
| Q5 | `configEditor.entries()` 返回条目 → patch 目标 id 的映射 | **已确认**：宿主 Config 目录显示条目同时有 loader id（`include:llm-pi-ai`）与 `patchId`（`llm-pi-ai`）；实现用 `entry.patchId ?? entry.id` 并剥掉 `include:` 前缀 |
| Q6 | `connection.requestRejection` / `admit` / `authorizeIndex` 是否覆盖 [SECURITY.md](SECURITY.md) §4 的第 1–3 条 | **仍未实测**。当前是自研硬化（loopback / 转发头 / 同源），已有自动化断言；确认后可考虑复用官方闸门 |
| Q7 | `fs.writeText` 是否自动创建父目录 | **已绕开**：需要建目录的地方一律用受限 `node:fs` 显式 `mkdir`，不依赖 `fs` 服务的隐式行为 |

### 17.8 实现进度与验证证据（2026-10-02）

| 项 | 状态 | 证据 |
|---|---|---|
| M0 骨架 | ✅ | `src/index.js` 导出 `name` + `apply`，只挂路由；无任何服务时不抛错（`test/index.test.js`）；`npm run check` 断言仓库无网络代码、不读写 `.credentials.yaml` |
| M1 采集与产物 | ✅ | `src/collect/*` + `src/artifact.js` + `src/doc.js` + `src/export.js`；`test/collect.test.js`、`test/artifact.test.js`、`test/doc.test.js` |
| 产物零密钥（S2） | ✅ | 端到端用例断言 `backup.json` 与兜底文档都不含内联密钥，且 `items.redactions[]` 与实际剥离项一致（`test/roundtrip.test.js`） |
| M2 导入还原 | ✅ | `src/restore/*`；14 项检查逐项断言（`test/checks.test.js`）、计划与默认勾选规则（`test/plan.test.js`）、端到端导入（`test/roundtrip.test.js`） |
| 回滚（S6） | ✅ | 取消导入 → 断言回滚删除本次新建的 skill 目录、`cordis.patch.yml` 回到操作前；agent 忙碌 → 断言拒绝写入且不建快照 |
| 路由硬化 | ✅ | `test/routes.test.js`：非 loopback / 转发头 / 跨源 / 缺 Origin / 方法不符 / 白名单一次性，全部有断言 |
| 降级分支 | ✅ | `configEditor`/`settings` 不可用 → 条目不采集但其余照常；`pluginManager` 不可用 → 只记录清单（`test/collect.test.js`）；`agents` 缺失 → fail-open（`test/checks.test.js`） |
| skills 二进制 | ✅ | 含子目录与二进制内容的 skill 逐字节往返（`test/roundtrip.test.js`） |
| M3 兜底文档定稿 | ✅ | `src/doc.js`（"本次包含什么" + 可粘贴片段 + 默认模型回落）；`scripts/doc-audit.mjs` 对真实产物逐项审计；`test/doc-audit.test.js` 正反两个用例（删掉一个 provider 后审计必须以 1 退出） |
| M4 设置页 UI | ✅ | `client/client.js`（手写零构建 bundle）+ `package.json` 的 `dsh.client` / `exports["./client"]`；`test/client.test.js` 用假 `__ModuleLoader__` + 假 react 断言装载形状、注册参数（id/order/label）、三个面板内容、无 picker 时的降级、只调用已实现的路由 |
| 端到端（走本机路由） | ✅ | `test/e2e-routes.test.js`：完全按浏览器路径跑 登记落点 → 导出 → 轮询状态 → 登记来源 → 只读预览（14 项检查 + 计划）→ 导入 → 报告里含 `redactedSkipped` 与快照；以及 agent 忙碌时 `CHECKS_BLOCKED` 且不建快照 |
| 完整性检查 | ✅ | `test/integrity.test.js`：`src/` 无孤儿模块、不引用 test/scripts、`client/` 不相对引用宿主半、`package.json` 引用路径都存在且被 `files` 覆盖、README 链接的 docs 都存在、文档状态与仓库一致 |
| **尚未验证** | ⏳ | ① **真实 DSH 里的加载、设置页显示、卸载无残留**（需要你在 DSH 里装一次）；② 人工盲测（脚本已覆盖可自动化的部分） |

运行方式：`npm run verify`（= `scripts/selfcheck.mjs` + `node --test`，当前 56 个 JS 文件、147 个断言全绿，且自检里含"打包 / 装载契约"断言）；`npm pack --dry-run` 已确认发布产物含 `src/`、`client/`、`cordis.patch.yml`。审计某份产物：`node scripts/doc-audit.mjs <产物目录>`。

---

## 附录 A：给实现者的最短路径建议

1. 先做 **M1 + M3**（采集、剥离、兜底文档、本地导出）——即使不做任何网络与恢复，这份文档本身就已经解决了用户"兼容性全炸"的痛点，价值密度最高、风险最低。
2. 再做 **M2**（恢复），优先把 §7-#1/#2/#6/#13 四条"拦截"级检查做实。
3. 🔜 **传输层属阶段二**（先 WebDAV，后 GitHub），本期不做；本期把 §17 的实现契约与 §4.2 的降级分支做扎实。
4. UI 是**首版范围内的交付**（§0 的 U1 / U3），不是"最后再加"：一个顶层独立设置页承载导出、导入（预览 / 勾选 / 进度 / 取消）与降级提示。演练可先用 host 路由手动触发，但发版必须带 UI（M4）。
