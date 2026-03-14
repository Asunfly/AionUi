# 删除回收与云端备份功能规范对齐 Review

## 1. 目标说明

本文档用于整理 AionUi 当前“删除回收机制”和“云端备份/恢复机制”的规范对齐情况、功能流程、异常处理分支、测试建议和 PR 素材，供后续：

- 编写测试 case
- 拆分自动化测试任务
- 补充实现或修正规范缺口
- 准备 PR 的 `## Summary` 与 `## Test plan`

本文档不是对外用户文档，而是面向内部开发、review 与测试协作的工作底稿。

---

## 2. 规范来源与适用约束

### 2.1 `AGENTS.md`

本次两个功能直接相关的硬约束：

- 所有用户可见文案必须走 i18n key，不能在组件中硬编码文案
- 新功能或逻辑变更需要配套测试
- 新增源文件加入 `vitest.config.ts -> coverage.include`
- E2E 测试目录为 `tests/e2e/`，框架为 Playwright
- Renderer 仅通过 bridge 与主进程交互

本次功能的对应情况：

- 删除回收与云备份都通过 `ipcBridge` 调用主进程逻辑，架构方向正确
- 备份恢复与删除提醒的绝大部分用户文案已接入 i18n
- 单测已经有基础覆盖，但 coverage.include 与 E2E 仍需继续完善

### 2.2 `.aionui/FEATURE_DEV_TEMPLATE.md`

模板要求功能文档至少覆盖：

- 用户场景
- 功能验收
- 边界情况
- 兼容性
- 国际化
- IPC 分层约束

本文档按该模板精神落地为：

- 主操作流程
- 异常/边界流程
- 测试建议
- review 结论

### 2.3 `.claude/skills/i18n/SKILL.md`

本次相关要求：

- 新增 i18n key 使用 flat dot-notation
- 新增文案需要同步所有 locale
- JSX 中不得出现硬编码用户可见文本
- 需要关注 zh-TW、ja-JP、ko-KR 等 locale 是否同步完成

### 2.4 `.claude/commands/pr-review.md`

本次 review 重点应覆盖：

- 正确性
- 错误处理
- 不可变性
- 测试缺口
- `coverage.include` 是否遗漏

### 2.5 `.claude/commands/oss-pr.md`

PR 文案应包含：

- `## Summary`
- `## Test plan`

因此本文档最后附带可直接复用的 PR 底稿。

---

## 3. 总体 Review 结论

### 3.1 已符合的重点

#### 删除回收机制

- 删除会话逻辑已通过 `conversationBridge -> deleteConversationData -> TrashService` 分层，符合 bridge/service 架构约束
- 删除默认临时工区时，会先判断是否仍被其他 conversation 或 session 引用，再决定是否删除工区，避免误删共享资源
- 文件树中的文件/目录删除统一通过 `fsBridge.removeEntry`，并复用垃圾桶能力
- `TrashService` 已提供 system trash 优先、app `.trash` 兜底的降级逻辑
- 删除回收核心逻辑已有基础单测覆盖：
  - `deleteConversationData.test.ts`
  - `trashService.test.ts`
  - `fsBridgeRemoveEntry.test.ts`

#### 云端备份与恢复机制

- 备份与恢复由主进程 `BackupService` 统一处理，UI 只负责触发、展示状态和确认动作，职责边界清晰
- 备份 manifest、managed entries、默认工区相对路径恢复、工作区路径重写等关键链路已落地
- 恢复前会准备 pending restore recovery 状态，恢复后需要重启，再通过下次启动校验确认恢复结果，具备“恢复失败自动回滚”保护
- 正式环境重启链路明确：
  - renderer 触发 restart
  - 主进程执行 `app.relaunch()` + `app.exit(0)`
  - 下次启动进行恢复校验
- 云备份相关已有基础单测和 DOM 测试覆盖：
  - `backupService.test.ts`
  - `cloudBackupModals.dom.test.tsx`
  - `applicationRestartBridge.test.ts`

#### 国际化

- 删除提示、恢复进度、恢复成功/失败等关键用户文案大部分已经接入 `conversation.*` / `settings.backup.*` 等 i18n key
- 删除列表与恢复弹窗逻辑本身没有直接硬编码主要业务文案，整体方向符合规范
- 本轮已补齐 `batchDeleteConfirm` 在 `ja-JP`、`ko-KR`、`zh-TW`、`tr-TR` 中的翻译残留

