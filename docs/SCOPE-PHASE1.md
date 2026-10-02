# 阶段一范围：本地导出与导入还原

> **本文是阶段一（本期）的权威范围。** 产品边界的完整集合见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §0；本期对 `U*` 条目的撤销 / 收窄 / 新增以本文 §3 为准。产物格式见 [FORMAT.md](FORMAT.md)，安全策略见 [SECURITY.md](SECURITY.md)，**实现契约（服务精确签名 / 路由 / 客户端半 / 回滚策略 / 里程碑 / 待确认项）见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §17**。
>
> 定位：**核心就是导出备份、导入还原备份。** 不做任何网络传输，界面与文档仅中文。
>
> **2026-10-02 第二次修订**：补齐实现契约空白 —— 新增 U34（受限 `node:fs`）、U35（导入可取消）、U36（产物补 `enabled` 与 `hostname`，账号名不采集）、U37（安装类写入由 `pluginManager` 独占）；修正服务名与服务口径；把"UI 闭环""路由硬化""取消 = 回滚""skills 二进制/目录树"写成可验收条目。改动明细见 §7。

---

## 1. 一句话范围

把 DSH 的**配置、插件清单、模型配置、skills** 导出成**一个目录**；再从该目录**导入还原**。导入前必须做兼容性验证，导出必须提供内容勾选。

---

## 2. 本期做什么

### 2.1 导出

- **形态**：一个目录（U30）
- **落点**：用户自选目录（U31）；文件完全由用户管理，插件**不维护导出历史**
- **重名**：目标位置已存在同秒目录（`dsh-brittle-backup-<ts>`）时，追加 `-2`、`-3` 后缀，**绝不覆盖**用户既有数据
- **内容勾选**（导出可选项，逐项可关）：

| 勾选项 | 内容 | 默认 |
|---|---|---|
| profile 配置 | `cordis.patch.yml` 结构化条目、`package.json`、`pnpm-workspace.yaml` 原文 | 开 |
| 插件清单 | name / spec / 实际版本 / 来源 / commit / **是否启用** / 用途 / `unportable` 标记 | 开 |
| 模型配置 | provider（key / displayName / api / baseURL / apiKeyEnv）+ models[] + 默认模型 | 开 |
| skills 清单 | 名称 / 描述 / 路径 / scope / 文件数 | 开 |
| skills 文件 | 把 `<DSH_HOME>\skills` 下 user 级 skill **原样复制**到导出目录的 `skills/`（含子目录与二进制文件） | **关**（用户显式勾选） |
| 兜底文档 | 自包含、可单独分享的 Markdown | 开 |

- 密钥永不进入产物（见 [SECURITY.md](SECURITY.md)）。
- 导出前做一次密钥自查扫描；命中即拦截并提示。
- 写盘用**受限 `node:fs`**（§4.6）：宿主 `fs` 服务没有删除 / 建目录 / 二进制写原语，无法完成目录树复制与原子落盘。

### 2.2 导入

流程顺序固定：

```
① 选目录（或选其中的 backup.json）
② 严格校验：format / version / 路径安全 / 条目数
③ 兼容性验证：§7 全 14 项，逐项给出 可自动恢复 / 有风险 / 只能手工
④ 环境差异对照：DSH 版本、缺失插件、缺失 key（U14）
⑤ diff 预览 + 逐项勾选
⑥ 写前快照 → 合并写入（配置按条目 id 合并、插件逐项安装）
⑦ 报告：成功 / 失败 / 需手工 / 需补 key
⑧ 失败回滚到快照；回滚不完整必须显式列出残留
```

