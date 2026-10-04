# 安全策略（SECURITY）

> 本文描述本插件**承诺做的事**与**明确不做的事**。边界依据：[PROJECT-PLAN.md](PROJECT-PLAN.md) 的 §0（唯一权威）与 [FORMAT.md](FORMAT.md)（产物 schema 唯一权威）。
>
> **适用范围：阶段一（仅本地导出 / 导入，见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md)）。** 标有 **🔜 阶段二** 的小节（出站 SSRF、远端删除）本期**不实现**，内容保留以备阶段二，**不作为本期的实现要求**。
>
> 文中标注"实测"的结论来自对 dsh-market `1.66.7` 源码、DSH Desktop `0.2.0-rc.2` 安装目录，以及 **2026-10-02 的宿主服务内省（Service / Slots / Config）** 的只读检查。

---

## 1. 不变量（不变就是不变）

1. **永不读取任何密钥值。** 不打开 `.credentials.yaml`（既不读也不写）。需要知道"有没有配"时只用 `credentials.describe(ref)`，它的返回值不含值（U33）。
2. **永不回显密钥。** 本期没有需要录入的密钥；阶段二引入 WebDAV 密码 / GitHub Token 时，输入框必须为密码型且不可回读，只显示"已配置 / 缺失"。
3. **密钥永不写入任何产物**（`backup.json`、兜底文档、`skills\` 都不含）。
4. **可分享产物不含主机信息。** 兜底文档零密钥、零主机名 / 地址 / 账号名、零配置原文、**零本机路径**（U2 / U5 / U20）。
5. **写操作只发生在三个位置**（U34，完整边界见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §4.6）：① 用户**本次显式选择**的导出目录；② 本插件自己的工作目录 `<DSH_HOME>\dsh-brittle-backup\`（快照与临时文件）；③ 导入 skills 时的 `<DSH_HOME>\skills\<name>\`。除此之外不写任何位置。
6. **本期的"删除"只有两处，且都在自己的地盘内**：① 回滚时删除**本次导入创建**的文件、还原被本次覆盖的文件；② 快照目录按"保留最近 N 份"剪枝。**绝不删除**用户既有 skill、既有导出目录，也没有任何远端删除路径（远端清理属阶段二，约束见 §5）。
7. **有 agent 在运行时拒绝写 profile**（U21）。判定口径：`agents.list()` 中存在 `agent.status === 'running'`；服务缺失或状态未知 **fail-open**（只记一次 warn），不得因闸门自身故障把功能锁死。
8. **取消即回滚**（U35 / `D6`）：导入中途取消 → 停止剩余项 + 回滚已写入项；无法回滚的部分必须显式列出，不得假装干净。
9. **校验与预览不改盘**：format / version、14 项检查、diff 预览期间的任何步骤都不得产生写操作。

---

## 2. 密钥的位置、命名与脱敏

### 2.1 密钥在哪里

| 位置 | 是否读取 | 说明 |
|---|---|---|
| `<DSH_HOME>\.credentials.yaml` | **否** | 凭据服务的落盘形态，含 record 与 ref 两类；本插件不打开它 |
| 配置条目里的 `apiKeyEnv` | 读**名字** | 它是指向 ref 的指针，本身不是密钥（例：`XIUXIAN_API_KEY`） |
| 配置条目里可能内联的 `apiKey` | 读结构、剥离值 | 这是本插件要解决的核心缺口（见 §2.3） |
| 本插件的 WebDAV 密码 / GitHub Token | 🔜 阶段二 | 本期为本地模式，**不需要任何凭据** |

### 2.2 凭据 ref 命名（U15）🔜 阶段二

> 本期没有远端凭据，本节仅备阶段二使用。

单一固定 ref 名**无法**同时保存多个目标的密码，因此按目标派生：

```
DSH_BRITTLE_BACKUP_WEBDAV_PASSWORD__<目标id>
DSH_BRITTLE_BACKUP_GITHUB_TOKEN__<目标id>
```

- DSH 自己的设置界面**不认识**这些 ref 名，所以录入入口只能是本插件 UI（U9）。
- 删除目标时同步 `unset` 其 ref，避免残留孤儿凭据。

### 2.3 脱敏的三道防线

| 防线 | 手段 | 依据 |
|---|---|---|
| ① 权威来源 | `settings.describe({ redactSecrets: true })` 返回的 `secrets?: { path: string[]; set: boolean }[]` —— **宿主自己就知道每个插件 config 里哪些路径是密钥**，用它作为主要依据，而不是猜 | 实测 DSH `settings` 服务契约（同步方法；`RedactedSecret.path` 是**字符串数组**） |
| ② 结构化剥离 | 对 `apiKey` / `token` / `password` / `secret` / `authorization` / `cookie` 等字段名做结构化剥离，并记录到 `redactions[]`（[FORMAT.md](FORMAT.md) §4） | 双保险 |
| ③ 导出前自查 | 正则扫描产物（`sk-`、长 hex / base64 串、`Authorization:`、URL 内嵌 `user:pass`）；**命中即拦截导出**，除非用户显式确认该值可外传 | U20 |

- 剥离必须**幂等**：已剥离的值再次扫描不得报错或重复剥离。
- `apiKeyEnv` **不得**被剥离——它是名字，不是值。
- ⚠️ **`skills\` 目录内的文件不做逐字段脱敏**（原样复制）。因此防线 ③ 是它们**唯一**的防线，必须在复制前逐文件扫描。
  - **实现**（2026-10-03 补齐）：`writeArtifact` 给 `copyTree` 传 `shouldCopy` 闸门，逐文件在 `cp` **之前**扫描；命中即**不写这个文件**，并记进 `skillCopy.withheld` 与任务警告（点名到具体 `skill/相对路径` 与命中的模式）。同一 skill 里的其它干净文件照常导出 —— 宁可少备一个文件，也不让"产物里绝不会出现密钥"在勾了 skills 文件时失效。
  - 二进制按 latin1 解码后扫描：字节一一对应，不会因非法 UTF-8 抛错，也不会把二进制悄悄换成 U+FFFD 让密钥特征消失。**读不出来的文件一律不导出**（没看过的文件不能进产物）。
- **防假阳性规则（实现约定）**：`long-hex` / `long-base64` 两个模式在"哈希状指针"（`/commit`、`/dshVersion`、`/pluginVersion`、`/createdAt`、`/hostname`、`/node`、`/platform`、`/arch`、`/resolvedVersion`）上跳过；纯十六进制串也不按 base64 判定。否则每个含 git commit 的产物都会被自己拦下。
- **剥离值不往返**：产物里的 `<REDACTED>` 是占位符，导入侧**绝不把它写回配置**，只在报告里列出被跳过的位置（见 §6）。

### 2.4 本插件自身的 entry 与设置

**实现决策（2026-10-02，与早期草案不同）**：本插件**不把自己写进 profile 的 `cordis.patch.yml`**。

- 自身设置（上次导出 / 导入目录、勾选项偏好、快照保留数）落在 `<DSH_HOME>\dsh-brittle-backup\settings.json`，由插件自己读写。
- 理由：① 宿主 0.2 代的 settings 命名空间由插件 **Config schema** 派生，为一个"上次导出目录"去静态 import `@deepseek-ai/schemastery`，代价是"依赖缺失 = 宿主起不来"，与 §1 的"loader 零副作用"冲突；② 导出目录是本机路径，写进 profile 配置就会被自己的备份带走。
- 因此产物里的 `brittle-backup` 条目**不存在**；导入侧对它也就没有"同 id 条目冲突"要处理。
- 若将来要把它做进 profile 配置（例如希望随备份一起迁移偏好），必须先解决上面两条理由，并在 [PROJECT-PLAN.md](PROJECT-PLAN.md) §17.1 记录。

---

## 3. 出站：WebDAV / GitHub 的 SSRF 策略（U4 / 双模式）🔜 阶段二

> **本期不实现** —— 阶段一不含任何网络代码。本节保留以备阶段二；其判定细节是**实测得来**，届时不得简化。

### 3.1 两种模式（按目标独立，D7）

| 模式 | 放行 | 仍然拒绝 | 默认 |
|---|---|---|---|
| **硬化（默认）** | `https:`，且 hostname 解析出的**全部**地址都是公网 IP | 非 https、URL 内嵌 `user:pass`、RFC1918、CGNAT、link-local、`localhost` / `.local` / `.internal` / `.localhost`、DNS 失败 | 每个目标默认开启 |
| **私有目标（显式开关）** | 额外放行 RFC1918、**CGNAT `100.64.0.0/10`（Tailscale）**、IPv6 ULA、`.local` / `.internal` / `localhost`，并允许 `http:`（明文，给出显著警告） | `169.254.0.0/16`（链路本地 / 云 metadata）、`metadata.google.internal`；**任何模式下都拒绝 URL 内嵌用户密码** | 默认关，按目标分别保存 |

### 3.2 判定细节（参考实现实测）

- **先解析、校验、再连到该 IP**（不在校验后二次解析），以关闭 DNS rebinding 窗口；同时设置 `servername` 保证 TLS SNI 与证书校验正确。
- 域名有**多条 A 记录**时，**任意一条**非公网即拒绝（防"一条公网骗过检查、另一条连内网"）。
- IPv4 拒绝集：`0/8`、`10/8`、`127/8`、`100.64–127`（CGNAT / Tailscale）、`169.254/16`、`172.16–31`、`192.0/16`、`192.168/16`、`198.18–19`、`>=224`（组播 / 保留）。
- IPv6 **只**放行全球单播 `2000::/3`。
- 主机名拒绝集：`localhost`、`metadata.google.internal`、`*.localhost`、`*.internal`、`*.local`（尾随点先归一化）。
- 重定向：仅 `GET` 跟随，上限 5 跳；**跨源跳转不携带 Basic 凭据**。

---

## 4. 入站：本插件注册的本机 HTTP 路由

本机路由是与客户端 UI 通信的通道，必须按"这是可从浏览器触发的攻击面"对待（接口清单见 [PROJECT-PLAN.md](PROJECT-PLAN.md) §17.2）：

1. **只接受 loopback 直连**：对端地址必须是 `127.0.0.1` / `::1` / `::ffff:127.0.0.1`。
2. **拒绝一切转发头**：出现 `Forwarded`、`X-Forwarded-For`、`X-Real-IP` 即拒绝（防代理绕过）。
3. **同源校验（2026-10-02 修订）**：`Origin` **存在**时必须与 `Host` 一致，且 `Host` 必须满足 loopback 防 rebinding 规则；`Origin: null`（file:// / 沙箱 iframe 的不透明来源）一律拒绝。
   **`Origin` 缺失时放行**，但要求请求带 JSON 的 `content-type` 或 `accept`（我们自己的页面永远带）。
   理由：真正的 CSRF 防护是"带 Origin 时必须同源"—— 浏览器对跨源 POST 一定会带 Origin；而同一个页面在被宿主 fetch 包装 / Electron 环境下**可能不带 Origin**，硬要求"必须带"只会把用户自己挡在外面（实测就是这样被 403「缺少 Origin」挡住的）。缺 Origin 的分支只对"非浏览器来源"开放，而那种来源本来就有本机权限。
   命中这条放行时会往宿主日志写**一次** info，便于排查。
4. **GET 一律无副作用**：导出、导入、装插件等动作**只能**由 POST 触发；`GET` 只用于读任务状态。
5. **导出落点 / 导入来源只来自用户显式选择**。实现口径（补齐）：
   - 宿主侧优先：`POST /brittle-backup/pick` 由宿主自己发起选择（`directoryPickerController.pick()`），返回的路径**直接进白名单**；
   - 客户端选择器兜底：页面用 `uiWorkspace.pickDirectory()` 选完，再 `POST /pick { path }` **登记一次**；宿主只接受"存在的绝对目录路径"，登记后**一次性**生效；
   - `/export` 与 `/inspect` / `/import` / `/query` 的 `targetDir` / `sourceDir` 必须命中白名单并**用掉即失效**，否则 `403 PICKER_NOT_ALLOWED`；页面自由构造的路径一律拒绝。白名单允许存在的目录或 `.zip` 文件。
6. **任务状态端点只读**：进度 / 结果查询不得有副作用，也不得回显产物中的敏感字段。
7. **打开目录单独硬化**：`POST /brittle-backup/open` 只接受存在的绝对目录，仍受 loopback、转发头与同源校验保护；它只调用系统文件管理器，不读取目录内容、不经过 shell、不修改文件。
8. **配置查询只读且脱敏**：`POST /brittle-backup/query` 只读取②导入来源中的 `backup.json`（目录或 zip 自动定位），来源必须先通过 `/pick` 白名单；输出过滤 API Key、Token、密码、主机名和本机绝对路径。详细模式只展示脱敏结构与配置名，不展示秘密值。
9. **同一时刻只允许一个任务**：并发写请求返回 `409 BUSY`（防止两次导入互相踩）。

> 📌 **待确认（实现前实测一次）**：宿主已有官方信任闸门 `connection.requestRejection(request)` / `admit(request)` / `authorizeIndex(...)`。若其覆盖面与本节 1–3 一致，**优先复用它并删除自研重复逻辑**；否则保留本节自研实现，并在 §17.7 记录结论。

---

## 5. 远端删除的安全约束（U29）🔜 阶段二

> **本期不实现。** 一旦阶段二重新引入远端清理，本节约束是**最低要求**，不得简化。

远端清理是本项目**唯一会销毁用户远端数据**的路径，因此：

- 删除目标**只能来自远端枚举结果**（WebDAV `PROPFIND` / Contents API list），**绝不由备份文件的内容构造**——备份文件是可被篡改的跨机器输入，若删除路径接受其中的路径，一个构造过的备份即可诱导删除远端任意文件。
- 只删**本插件自己按命名规则生成**的版本文件：文件名必须匹配本插件的模式（`dsh-brittle-backup-<ts>.*`），且必须位于该目标配置的目录前缀之内。
- 校验顺序：枚举 → 过滤出"匹配自身命名模式"的候选 → 按时间戳排序 → 保留最近 N 个 → 其余才进入删除集。
- `N` 下限为 1；`N` 非正整数一律视为无效配置并拒绝执行清理。
- **删除失败不阻断备份成功**，只在结果中报告。
- 所有 `DELETE` 与上传走**同一套** SSRF 硬化与超时 / 体积上限。
- UI 必须在启用该功能时明确提示"这会删除远端旧文件"。

---

## 6. 导入侧：写入路径安全

- 逐条校验产物中的 `path`：相对路径、无 `..`、未命中排除名单、无重复。
- 目标已存在但不是普通文件（目录 / 符号链接）→ **拒绝该项**，不越权删除。
- **合并用深度合并**：产物里有的键覆盖目标，**产物里没有的键一个都不动**。所以"产物里被剥离的 `apiKey`"不会顺手抹掉目标机原有的值，也不会用 `<REDACTED>` 占位符去覆盖真值 —— 被剥离的位置只进报告（`redactedSkipped`），由用户自己补。
- 写入用 temp + rename 原子替换；写前快照，失败回滚；回滚不完整必须显式列出残留（U21）。
- **写入原语的现实约束（U34）**：宿主 `fs` 服务没有删除 / 建目录 / 二进制写原语，**回滚（删除本次新建文件、还原被覆盖文件）与快照剪枝无法只靠它完成**。因此本插件在三个受限范围内直接使用 `node:fs`（边界见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §4.6）；每次写 / 删前先做 `path.resolve` + 前缀校验，防 `..` 穿越。
- **取消语义**：取消 = 停止剩余项 + 回滚已写入项；`pluginManager.cancelInstall(requestId)` 用于正在进行的安装，返回 `cancelled` / `too-late` / `not-running`，`too-late` 时必须说明"该项已进入应用阶段，可能无法回滚"。
- **不写入**：`cordis.yml`、`node_modules`、`.credentials.yaml`、`.dsh-market`、`.plugin-manager`。
- **skills 只允许写入 `<DSH_HOME>\skills\<name>\`**：只处理产物里 `scope: "user"` 的 skill；同名时由用户选择 覆盖 / 跳过 / 重命名，**绝不删除目标机已有的其他 skill**。
  - ⚠️ `<name>` 必须是**单个安全目录名**（`checkNameSegment`：非空、不含 `/` `\` `:`、不为 `.` / `..`、无控制字符、不以 `.` 结尾、不含 Windows 保留字符）。产物校验与写入层**各挡一次**：校验层把越界名字判为 `errors`（整份产物不通过），写入层再 `assertWithin(skillsRoot, …)` 兜底。
  - 原因：写入前有一句 `removeTree(destination)`。名字若能越出 `skillsRoot`（例如 `..`），这一句就会**递归删掉整个 `<DSH_HOME>`**（profile 配置与全部 skills 一起没），且不回滚。**删除动作不允许只依赖上游校验。**
- 合并语义：备份里没有的条目一律不删；`absent[]` 不是删除指令。

---

## 7. 日志与 UI 泄露防护

- 密码 / Token 从不出现在日志、错误消息、报告或 UI 中（本期本就没有）。
- 凭据状态只暴露"已配置 / 缺失"两种取值（U33）。
- 导出目录路径等**本机路径只出现在 UI 与本地报告中**，绝不写入兜底文档（U5）。
- `producer.hostname` 只进 `backup.json`（本机信息，不可单独分享），**不进兜底文档**。

---

## 8. 依赖供应链

- 导入安装插件时优先使用备份里记录的**精确版本** spec。
- 对 `github:` / `https:` 来源的 git spec，记录并展示 commit 供人工核对。
- **安装类写入的归属（U37）**：`package.json`、`pnpm-lock.yaml` 与 bundle 启停**只由 `pluginManager`** 写入（`installBundle` / `setBundleEnabled` / `setPluginEnabled`），本插件**不自行合并写**这些文件——参考实现表明 `installBundle` 在失败 / 取消时会自行还原这两个文件，双写会互相破坏。本插件对它们是**只读采集**。
- `pnpm-workspace.yaml` 的 `allowBuilds` 是**代码执行许可**：还原它等于重新授权安装脚本运行，必须作为需要显式确认的项展示 diff，不静默应用。
- `link:` / `file:` 绝对路径依赖标记 `unportable`，**不自动安装**（[PROJECT-PLAN.md](PROJECT-PLAN.md) §7-#5）。
- **不引入原生扩展**：Windows 上无法卸载已加载的 `.node`，会让"卸载 → 重装"变成 EPERM 死锁。

---

## 9. 明确不做（已知边界，不是遗漏）

| 项 | 状态 | 说明 |
|---|---|---|
| 产物加密 | 不做 | 产物里没有密码 / Token；但**含主机名（`producer.hostname`）与模型结构**，因此 JSON 仍需按"可能含你本机信息"对待（文档不含） |
| 账号名采集 | 不做 | U20 原写"主机名 / 账号名"，现收窄为**只记主机名**：取账号名需要账号服务，且与"不碰登录态"边界冲突（见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §3） |
| 备份会话历史 / storages / attachments / 登录态 | 不做 | 见 §0 的 U19 |
| 定时 / 自动备份 | 不做 | 见 U18 |
| 多用户 / 团队共享 | 不做 | 见 U18 |
| `skills\` 内文件的逐字段脱敏 | 不做 | 原样复制；唯一防线是导出前的整体密钥自查（防线 ③） |
| 远端传输 / 远端历史 / 远端清理 | 🔜 阶段二 | 本期不含任何网络代码 |
| 一键重启 | 🔜 阶段二 | 本期导入完成后只提示"需要重启 DSH 生效" |
| 界面与文档多语言 | 🔜 阶段二 | 本期仅中文 |

---

## 10. 安全相关参考实现索引（本机）

| 主题 | 位置 |
|---|---|
| 密钥文件名启发式与目录级排除 | `…\dshmarket\lib\backup.js`（`SECRET_FILE_HINTS` / `SKIP_NAMES`）—— 本期仅作**思路参考**，不搬运代码 |
| 凭据契约（知道哪些字段是密钥） | DSH `settings` 服务（`describe({ redactSecrets: true })` → `secrets[].path`，**字符串数组**）—— **本期脱敏的唯一依据** |
| agent 忙碌闸门 | `…\dshmarket\lib\agents.js`（`runningAgentIds`：只把 `status === 'running'` 当忙碌，未知状态 fail-open）—— 本期**思路参考** |
| 快照 / 回滚 / 原子写思路 | `…\dshmarket\lib\snapshot.js` —— 本期**思路参考**，实现用自己的受限 `node:fs` 路径 |
| WebDAV SSRF 判定（`isPublicIpv4` / `isPublicIpv6` / `isPublicHostname` / `resolvePublicAddress`） | 🔜 阶段二：`…\dshmarket\lib\backup.js`（`isPublicIpv4` 的 CGNAT 分支写作八位组数学，字面 grep `100.64` 查不到） |
| MKCOL 建父目录、重定向与凭据不跨源 | 🔜 阶段二：`…\dshmarket\lib\backup.js`（`webdavParentCollections`） |
| 同源 loopback 校验、重启安全模型与平台探测 | 🔜 阶段二：`…\dshmarket\lib\restart.js`（`trustedRestartRequest` / `trustedDownloadRequest` / `loopbackAuthority` / `restartAllowed` / `detectedSupervisor`） |

> dsh-market 为 **MIT** 许可。**阶段一的目标是不搬运其任何代码**（见 [SCOPE-PHASE1.md](SCOPE-PHASE1.md) §4.3）；将来若借鉴，需在本仓库 README 中注明来源与许可。

---

## 11. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-10-01 | 初版：确立不变量、三道脱敏防线、SSRF 双模式、入站路由硬化、远端删除约束（U29）、恢复侧路径安全与"明确不做"清单 |
| 2026-10-02 | **随阶段一调整**：出站 SSRF、远端删除、重启端点标注为阶段二；防线 ③ 由"上传前"改为"导出前"，并明确它是 `skills\` 内文件的唯一防线；入站新增"导出落点只来自用户显式选择"；新增 skills 目录写入约束；明确本期不含任何网络代码、且以不搬运参考实现代码为目标 |
| 2026-10-02 | **第二次修订（口径收口）**：§1 第 5/6 条改为"三个可写位置 + 两处自有删除"（U34），新增第 8/9 条（取消即回滚、预览不改盘）；§2.3 补 `RedactedSecret.path` 为字符串数组；§2.4 补自身 entry 导入按同 id 冲突默认保留目标机；§4 第 5 条改为"选择器返回值白名单"并新增第 6 条（状态端点只读）与官方 `connection` 信任闸门待确认项；§6 补 `fs` 能力缺口、`node:fs` 受限例外、`cancelInstall` 语义；§7 补 `hostname` 只进 JSON；§8 新增 U37（安装类写入归属）；§9 把"账号名"列为不采集 |
| 2026-10-02 | **第三次修订（真实环境修复）**：§4 第 3 条由"必须带 Origin"改为"**带 Origin 时必须同源，缺失时要求 JSON 的 content-type / accept**" —— 实测宿主环境里同源 POST 不带 `Origin`，原规则会把用户自己的请求 403 掉；`Origin: null` 仍然拒绝，命中放行分支时写一次 info 日志 |
| 2026-10-03 | **第四次修订（补齐已写下但未实现的控制）**：① §6 补 `skills[].name` 的单段名校验（校验层 + 写入层 `assertWithin` 双挡）—— 名字若为 `..`，原先的 `removeTree` 会删掉整个 `<DSH_HOME>`；② §2.3 的"`skills\` 文件复制前逐文件扫描"从**承诺**变成**实现**（命中则不写该文件并点名报告）；③ §2.3 补 `*Key` 类字段名（`secretKey` / `signingKey` / `AWS_SECRET_ACCESS_KEY` 等）的脱敏口径，并说明 `public` 开头的公钥名是有意放行；④ §2.3 补 `inherited`（bundle 层继承值）与 `override` 一样走脱敏；⑤ 兜底文档中的本机绝对路径改为占位符（U20），`spec` / `installCommand` 只掩路径、保留包名 |