### 3.2 待补齐或需重点关注的点

#### `workspace/index.tsx` 仍有规范收敛空间

`src/renderer/pages/conversation/workspace/index.tsx` 中仍存在两类需要后续处理的问题：

- 迁移弹窗和部分按钮使用了较多内联样式，不完全符合“优先使用 UnoCSS / 组件体系”的规范倾向
- 迁移弹窗中存在字面字符图标，UI 规范上建议后续收敛到现有图标体系

这不影响功能正确性，但属于样式与实现一致性问题，适合后续单独整理。

#### coverage.include 需按 PR 实际范围再复核

当前 `vitest.config.ts` 已在原有基础上补入部分关键链路文件，例如：

- `src/process/services/backup/BackupService.ts`
- `src/process/services/backup/backupPaths.ts`
- `src/process/services/backup/restoreRecovery.ts`
- `src/process/services/conversation/deleteConversationData.ts`
- `src/process/services/system/TrashService.ts`
- `src/renderer/services/cloudBackupScheduler.ts`
- `src/renderer/components/SettingsModal/contents/CloudBackupRemarkModal.tsx`
- `src/renderer/components/SettingsModal/contents/CloudBackupRestoreModal.tsx`
- `src/renderer/components/SettingsModal/contents/CloudBackupRestoreProgressModal.tsx`

但若本轮 PR 继续扩大范围，仍需按最终改动清单复核是否还有遗漏文件。

#### E2E 仍是后续新增任务，不是现状已满足项

仓库已经具备 Playwright E2E 基础设施，但当前未发现专门覆盖“删除回收机制”和“云端备份机制”的现成 E2E 用例。后续如要满足更完整的提测要求，需要新增对应 E2E。

---

## 4. 模块一：删除回收机制

### 4.1 相关代码范围

主链路涉及：

- `src/renderer/pages/conversation/grouped-history/hooks/useConversationActions.tsx`
- `src/process/bridge/conversationBridge.ts`
- `src/process/services/conversation/deleteConversationData.ts`
- `src/process/services/system/TrashService.ts`
- `src/process/bridge/fsBridge.ts`

当前测试涉及：

- `tests/unit/deleteConversationData.test.ts`
- `tests/unit/trashService.test.ts`
- `tests/unit/fsBridgeRemoveEntry.test.ts`

### 4.2 功能目标

删除操作不应直接不可逆抹除所有本地资源，而是：

- 删除 conversation 及关联消息
- 删除 legacy conversation storage
- 在满足条件时，将默认临时工区移入系统垃圾桶
- 对文件树中的文件/目录删除统一走垃圾桶逻辑
- 清理相关运行时资源、cron 任务和 channel 资源

### 4.3 主操作流程

#### 场景 1：删除默认临时工区话题

触发：

- 用户在会话列表中删除一个使用默认临时工区的话题

处理过程：

1. renderer 根据 conversation 的 `workspace`、`customWorkspace`、`workspaceSource` 计算提示内容
2. 用户确认删除后，调用 `ipcBridge.conversation.remove`
3. 主进程先终止运行中的 worker
4. 清理该会话关联的 cron jobs
5. 若为 channel 会话，尝试清理 channel 资源
6. `deleteConversationData` 判断该默认工区是否仍被其他 conversation 或 session 引用
7. 若无引用，则删除 conversation 后将对应工区目录移动到垃圾桶
8. 删除 legacy conversation storage
9. renderer 刷新列表；若当前正在打开该会话，则导航回首页

预期结果：

- 删除：
  - conversation 记录
  - message 级联删除
  - legacy chat/history 关联存储
  - 默认临时工区目录
  - cron jobs
  - channel 资源（如适用）
- 保留：
  - 其他 conversation
  - 其他仍引用同一工区的 session / conversation

异常/边界：

- 若数据库删除失败，整体删除失败
- 若 legacy storage 清理失败，conversation 仍算删除成功，但打印 warning
- 若工区移入垃圾桶失败，conversation 仍算删除成功，但打印 warning

#### 场景 2：删除已迁移工区话题

触发：

- 用户删除 `workspaceSource = migrated` 的会话

处理过程：

