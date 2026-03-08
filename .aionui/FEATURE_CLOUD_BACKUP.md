# AionUi 云端备份 / 恢复功能开发方案

## 1. 功能概述

### 1.1 基本信息

- **功能名称**: 云端备份 / 恢复
- **所属模块**: [ ] Agent 层 [x] 对话系统 [x] 设置系统 [ ] 工作区 [x] 其他
- **涉及进程**: [x] 主进程(process) [x] 渲染进程(renderer) [ ] WebServer [ ] Worker

### 1.2 功能描述

为桌面端 AionUi 增加云端备份与恢复能力，支持 WebDAV 与坚果云，覆盖应用托管的配置数据、对话数据库、旧版历史文件、助手/技能与预览历史。恢复时保留当前设备目录映射，将备份内容恢复到当前机器正在使用的目录，确保跨机器、跨系统继续可用。

### 1.3 用户场景

```
触发: 用户在系统设置中配置 WebDAV/坚果云，点击手动备份，或应用启动后触发自动备份
过程: 主进程收集应用托管数据 -> 生成数据库一致性快照 -> 打包 ZIP -> 上传到远端目录
结果: 远端生成结构化命名的备份包，用户可在恢复弹窗中读取列表、选择备份并恢复
```

### 1.4 数据流

| 方向 | 数据类型 | 说明 |
| ---- | -------- | ---- |
| 输入 | `backup.cloud` 设置、应用托管数据目录、数据库快照 | 备份执行参数与源数据 |
| 输出 | ZIP 备份包、远端备份列表、任务状态事件 | 上传、恢复与状态反馈 |

## 2. 开发规范

### 2.1 需要修改 / 新增的文件

**主进程 (src/process/)**

| 文件路径 | 操作 | 说明 |
| -------- | ---- | ---- |
| `src/process/bridge/backupBridge.ts` | [x] 新增 | 云备份相关 IPC 注册 |
| `src/process/services/backup/BackupService.ts` | [x] 新增 | 备份/恢复核心服务 |
| `src/process/services/backup/WebDavClient.ts` | [x] 新增 | WebDAV 客户端封装 |
| `src/process/services/backup/backupPaths.ts` | [x] 新增 | 备份源路径与还原目标描述 |
| `src/process/services/backup/workspaceBackup.ts` | [x] 新增 | 默认工作区识别、相对路径映射与恢复工具 |
| `src/process/bridge/index.ts` | [x] 修改 | 注册 backup bridge |
| `src/process/database/index.ts` | [x] 修改 | 暴露数据库快照能力 |

**渲染进程 (src/renderer/)**

| 文件路径 | 操作 | 说明 |
| -------- | ---- | ---- |
| `src/renderer/components/SettingsModal/contents/SystemModalContent.tsx` | [x] 修改 | 新增云备份设置区块 |
| `src/renderer/components/SettingsModal/contents/CloudBackupRemarkModal.tsx` | [x] 新增 | 手动备份备注弹窗 |
| `src/renderer/components/SettingsModal/contents/CloudBackupRestoreModal.tsx` | [x] 新增 | 远端备份列表恢复弹窗 |
| `src/renderer/services/cloudBackup.ts` | [x] 新增 | 备份任务提示与调用封装 |
| `src/renderer/services/cloudBackupScheduler.ts` | [x] 新增 | 自动备份调度 |
| `src/renderer/layout.tsx` | [x] 修改 | 初始化任务监听与自动备份 |

**共享模块 (src/common/)**

| 文件路径 | 操作 | 说明 |
| -------- | ---- | ---- |
| `src/common/types/backup.ts` | [x] 新增 | 云备份共享类型与常量 |
| `src/common/storage.ts` | [x] 修改 | 新增 `backup.cloud` 配置 |
| `src/common/ipcBridge.ts` | [x] 修改 | 新增 `backup.*` IPC |

**测试**

| 文件路径 | 操作 | 说明 |
| -------- | ---- | ---- |
| `tests/unit/backupService.test.ts` | [x] 新增 | 主进程备份服务单测 |
| `tests/unit/SystemModalContent.backup.dom.test.tsx` | [x] 新增 | 设置页备份区块 DOM 测试 |
| `vitest.config.ts` | [x] 修改 | 覆盖新增备份文件 |

### 2.2 IPC 通信设计

```typescript
export const backup = {
  getSuggestedFileName: bridge.buildProvider<string, { remark?: string }>('backup.get-suggested-file-name'),
  checkRemoteConnection: bridge.buildProvider<IBridgeResponse<{ reachable: boolean }>, ICloudBackupSettings>('backup.check-remote-connection'),
  runRemoteBackup: bridge.buildProvider<IBridgeResponse<IRemoteBackupFile>, { settings: ICloudBackupSettings; remark?: string; automatic?: boolean }>('backup.run-remote-backup'),
  listRemotePackages: bridge.buildProvider<IBridgeResponse<IRemoteBackupFile[]>, { settings: ICloudBackupSettings }>('backup.list-remote-packages'),
  restoreRemotePackage: bridge.buildProvider<IBridgeResponse<{ fileName: string; restartRequired: boolean }>, { settings: ICloudBackupSettings; fileName: string }>('backup.restore-remote-package'),
  taskStatus: bridge.buildEmitter<IBackupTaskEvent>('backup.task-status'),
};
```

### 2.3 状态管理设计

- [x] 仅组件内部状态(useState/useReducer)
- [x] 需要持久化存储
- [x] 使用现有 `ConfigStorage`
- [ ] 需要新增 Context