- **来源选择规则**（补齐）：所选目录**自身**含 `backup.json` → 直接用它；否则在其**直接子目录**中找匹配 `dsh-brittle-backup-*` 且含 `backup.json` 的目录：只有一个 → 直接用；有多个 → 列表让用户选；一个都没有 → 报错并说明期望的结构。
- **①–⑤ 对用户数据只读**：目录形态预览不写文件；zip 形态只把压缩包解压到插件自己的 `dsh-brittle-backup\extracted\` 缓存，不改 profile / skills / 用户落点；真正写入只发生在 ⑥。
- **合并语义**：备份里没有的条目一律不删；`absent[]` 不是删除指令。
- **有 agent 在运行时拒绝写入**（U21）。判定口径（补齐）：`ctx.get('agents')` 可用时，`list()` 中存在 `agent.status === 'running'` 即视为忙碌；服务缺失或状态未知时 **fail-open**（只记一次 warn，不阻断）。
- 装插件期间**关闭设置页不中断**（U25 保留部分）：任务状态在宿主侧，重开设置页可见进度与结果。
- **可取消**（U35，保留 §0 的 D6）：导入过程中提供「取消」；语义 = **停止剩余项 + 回滚已写入项**（能回滚的回滚，不能回滚的显式列出残留）。导出是本地快速操作，**不提供取消**。

### 2.3 本期不做

不做远端：WebDAV、GitHub（Gist 与私有仓库 Contents API）、上传与下载、多目标、每目标凭据、远端历史与保留、远端删除及其安全约束。

不做：一键重启、界面双语与文档多语言、定时 / 自动备份、增量与云同步、多用户共享、产物加密、备份会话历史 / storages / attachments / 登录态 / `node_modules`。

日常只做中文；产物目录默认打包为同名 zip（可在导出页取消压缩保留目录），导入支持两种形态。zip 只是运输层封装，不改变 `backup.json` schema。

---

## 3. 对 §0 的修订（撤销 / 收窄 / 新增）

| 状态 | 条目 | 原因 |
|---|---|---|
| 撤销 / 后置 | U6、U22、`D1` | 本期只做中文 |
| 撤销 / 后置 | U7、U8 | 一键重启依赖一套无先例、平台敏感的自重启子系统；待阶段二 |
| 撤销 / 后置 | U9、U15 | 本地模式下不存在需要录入的远端凭据 |
| 撤销 / 后置 | U12、U16（多目标语义） | 本地模式下没有"目标" |
| 撤销 / 后置 | U23、`D2`、`D3` | 导出文件写在用户自选目录，由用户自行管理 |
| 撤销 / 后置 | U25（导出后台跑部分） | 导出是本地快速操作 |
| 撤销 / 后置 | U26–U29 | 依赖远端后端 |
| 收窄 | U10 | 恢复入口只剩"本地目录" |
| 收窄 | U16 | 一份产物导出到用户自选目录 |
| 收窄 | U17 | skills 从独立 zip 附件改为 `skills/` 子目录；整体产物可再封装为同名 zip |
| **收窄** | **U20** | **"JSON 含主机名 / 账号名"收窄为：含 `hostname`，账号名本期不采集**（取账号名需账号服务，且与"不碰登录态"边界冲突）。产物**不含密码 / Token**不变 |
| **保留** | **`D6`** | 上表"撤销 U25"仅限"导出后台跑"部分；`D6`（必须提供取消，取消恢复 = 回滚到操作前）**本期保留**，落为 U35 |
| 新增 | U30 / U31 / U32 / U33 | 见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §0.0 |
| **新增** | **U34** | **受限 `node:fs` 例外**：快照目录、用户选定导出目录、`<DSH_HOME>\skills` 三处允许直接用 `node:fs`（理由与边界见 §4.6）。仍禁止深路径 import DSH 内部模块 |
| **新增** | **U35** | **导入可取消**：取消 = 停止剩余项 + 回滚已写入项（导出不提供取消） |
| **新增** | **U36** | **产物补 `enabled`（插件启用状态）与 `producer.hostname`**；`entries[]` 只收录有 override 的 patch 目标条目 |
| **新增** | **U37** | **安装类写入由 `pluginManager` 独占**：`package.json` / `pnpm-lock.yaml` / bundle 启停不自行合并写，只读采集 |
| 保留不变 | U1–U5、U11、U13、U14、U18–U21、U24 | |

---

## 4. 技术取舍与后果

### 4.1 配置读写走官方服务（U32）

| 文件 | 读取方式 | 写回方式 | 是否需要 YAML 解析 |
|---|---|---|---|
| `cordis.patch.yml` | `configEditor.configuration()` 的**原始 override**（完整，不受 schema 投影丢字段影响）+ `settings.describe({ redactSecrets: true })` 的**密钥路径图** | `configEditor.edit(entry, change)`，按条目 `id` 合并（筛选规则见 U36 / [FORMAT.md](FORMAT.md) §3） | **否** |
| `package.json` | JSON 解析（Node 内置），**只读采集** | **本插件不写**：安装 / 启停走 `pluginManager`（U37），其失败时会自行还原该文件 | 否 |
| `pnpm-workspace.yaml` | **原文文本**，不做解析 | 原文覆盖写入，且因 `allowBuilds` 是代码执行许可，**必须展示 diff 并要求显式确认** | 否 |

**收益**：零 YAML 解析代码、零相关依赖；抗 DSH 升级；顺带解决"按 id 合并"与"保留行形式"不可兼得的矛盾。

**代价**：丢失配置文件中的注释与行顺序。

### 4.2 降级能力收窄（必须在 UI 明示）

原 §8.3 承诺"服务缺失时降级为行级合并写入"。**该承诺自本期起不成立**：

| 缺失的服务 | 降级行为 |
|---|---|
| `configEditor` 或 `settings` | **不读写 profile 的配置条目**；仍采集 / 展示 `package.json`、`pnpm-workspace.yaml` 与插件清单、模型信息（只读）、skills 与兜底文档，并明确提示"当前 DSH 版本不支持配置的自动还原" |
| `pluginManager` | 只还原配置条目与文档，插件列入"照文档手工安装"清单；**此时 `package.json` 也不写**（安装类写入只有 pluginManager 一条路径，U37） |
| `credentials` | 只输出 `requiredCredentials` 名单，不判断本机是否已配置 |
| 目录选择器（宿主 / 客户端均不可用） | 退化为写入 `<DSH_HOME>\dsh-brittle-backup\exports\<ts>\` 并提示路径（不维护历史列表） |
| 客户端 UI（`webServer` / slots） | 无 UI，仅保留宿主侧能力（本期无命令 / 工具入口，见 U24） |

**口径澄清**：宿主服务的访问契约都是 optional（`ctx.get('x')`，"必需"指**功能必需**，不是加载硬依赖）。`configEditor` / `settings` 只影响**结构化配置条目**；`pnpm-workspace.yaml` 的原文还原属文件操作，不受它们缺失影响（仍要显式确认）。

**任何服务缺失都不得在 loader 阶段抛错。**

### 4.3 零 dsh-market 代码借鉴

原方案被迫借鉴 dsh-market，是因为 WebDAV 与自重启没有别的实现。本期两者都不做，剩余依赖仅为：读文件、结构化配置、生成 JSON / Markdown、写文件、调用官方服务装插件。

**目标：不搬运 dsh-market 的任何代码。** 设计上仍可参考其思路（如快照与回滚、清单合并、agent 忙碌闸门），但那属于思路而非代码，MIT 归属问题随之消失。

### 4.4 上限放宽

原 2 MiB / 256 文件是为 Gist 限额定的。本地目录模式下不再是产品约束，仅保留一个**宽松的防爆上限**（防止异常产物撑爆磁盘），超限时明确报错而不是静默截断。取值见 [FORMAT.md](FORMAT.md) §7。

### 4.5 插件仍需自己的工作目录

导出历史取消了，但插件**仍需要**一个内部工作目录（`<DSH_HOME>\dsh-brittle-backup\`）用于：

- 恢复前的**自动快照**与回滚（这是安全机制，不是"历史列表"）
- 临时文件（原子写入的 temp）

快照沿用"保留最近 N 份、超出剪枝"的策略，但这**不在 UI 里做成历史功能**。

> ⚠️ 快照的**剪枝**与回滚时的**删除新建文件**都需要"删除目录树"能力，宿主 `fs` 服务没有该原语 —— 这是 §4.6 例外存在的直接原因，不是可选项。

### 4.6 文件操作的受限例外（U34）—— 对 [PROJECT-PLAN.md](PROJECT-PLAN.md) §8.4-1 与本节 §5「文件读写只用 `fs` 服务」的显式修订

**实测事实（2026-10-02 宿主服务内省）**：`fs` 服务提供 `resolve` / `stat` / `lstat` / `readText` / `streamText` / `readBytes` / `readByteRange` / `listDir` / `writeText` / `editText` / `watch` / `contains` / `fileUrl` / `processPath`，**没有删除、没有建目录、没有写二进制**；`writeText` 的契约也**未承诺**自动创建父目录。

因此，只靠 `fs` 服务无法完成：skills 目录树复制（子目录 + 二进制）、写前快照、失败回滚（删除本次新建文件 / 还原被覆盖文件）、快照剪枝。

| 允许直接使用 `node:fs` 的范围 | 允许的操作 | 约束 |
|---|---|---|
| `<DSH_HOME>\dsh-brittle-backup\`（快照与临时文件） | 建目录、写、复制、删除、原子 rename | 不写该目录以外的任何东西 |
| 用户**本次显式选择**的导出目录 | 建目录、写、复制、原子 rename、重名改后缀 | 只在该目录内；不删除用户既有文件 |
| `<DSH_HOME>\skills\<name>\`（仅导入且用户勾选了文件） | 建目录、写、复制、删除**本次导入创建的**文件 | 只处理产物中 `scope: "user"` 的 skill；同名按用户选择 覆盖 / 跳过 / 重命名；**绝不删除目标机其它 skill** |

仍然禁止：深路径 import DSH 内部模块；写 `cordis.yml`、`node_modules`、`.credentials.yaml`、`.dsh-market`、`.plugin-manager`；对上述三个范围之外的路径做任何写 / 删。对 `content` 的判断一律先 `path.resolve` + 前缀校验（防 `..` 穿越）。

---

## 5. 本期服务依赖（2026-10-02 内省实测签名）

| 用途 | 依赖 | 实测签名 / 口径 | 缺失时 |
|---|---|---|---|
| 读结构化配置 / 写回 | `configEditor` | `entries()`；`configuration(): Array<{ entry, inherited, override }>`；`edit(entry, change)` | 配置条目不自动还原 |
| 密钥路径图 | `settings.describe({ redactSecrets: true })` | 同步方法；`secrets?: { path: string[]; set: boolean }[]`（**权威脱敏来源，不用于取值**） | 退化为字段名启发式（防线②） |
| 本插件自身设置 | `settings.update / replace / mutate(ns, …, expectedRevision?)` | `ns` = **Profile entry id**（= `brittle-backup`） | 本次不改自身设置，用默认值 |
| 缺 key 提示 | `credentials.describe(ref)` | `Promise<CredentialInfo>`，只读、不含值（U33） | 只输出名单 |
| 插件安装 / 清单 / 启停 | `pluginManager` | `listPlugins()` / `listBundles()` / `installBundle(spec, { enabled, requestId, approvedBuilds, registry })` / `waitForInstall(requestId)` / `cancelInstall(requestId)` / `setBundleEnabled(name, enabled)` / `setPluginEnabled(id, enabled)` / `inspect(spec)` | 降级为手工清单（U37 口径） |
| skill 元数据 | `skills.list(options?)` | `Promise<SkillSummary[]>` | 直接扫 `<DSH_HOME>\skills` 目录 |
| 文件读写 | `fs`（能力不足，见 §4.6） | 见 §4.6 的能力缺口表 | 受限 `node:fs` 例外（U34） |
| agent 忙碌闸门 | `agents.list()` | 判定 `agent.status === 'running'`；服务缺失 / 状态未知 **fail-open** | 不阻断，只记一次 warn |
| 目录选择 | 客户端 `uiWorkspace.pickDirectory()` / 宿主 `directoryPickerController.pick`（Remote） | `directoryPicker` 本身**只有** `capability()`，不能发起选择 | 退化为写内部目录并提示 |
| UI | 宿主 `webServer.register(route)` + 客户端 `settings.section` 槽位 | 槽位注册参数 `{ id, order, label }`；**id 必须自用**（复用已存在 id 会顶掉那一页） | 无 UI |

**不注册任何工具给模型，也不提供聊天命令入口**（U24）。路由与接口契约（路径 / 方法 / 出入参 / 任务状态 / 取消 / 选择器白名单）见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §17.2。

---

## 6. 本期验收

- [ ] 导出目录结构正确：`backup.json` + `兜底文档.md`（+ 勾选时的 `skills/`）；同秒重名时派生 `-2` 后缀且不覆盖旧目录。
- [ ] 勾选项逐项生效：关掉某类内容后产物里确实没有它，且报告如实说明。
- [ ] **产物中零密钥**：正则扫描 + 人工抽查；`redactions[]` 与实际剥离项一致。
- [ ] `entries[]` 只含**有 override 的 patch 目标条目**；bundle 提供的 insert 与默认值没有出现在产物里。
- [ ] 插件清单含 `enabled`，且导入后**禁用状态被还原**（已装被禁用 → 走 `setBundleEnabled` / `setPluginEnabled`，不重装）。
- [ ] **兜底文档自包含**：只看文档即可在新机器完成重配（含插件安装命令与可粘贴的配置片段）；且**不含任何主机名 / 账号 / 配置原文 / 本机路径**。
- [ ] 导入来源规则正确：目录自身含 `backup.json` 直接使用；子目录多份时列出候选；均无时报错。
- [ ] 导入前 14 项兼容性验证逐项有结论，级别（拦截 / 警告 / 信息）正确。
- [ ] **①–⑤ 只读**：预览 / 校验阶段断言没有产生任何写操作。
- [ ] 导出 → 改动 → 导入 → 与原状态一致；且目标机多出的条目**不消失**。
- [ ] 缺 key 提示正确区分"已配置 / 缺失"。
- [ ] 人为制造中途失败 → 断言回滚到操作前；回滚不完整时残留被列出。
- [ ] **取消生效**：导入中途取消 → 停止剩余项 + 回滚已写入项，报告列出无法回滚的残留。
- [ ] 有 agent 运行时发起导入 → 断言被拒绝且不写任何文件；`agents` 服务缺失时断言**不阻断**（fail-open）。
- [ ] **`configEditor` / `settings` 不可用时**：不写配置条目且明确提示，同时 `package.json` / `pnpm-workspace.yaml` 的采集与展示仍正常（验证降级分支）。
- [ ] **skills 目录树**：含子目录与二进制文件（如 png）的 skill 能完整导出并还原，逐字节一致。
- [ ] **UI 闭环**：在一个顶层设置页内完成 选择目录 → 勾选 → 导出 → 选目录 → 预览 diff → 勾选 → 导入 → 看报告 → 取消，全程不开别的面板。
- [ ] **路由硬化**：非 loopback、带 `Forwarded` / `X-Forwarded-For`、`Origin` 与 `Host` 不同源、GET 触发写操作 —— 四类请求均被拒绝。
- [ ] 卸载插件后 profile 无残留（manifest 无条目、`cordis.patch.yml` 无残留 `insert:`）。
- [ ] 全仓库**无网络代码**（无 `node:https` / `undici` / WebDAV / GitHub 调用）。

---

## 7. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-10-02 | 初版：确立阶段一范围（仅本地导出 / 导入、仅中文），撤销 / 后置远端与重启相关条目，新增 U30–U33，记录降级收窄与零借鉴目标 |
| 2026-10-02 | **第二次修订**：新增 U34（受限 `node:fs` 例外，修 §4.6）、U35（导入可取消）、U36（产物补 `enabled` / `hostname`，entries 筛选口径）、U37（安装类写入由 `pluginManager` 独占）；§4.1 修正 `package.json` 写回归属；§4.2 澄清 optional 访问与降级口径；§4.5 记录快照剪枝 / 回滚的删除需求；§5 换成实测签名表并修正目录选择服务名、补 `agents` 闸门口径；§6 扩充 UI / 路由 / 取消 / skills 二进制 / entries 筛选 / 只读预览等验收项 |