1. UI 弹出“仅删除话题，不删除已迁移工区文件”的提示
2. 主进程执行 conversation 删除与资源清理
3. `deleteConversationData` 判断该工区不属于默认临时工区，不执行工区目录删除

预期结果：

- 删除：
  - conversation 记录
  - message
  - legacy storage
  - cron jobs / channel 资源（如适用）
- 保留：
  - 已迁移工区目录及其文件

异常/边界：

- 即使迁移工区路径位于当前 `workDir` 下，也不应被当作默认临时工区误删

#### 场景 3：删除手动指定工区话题

触发：

- 用户删除 `customWorkspace = true` 且 `workspaceSource = manual` 的会话

处理过程：

- 与已迁移工区类似，只删除会话数据，不删除外部工区

预期结果：

- 删除 conversation 与附属记录
- 保留手工指定的工区目录

异常/边界：

- 外部手工工区不参与垃圾桶移动，不受删除会话影响

#### 场景 4：删除当前打开中的话题

触发：

- 用户删除当前路由正在打开的 conversation

处理过程：

1. 删除成功后触发 `conversation.deleted`
2. 若当前路由 id 与被删 conversationId 一致，则导航回 `/`

预期结果：

- 当前会话页退出到首页
- 不保留失效路由状态

异常/边界：

- 若删除失败，不应跳转

#### 场景 5：删除来源不是 `aionui` 的 channel 会话

触发：

- 删除 `source !== 'aionui'` 的 conversation

处理过程：

1. `conversationBridge.remove` 在删除前尝试通过 `ChannelManager` 清理 channel 资源
2. 无论清理成功或失败，都继续进行 conversation 删除

预期结果：

- 删除 conversation 与消息
- 尽力清理 channel 资源

异常/边界：

- channel cleanup 失败只记 warning，不阻塞删除流程

### 4.4 批量删除流程

#### 场景 6：批量删除混合临时工区 / 迁移工区 / 手动工区

触发：

- 用户在 batch mode 中选择多条不同类型会话

处理过程：

1. UI 汇总选中会话的工区类型
2. 弹窗展示不同删除影响标签与说明
3. 逐条调用 `removeConversation`

预期结果：

- 默认临时工区话题可能删除工区目录
- 已迁移与手动工区话题只删除会话记录
- 提示内容与实际行为一致

异常/边界：

- 提示必须覆盖混合类型，避免用户误以为所有工区都会被删

#### 场景 7：批量删除部分成功、部分失败

触发：

- 多条删除请求中有的成功、有的失败

处理过程：

1. `Promise.all` 收集结果
2. 统计成功数量
3. 成功数大于 0 时显示成功条数提示，否则显示失败提示

预期结果：

- UI 不应把“部分成功”误报成“全部成功”
- 删除成功的会话应被刷新掉

异常/边界：

- 当前实现中对失败条目的细粒度错误原因反馈较少，后续可按需要增强

#### 场景 8：批量删除后 UI 刷新、选中状态清理、退出 batch mode

触发：

- 批量删除确认完成后

处理过程：

- 无论成功还是失败，最终清空选中集合并退出 batch mode

预期结果：

- 选中状态被重置
- 页面刷新后不会残留旧选中 UI

### 4.5 底层资源处理场景

#### 场景 9：数据库删除成功，legacy storage 删除失败

触发：

- `deleteLegacyConversationStorage` 抛错

处理过程：

- 主逻辑 catch warning，不回滚 conversation 删除

预期结果：

- conversation 删除仍视为成功
- 日志中有 warning

#### 场景 10：数据库删除成功，工作区移动到垃圾桶失败

触发：

- `movePathToTrash` 抛错

处理过程：

- warning 后继续返回成功

预期结果：

- conversation 删除成功
- 工区目录可能残留，需要日志提示

#### 场景 11：同一默认工区仍被其他 conversation 或 session 引用

触发：

- 其他 DB conversation、legacy conversation 或 assistant session 仍引用相同默认工区

处理过程：

- `getWorkspaceToDelete` 返回 `null`

预期结果：

- 只删除当前 conversation
- 不删除默认工区目录

#### 场景 12：`fs.removeEntry` 删除文件时发送 file stream delete 事件

触发：

- 用户在工作区树中删除文件

处理过程：

1. `fsBridge.removeEntry` 调用 `movePathToTrash`
2. 判断目标不是目录
3. 发送 `fileStream.contentUpdate` 的 delete 事件