### 2.4 国际化 Key 设计

新增 `settings.backup.*` 相关 key，至少覆盖：

- `settings.backup.title`
- `settings.backup.provider`
- `settings.backup.webdav`
- `settings.backup.nutstore`
- `settings.backup.manualBackup`
- `settings.backup.restore`
- `settings.backup.testConnection`
- `settings.backup.remotePath`
- `settings.backup.maxBackupCount`
- `settings.backup.autoBackupEnabled`
- `settings.backup.autoBackupInterval`
- `settings.backup.includeDefaultWorkspaceFiles`
- `settings.backup.defaultWorkspaceNotice`
- `settings.backup.lastStatus`
- `settings.backup.lastSuccessTime`
- `settings.backup.desktopOnly`
- `settings.backup.remarkLabel`
- `settings.backup.restoreConfirm`

## 3. 实现架构

### 3.1 分层结构

- 渲染层:
  - 设置 UI、备注弹窗、恢复弹窗
  - 自动备份调度
  - `Message` 提示与状态展示
- 主进程:
  - 读取应用托管数据
  - 数据库快照
  - ZIP 打包 / 解压
  - WebDAV 上传 / 下载 / 列表 / 删除旧备份
  - 备份包校验与失败回滚
- 数据层:
  - `aionui.db`
  - `aionui-config.txt`
  - `aionui-chat.txt`
  - `aionui-chat-message.txt`
  - `aionui-chat-history/`
  - `assistants/`
  - `skills/`
  - `preview-history/`

### 3.2 关键策略

- 只备份应用托管数据，不打包任意外部工作区。
- 默认工作区文件支持可选备份开关；开启时仅纳入当前 `workDir` 下由应用自动创建的默认工作区，外部工作区始终不打包。
- `.aionui-env` 仅写入 manifest 作为审计信息，不在恢复时回写。
- 恢复固定写入当前机器现用目录，不恢复旧 `cacheDir/workDir` 映射。
- 默认工作区恢复时统一映射到当前机器的 `workDir`，并基于相对路径重写数据库与旧版 `aionui-chat.txt` 中的工作区路径，避免跨机器/跨系统绝对路径失效。
- 远端目录支持独立配置，留空回退 `/AionUibackup`。
- 管理文件仅识别 `AionUi_v*.zip`。
- 文件名固定包含软件名、版本、时间戳、随机数、平台、主机名，可附加备注后缀。

## 4. 验收标准

### 4.1 功能验收

- [ ] 支持 WebDAV 与坚果云手动备份
- [ ] 支持自动备份与每天首次启动自动备份
- [ ] 支持最大备份数量自动清理
- [ ] 支持远端备份列表读取、刷新和选择恢复
- [ ] 恢复成功后提示并重启应用
- [ ] 开启“包含默认工作区文件”时，默认工作区文件按相对路径打包并恢复到当前 `workDir`
- [ ] 关闭该开关时仍重写默认工作区路径到当前 `workDir`，但不恢复其文件内容
- [ ] 失败时回滚当前数据并提示错误

### 4.2 边界情况

- [ ] WebDAV 连接失败时给出错误提示
- [ ] 远端目录不存在时自动创建
- [ ] 非法 ZIP / 缺失 manifest / 高版本数据库备份被拦截
- [ ] 备份与恢复任务全局串行，禁止并发
- [ ] 浏览器 WebUI 模式隐藏桌面专属操作

### 4.3 兼容性验收

- [ ] Windows 正常运行
- [ ] macOS 正常运行
- [ ] Linux 正常运行
- [ ] 中英文设置项正常展示

### 4.4 代码质量

- [ ] `npm run lint` 无错误
- [ ] `npm run test` 通过
- [ ] `npm run build` 成功
- [ ] 无 `console.log` 遗留

## 5. 参考资料

### 5.1 类似功能参考

| 功能 | 文件路径 | 说明 |
| ---- | -------- | ---- |
| Cherry Studio Backup | `C:\Users\sunfl\.codex\memories\cherry-studio-ref\src\main\services\BackupManager.ts` | 备份/恢复总体流程参考 |
| Cherry Studio WebDAV | `C:\Users\sunfl\.codex\memories\cherry-studio-ref\src\main\services\WebDav.ts` | WebDAV 目录/上传下载参考 |
| WebUI 设置模式 | `src/renderer/components/SettingsModal/contents/WebuiModalContent.tsx` | 设置区块 UI 组织参考 |

### 5.2 依赖的现有模块

| 模块 | 路径 | 用途 |
| ---- | ---- | ---- |
| `ProcessConfig` | `src/process/initStorage.ts` | 主进程读取/写入备份设置 |
| `getSystemDir` | `src/process/initStorage.ts` | 获取当前 cacheDir/workDir |
| `getDataPath` | `src/process/utils.ts` | 获取数据库目录 |
| `closeDatabase` | `src/process/database/export.ts` | 恢复前关闭数据库连接 |
| `ConfigStorage` | `src/common/storage.ts` | 渲染层备份设置持久化 |

### 5.3 外部依赖

| 依赖包 | 版本 | 用途 | 必要性说明 |
| ------ | ---- | ---- | ---------- |
| `webdav` | `^5.9.0` | WebDAV 与坚果云连接 | 核心远端备份协议实现 |

### 5.4 特殊注意事项

- 备份包包含敏感配置数据，UI 需提示用户妥善保管。
- 自动备份失败不能阻塞应用启动。
- 坚果云使用固定 WebDAV Host `https://dav.jianguoyun.com/dav`。