预期结果：

- 文件进入垃圾桶
- 预览层收到 delete 事件，可据此关闭/刷新预览

#### 场景 13：`fs.removeEntry` 删除目录时不发送 file delete 事件

触发：

- 用户在工作区树中删除目录

处理过程：

- 删除目录后不发送文件级 delete 事件

预期结果：

- 避免错误地向文件预览通道广播目录删除

#### 场景 14：系统垃圾桶可用

触发：

- `shell.trashItem` 可正常执行

处理过程：

- 直接使用系统垃圾桶

预期结果：

- 文件/目录按系统行为进入回收站或垃圾桶

#### 场景 15：系统垃圾桶失败时 fallback 到 app `.trash`

触发：

- `shell.trashItem` 抛错

处理过程：

1. 创建 `cacheDir/.trash`
2. 文件复制或目录递归复制到 app `.trash`
3. 删除原始路径

预期结果：

- 删除操作仍可继续
- 文件可在 app 自建 `.trash` 中找回

### 4.6 删除回收机制测试现状与缺口

已有覆盖：

- `deleteConversationData`
  - 临时工区会在无引用时被清理
  - 自定义工区或共享工区不会误删
  - session 仍引用默认工区时不会误删工区
- `TrashService`
  - system trash 成功
  - system trash 失败后 fallback
- `fsBridge.removeEntry`
  - 文件分支会发 delete 事件
  - 目录分支不会发 delete 事件

尚需补充：

- 删除前 cron cleanup 成功与失败分支
- `source !== 'aionui'` 的 channel cleanup 成功与失败分支
- “当前打开会话删除后跳转首页”这一前端行为
- 批量删除部分成功的 UI 提示行为
- session 引用默认工区时不删除工区的专门测试

---

## 5. 模块二：云端备份与恢复机制

### 5.1 相关代码范围

主链路涉及：

- `src/process/services/backup/BackupService.ts`
- `src/process/services/backup/restoreRecovery.ts`
- `src/process/services/backup/backupPaths.ts`
- `src/renderer/components/SettingsModal/contents/SystemModalContent.tsx`
- `src/renderer/components/SettingsModal/contents/CloudBackupRestoreProgressModal.tsx`
- `src/process/bridge/applicationBridge.ts`

当前测试涉及：

- `tests/unit/backupService.test.ts`
- `tests/unit/cloudBackupModals.dom.test.tsx`
- `tests/unit/applicationRestartBridge.test.ts`

### 5.2 功能目标

为桌面端提供：

- WebDAV / 坚果云远端备份
- 手动备份与恢复
- 自动备份保留策略
- 恢复后的重启与恢复校验
- 默认工区按相对路径恢复到当前设备

### 5.3 配置与入口场景

#### 场景 1：WebDAV 配置保存与连接测试

触发：

- 用户在系统设置中填写 WebDAV 配置并点击连接测试

处理过程：

1. renderer 保存 `backup.cloud`
2. 调用 `checkRemoteConnection`
3. 主进程创建 `CloudWebDavClient` 并校验连接

预期结果：

- 成功时显示连接成功提示
- 失败时显示对应错误提示

异常/边界：

- 配置不完整时不应启动备份/恢复任务

#### 场景 2：坚果云配置保存与连接测试

触发：

- 用户选择 Nutstore 并填写账号、应用专用密码

处理过程：

- 与 WebDAV 类似，但 host 固定为坚果云地址

预期结果：

- 连接校验通过后可执行手动备份与恢复

#### 场景 3：未配置完整时按钮禁用或任务拒绝

触发：

- 缺少 host、用户名或密码

处理过程：

- UI 层根据 `isCloudBackupConfigured` 控制入口
- service 层仍会再次校验 settings

预期结果：

- 前后端双重保护

#### 场景 4：远端路径默认值与自定义路径

触发：

- 用户不填写或自定义 remote path

处理过程：

- 空值回退到 `/AionUibackup`
- 自定义路径走 normalize 逻辑

预期结果：

- 上传、列表、恢复都指向同一远端目录

### 5.4 手动备份流程

#### 场景 5：手动备份成功

触发：

- 用户点击“手动备份”

处理过程：

1. 获取建议文件名
2. 创建数据库快照
3. 收集 managed entries
4. 可选收集默认工区目录
5. 生成 manifest
6. 打包 ZIP
7. 上传远端
8. 清理超出保留数量的历史备份

预期结果：

- 远端生成符合命名规则的备份 ZIP
- UI 显示成功状态

#### 场景 6：备份备注生成文件名

触发：

- 用户填写 remark

处理过程：

- 备注作为文件名后缀拼接到标准命名格式之后

预期结果：

- 文件名仍满足 `AionUi_v*.zip`
- remark 经过 sanitize 处理

#### 场景 7：自动清理超出保留数量的历史备份

触发：

- 备份完成且 `maxBackupCount > 0`

处理过程：

- 按修改时间倒序保留前 N 个，删除冗余备份

预期结果：

- 远端保留数量符合配置

#### 场景 8：备份任务冲突

触发：

- 已有 backup / restore 在执行中，又发起新任务

处理过程：

- `runExclusive` 阻止并发

预期结果：

- 返回 `task_conflict`
- UI 应提示已有任务执行中

#### 场景 9：备份任务取消

触发：

- 用户取消正在进行的备份

处理过程：

- `AbortController` 中断任务
- 若取消发生在上传后失败路径，会尝试删除半成品远端文件

预期结果：

- 返回 `backup_canceled`
- UI 显示取消结果，不误报成功

#### 场景 10：远端连接失败 / 鉴权失败 / 网络失败

触发：

- WebDAV/Nutstore 无法访问、凭据错误、网络异常

处理过程：

- service 统一 normalize error code
- renderer 通过 i18n 错误文案映射展示

预期结果：

- 用户获得可理解的错误信息

### 5.5 恢复流程

#### 场景 11：恢复合法备份包成功

触发：

- 用户从远端列表选择一个合法备份包并确认恢复

处理过程：

1. 下载 ZIP
2. 提取并校验 manifest
3. 解析 managed entries
4. 清理 worker，关闭数据库
5. 创建回滚快照
6. 准备 pending restore recovery
7. 替换 managed data
8. 替换默认工区目录
9. 重写 conversation / session / legacy 中的工作区路径
10. 重新打开数据库
11. 返回 `restartRequired: true`

预期结果：

- 数据已恢复到当前设备目录结构
- UI 进入“恢复完成，等待重启”状态

#### 场景 12：恢复后需要重启

触发：

- restore success

处理过程：

- renderer 弹出恢复成功状态
- packaged 环境自动倒计时重启
- dev 环境展示手动重启提示

预期结果：

- 正式环境自动重启
- 开发环境手动重启验证可用

#### 场景 13：跨平台恢复成功但提示外部工具需复核

触发：

- 备份 `sourcePlatform` 与当前平台不同

处理过程：

- 弹出 warning，提示 MCP / 本地 CLI 等外部工具环境可能需要重新配置

预期结果：

- 用户知道恢复成功但需额外核查外部依赖

#### 场景 14：备份包 schema 非法 / manifest 缺失 / payload 缺失

触发：

- ZIP 不符合 managed backup 预期结构

处理过程：

- `extractAndValidateArchive` 直接拒绝

预期结果：

- 恢复被阻止
- 返回 `package_invalid`

#### 场景 15：备份数据库版本高于当前版本被拒绝

触发：

- manifest 中 `dbVersion > CURRENT_DB_VERSION`

处理过程：

- 校验阶段直接报错

预期结果：

- 不执行任何替换操作

#### 场景 16：恢复过程中 replace 失败时回滚

触发：

- `replaceManagedData`、`replaceDefaultWorkspaceDirectories` 或 `rewriteManagedWorkspacePaths` 过程中抛错

处理过程：

1. 使用 rollbackDir 恢复原有数据
2. 清理 pending restore recovery

预期结果：

- 当前设备维持恢复前状态
- UI 收到错误提示

#### 场景 17：prepare recovery 成功后，首次启动校验通过

触发：

- 恢复成功后进入下一次应用启动

处理过程：

1. 启动时执行 `beginPendingRestoreRecoveryVerification`
2. 标记本次启动为 verify
3. 待窗口 `did-finish-load` 后执行 `confirmPendingRestoreRecovery`

预期结果：

- pending restore 状态被清除
- 恢复被正式确认

#### 场景 18：恢复后首次启动未完成确认，下次启动自动回滚

触发：

- 恢复成功后第一次重启没有完整跑到确认点

处理过程：

- 下次启动时发现 `startupAttempts >= 1`
- 自动执行 rollbackPendingRestoreRecovery

预期结果：

- 数据回滚到恢复前状态
- pending restore 状态被清理

#### 场景 19：开发环境手动重启验证

触发：

- `window.location.protocol !== 'file:'`

处理过程：

- renderer 显示手动重启提示，不自动调用 restart

预期结果：

- 开发者手动退出并按原命令重启后，可验证恢复结果

#### 场景 20：正式环境自动重启链路

触发：

- packaged 环境恢复成功

处理过程：

1. renderer 倒计时结束或用户点“立即重启”
2. 调用 `ipcBridge.application.restart({ clearRuntimeState: true })`
3. 主进程清理 runtime state、relaunch、exit

预期结果：

- 应用自动重启
- 恢复后的数据在新进程中校验并确认

### 5.6 默认工区相关场景

#### 场景 21：未开启“包含默认工区文件”时，仅重写路径，不恢复工区内容

触发：

- 恢复包未包含默认工区目录内容

处理过程：

- 数据库和 legacy 存储中的 workspace 路径仍会映射到当前 `workDir`
- 但不恢复原目录文件

预期结果：

- conversation 能指向当前设备的目标路径
- 目录内容是否存在由当前设备实际状态决定

#### 场景 22：开启后，按相对路径恢复到当前 `workDir`

触发：

- `includeDefaultWorkspaceFiles = true`

处理过程：

- 备份时只记录默认工区相对路径
- 恢复时统一落到当前机器的 `workDir`

预期结果：

- 跨设备、跨平台恢复后仍可使用

#### 场景 23：conversation / assistant_sessions / legacy chat 中的 workspace 路径重写

触发：

- source workDir 与 target workDir 不同

处理过程：

- `rewriteManagedWorkspacePaths` 与 legacy rewrite 逻辑同步处理

预期结果：

- conversation、session、legacy storage 一致指向新路径

#### 场景 24：外部手工工区不参与备份与恢复

触发：

- conversation 使用手工指定工区

处理过程：

- 只重写 managed default workspace 相对路径
- 外部手工工区不打包、不还原

预期结果：

- 不越权打包用户外部目录

### 5.7 云备份机制测试现状与缺口

已有覆盖：

- 结构化文件名生成
- 远端备份列表筛选与排序
- 备份数据库版本过高时禁止恢复
- 合法备份包恢复成功并返回 manifest
- 旧 manifest 仅恢复已声明 managed entries
- restore 失败后清理 pending restore recovery
- 进行中的备份任务取消
- `restoreRecovery.ts` 的 prepare / verify / automatic rollback 关键链路
- `backupPaths.ts` 的 managed entry 构造与按 key 过滤
- 恢复进度弹窗的成功 / 错误 / 重启入口
- restart bridge 的 runtime state cleanup

尚需补充：

- `CloudBackupRestoreProgressModal` 对 dev / packaged 自动重启分支的更细粒度测试
- 恢复后 conversation / session / legacy 路径一致性的集成测试
- includeDefaultWorkspaceFiles 开关对实际恢复内容影响的集成测试

---

## 6. 测试要求整理

### 6.1 单元测试建议

#### 删除回收

- `deleteConversationData`
  - 默认临时工区且无引用时删除工区
  - 默认临时工区被其他 conversation 引用时保留工区
  - 默认临时工区被 session 引用时保留工区
  - 已迁移工区不删除目录
  - 手工工区不删除目录
  - legacy storage 删除失败不阻塞成功结果
  - 工区移动到垃圾桶失败不阻塞成功结果
- `TrashService`
  - system trash 成功
  - system trash 失败 fallback 到 app `.trash`
  - 目录 fallback
- `fsBridge.removeEntry`
  - 文件删除发 delete 事件
  - 目录删除不发 delete 事件
- `conversationBridge.remove`
  - cron cleanup 成功 / 失败
  - channel cleanup 成功 / 失败

#### 云备份

- task conflict
- manifest 校验失败
- db version 过高拒绝恢复
- 恢复失败后的 rollback
- pending restore recovery 的 prepare / confirm / verify / automatic rollback
- renderer 恢复进度弹窗的 dev / packaged 两种重启分支
- i18n key 错误码映射

### 6.2 集成测试建议

- restore 后 conversation / session / legacy 存储中的 workspace 路径一致性
- includeDefaultWorkspaceFiles 开关对备份内容与恢复结果的影响
- 远端列表、恢复 requestId、任务状态事件串联
- 删除话题后数据库、legacy 文件、工区目录之间的一致性

### 6.3 E2E 测试要求与现状

仓库现状：

- Playwright E2E 基础设施已存在
- 入口为 `tests/e2e/specs` 与 `tests/e2e/fixtures.ts`
- `package.json` 提供 `bun run test:e2e`
- 本轮已补充与这两个功能直接相关的薄层 E2E

当前已补充并实际执行通过的 E2E：

- `tests/e2e/specs/conversation-delete.e2e.ts`
  - 默认临时工区话题删除弹窗
  - 已转移工区话题删除弹窗
  - 手动指定工区话题删除弹窗
  - 三类工区混合批量删除弹窗
- `tests/e2e/specs/cloud-backup-settings.e2e.ts`
  - 备份配置面板默认折叠
  - 配置面板展开后的入口显示
  - 当前 provider 下必填项不足时备份与恢复入口禁用

为什么云备份 E2E 只覆盖配置界面：

- 真实备份/恢复流程需要用户远端凭据与可访问的 WebDAV 环境
- 这部分更适合单元测试、集成测试和人工验证配合
- 因此 E2E 只覆盖配置页与入口 gating，不覆盖真实远端执行

仍建议后续补充但不是首版 PR 硬前置的 E2E：

- 恢复成功后 dev 模式显示“手动重启”提示
- 恢复失败时显示 inline error 且弹窗保持打开
- 工作区文件树删除文件/目录的用户交互链路

### 6.4 coverage.include 复核清单

提交 PR 前建议逐项确认以下文件是否需要纳入 `coverage.include`：

- `src/process/services/backup/BackupService.ts`
- `src/process/services/backup/restoreRecovery.ts`
- `src/process/services/backup/backupPaths.ts`
- `src/process/services/conversation/deleteConversationData.ts`
- `src/process/services/system/TrashService.ts`
- `src/renderer/components/SettingsModal/contents/CloudBackupRestoreProgressModal.tsx`
- `src/renderer/pages/conversation/grouped-history/hooks/useConversationActions.tsx`

---

## 7. PR 可复用素材

### 7.1 `## Summary` 草稿

```md
## Summary

- 梳理并对齐删除回收机制与云端备份/恢复机制的实现路径、异常处理分支和测试要求
- 明确默认临时工区删除、手工/迁移工区保留、系统垃圾桶 fallback、恢复回滚与恢复后重启校验等行为预期
- 补充面向后续测试与提审的场景清单，作为单测、集成测试、E2E 和 PR 说明底稿
```

### 7.2 `## Test plan` 草稿

```md
## Test plan

- [ ] 验证删除默认临时工区话题时，会话数据删除且工区目录移入垃圾桶
- [ ] 验证删除已迁移/手工工区话题时，仅删除会话数据，不删除工区目录
- [ ] 验证文件树删除文件/目录均走垃圾桶逻辑，且文件删除会发 preview delete 事件
- [ ] 验证手动备份成功、远端列表排序、备份冲突与取消分支
- [ ] 验证恢复合法备份成功、非法备份拒绝、db version 过高拒绝恢复
- [ ] 验证恢复失败回滚、恢复后重启、下次启动恢复确认与自动回滚链路
- [ ] 验证新增删除提示与备份恢复文案的 i18n 同步情况
```

---

## 8. 待补齐项与残余风险

### 8.1 优先处理项

- 复核本轮 PR 涉及文件是否都应进入 `coverage.include`
- 为删除回收与云备份补充更完整的集成测试与 E2E

### 8.2 中期优化项

- 收敛 `workspace/index.tsx` 中迁移弹窗的内联样式
- 视需要增强批量删除“部分成功”时的 UI 反馈细节
- 为 restore recovery 的启动确认与自动回滚补充更直接的测试

### 8.3 当前可接受结论

- 从代码路径看，正式环境恢复成功后的自动重启链路是完整的
- 开发环境无法直接模拟 packaged 自动重启是当前设计使然，但手动重启可用于验证恢复结果
- 删除回收和云端备份都已具备可工作的主流程，现阶段主要缺口已收敛到 E2E、部分集成测试和少量 UI 实现风格一致性




