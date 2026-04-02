# MCP Apps 协议集成分析 — AionUi 适配评估

> 分支: `feat/mcp-apps-protocol`
> 日期: 2026-04-02
> 基于: [MCP-Apps-技术评估报告.md](../../MCP-Apps-技术评估报告.md) 的后续分析

---

## 1. 评估结论摘要

| 维度                 | 评估                                               |
| -------------------- | -------------------------------------------------- |
| **技术可行性**       | ✅ 完全可行 — 现有架构天然适配                     |
| **推荐集成路径**     | 路径 B: `AppBridge` (框架无关) + 自封装 React 组件 |
| **核心改造量**       | ~800-1200 行新代码 (6 个改造点)                    |
| **预估工期**         | 阶段 1: 2 天 / 阶段 2: 5 天 / 阶段 3: 1-2 周       |
| **风险等级**         | 中 — CSP 和 iframe 交互是主要挑战                  |
| **对现有功能的影响** | 低 — 增量扩展，不破坏现有 MCP 工具显示             |

---

## 2. 现有架构支撑度分析

### 2.1 MCP SDK 已集成 ✅

**当前状态**: `@modelcontextprotocol/sdk` v1.20.0 已在 `package.json` 中

**现有 MCP 架构**:

```
src/process/services/mcpServices/
├── McpProtocol.ts      (597 行) — 协议定义 + 抽象基类 + 多 Agent 实现
├── McpService.ts       (375 行) — 服务协调器 + 操作队列
├── agents/
│   ├── AionuiMcpAgent.ts
│   ├── ClaudeMcpAgent.ts
│   ├── QwenMcpAgent.ts
│   └── ... (7 种 Agent)
src/process/bridge/
└── mcpBridge.ts        (170+ 行) — IPC 桥接层
src/common/adapter/
└── ipcBridge.ts        — mcpService.* API 定义
```

**已支持的 MCP 传输协议**: Stdio / SSE / StreamableHTTP

**缺失部分**:

- ❌ 连接时未声明 `io.modelcontextprotocol/ui` capability
- ❌ 未检测 tool 描述中的 `_meta.ui.resourceUri`
- ❌ 未请求 `ui://` 资源
- ❌ 未引入 `@modelcontextprotocol/ext-apps` SDK

### 2.2 iframe 使用经验 ✅

项目已有两处成熟的 iframe 集成模式:

**模式 A — 扩展设置页** (`src/renderer/pages/settings/ExtensionSettingsPage.tsx`):

- `sandbox='allow-scripts allow-same-origin'`
- postMessage 双向通信 (`aion:init`, `star-office:request-snapshot`)
- 动态高度管理

**模式 B — HTML 预览** (`src/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer.tsx`):

- Electron `<webview>` + 浏览器环境 `<iframe>` 双模式
- 资源内联策略 (图片 base64、CSS/JS inline)
- 相对路径解析

> 这意味着团队已具备 iframe 沙箱 + postMessage 通信的工程经验。

### 2.3 消息渲染架构 ✅

**消息类型系统** (`src/common/chat/chatLib.ts`):

```typescript
TMessageType = 'text' | 'tool_call' | 'codex_tool_call' | 'tool_group' | ...
```

**MCP 工具当前渲染** (`src/renderer/pages/conversation/Messages/codex/ToolCallComponent/McpToolDisplay.tsx`, 94 行):

- 只显示工具名、参数 JSON、结果文本
- 使用 `BaseToolCallDisplay` 卡片包装
- **无 UI 渲染能力** — 这是核心改造点

**虚拟滚动** (`react-virtuoso`):

- MessageList 使用虚拟化列表
- iframe 高度变化需要通知 Virtuoso 重新计算

### 2.4 流式消息处理 ✅

**IPC 流式管道**:

```
Main Process → ipcBridge.conversation.responseStream → Renderer → composeMessage()
```

**已有能力**:

- `ontoolinputpartial` 类似的流式更新 — `responseStream` emitter 已支持增量更新
- 消息索引缓存 (WeakMap) 实现 O(1) 查找和更新
- Thought 更新节流 (50ms) 减少渲染压力

**缺失部分**:

- ❌ 流式内容到 iframe 的 postMessage 转发
- ❌ iframe 就绪前的消息缓冲队列

### 2.5 CSP 策略 ⚠️ 需调整

**当前 CSP** (`src/process/webserver/config/constants.ts:180-184`):

```
default-src 'self';
script-src 'self' 'unsafe-inline' ['unsafe-eval' in dev];
frame-src [未设置 → 继承 default-src 'self'];
connect-src 'self' ws: wss: blob:;
```

**问题**:

1. `frame-src` 未显式设置 → 默认 `'self'`，阻止 `blob:` / `data:` URI 的 iframe
2. `X-Frame-Options: DENY` → 禁止所有 iframe 嵌入 (虽然 MCP Apps iframe 是在同页面内，但某些场景可能冲突)
3. 外部 CDN (esm.sh, cdnjs) 不在 `connect-src` 白名单中

**安全头** (`AuthMiddleware.ts`):

```typescript
res.header('X-Frame-Options', 'DENY'); // 需要改为 'SAMEORIGIN' 或移除
```

### 2.6 Electron 配置 ✅

**webPreferences** (`src/index.ts`):

```typescript
webPreferences: {
  preload: path.join(__dirname, '../preload/index.js'),
  webviewTag: true,  // ✅ 已启用 webview 标签
}
```

> Electron 环境下可以选择 `<webview>` (更强隔离) 或 `<iframe>` (更标准)。项目已两者都有使用经验。

---

## 3. 改造影响点详细分析

### 改造点 1: MCP 连接层 — Capability 协商

| 属性         | 值                                                              |
| ------------ | --------------------------------------------------------------- |
| **影响文件** | `src/process/services/mcpServices/McpProtocol.ts`               |
| **改造内容** | MCP Client 初始化时声明 `io.modelcontextprotocol/ui` capability |
| **代码量**   | ~20 行                                                          |
| **风险**     | 低 — 向后兼容，不影响不支持 UI 的 Server                        |
| **依赖**     | 需安装 `@modelcontextprotocol/ext-apps`                         |

**具体改动**:

```typescript
// McpProtocol.ts — Client 创建时增加 capability
const client = new Client(
  {
    // ... existing config
  },
  {
    capabilities: {
      // ... existing capabilities
      experimental: {
        'io.modelcontextprotocol/ui': {}, // 声明支持 MCP Apps
      },
    },
  }
);
```

### 改造点 2: Tool 元数据识别

| 属性         | 值                                                                 |
| ------------ | ------------------------------------------------------------------ |
| **影响文件** | `src/process/services/mcpServices/McpProtocol.ts`, `McpService.ts` |
| **改造内容** | Tool 列表中检测 `_meta.ui.resourceUri` 字段                        |
| **代码量**   | ~30 行                                                             |
| **风险**     | 低 — 纯增量逻辑                                                    |

**判断逻辑**:

```typescript
// 检测 tool 是否有 UI 资源
const hasUiResource = tool._meta?.ui?.resourceUri?.startsWith('ui://');
```

### 改造点 3: UI Resource 获取 + IPC 传递

| 属性         | 值                                                      |
| ------------ | ------------------------------------------------------- |
| **影响文件** | `McpProtocol.ts`, `mcpBridge.ts`, `ipcBridge.ts`        |
| **改造内容** | 主进程请求 `ui://` 资源获取 HTML，通过 IPC 传给渲染进程 |
| **代码量**   | ~100 行                                                 |
| **风险**     | 中 — 需要新增 IPC 通道                                  |

**新增 IPC API**:

```typescript
// ipcBridge.ts
mcpService.getUiResource: provider<{ html: string; csp?: string }>
mcpService.forwardToApp: emitter<McpAppMessage>  // Host → iframe 消息
mcpService.appCallback: provider<McpAppCallback>  // iframe → Host → Server
```

### 改造点 4: MCP App 容器组件 (核心)

| 属性         | 值                                                                        |
| ------------ | ------------------------------------------------------------------------- |
| **新增文件** | `src/renderer/pages/conversation/Messages/components/McpAppContainer.tsx` |
| **改造内容** | sandboxed iframe 容器，postMessage 代理，生命周期管理                     |
| **代码量**   | ~300-400 行                                                               |
| **风险**     | 中高 — iframe 交互是主要复杂度来源                                        |

**组件职责**:

1. 创建 sandboxed iframe，加载 UI Resource HTML
2. 实现 Host ↔ iframe postMessage JSON-RPC 代理
3. 消息缓冲队列 (iframe 未就绪时)
4. 高度自适应 (resize 事件)
5. iframe 销毁 (组件卸载 / 长对话清理)
6. 外部链接拦截 (`openLink` 事件)

**可复用**: `ExtensionSettingsPage.tsx` 的 iframe + postMessage 模式

### 改造点 5: McpToolDisplay 扩展

| 属性         | 值                                                                                    |
| ------------ | ------------------------------------------------------------------------------------- |
| **影响文件** | `src/renderer/pages/conversation/Messages/codex/ToolCallComponent/McpToolDisplay.tsx` |
| **改造内容** | 检测 UI tool，渲染 McpAppContainer 替代纯文本显示                                     |
| **代码量**   | ~50 行                                                                                |
| **风险**     | 低 — 条件分支，不影响现有文本渲染                                                     |

**分支逻辑**:

```tsx
// McpToolDisplay.tsx
if (content.data?.uiResource) {
  return (
    <McpAppContainer
      html={content.data.uiResource.html}
      toolInput={content.data.invocation?.arguments}
      toolResult={content.data.result}
      onResize={onResize} // 通知 Virtuoso 重新布局
    />
  );
}
// 否则走现有的纯文本显示逻辑
```

### 改造点 6: CSP 策略调整

| 属性         | 值                                                               |
| ------------ | ---------------------------------------------------------------- |
| **影响文件** | `src/process/webserver/config/constants.ts`, `AuthMiddleware.ts` |
| **改造内容** | 添加 `frame-src blob: data:;`，调整 `X-Frame-Options`            |
| **代码量**   | ~20 行                                                           |
| **风险**     | 中 — 安全策略变更需要审批                                        |

**CSP 变更**:

```diff
- "default-src 'self'; ..."
+ "default-src 'self'; frame-src 'self' blob: data:; connect-src 'self' ws: wss: blob: https://esm.sh https://cdnjs.cloudflare.com; ..."
```

**X-Frame-Options 变更**:

```diff
- res.header('X-Frame-Options', 'DENY');
+ res.header('X-Frame-Options', 'SAMEORIGIN');
```

---

## 4. 改造工作量汇总

| 序号 | 改造点                  | 文件变更 |    新增代码     | 难度 | 优先级 |
| :--: | ----------------------- | :------: | :-------------: | :--: | :----: |
|  1   | Capability 协商         |   1 改   |     ~20 行      |  低  |   P0   |
|  2   | Tool 元数据识别         |   2 改   |     ~30 行      |  低  |   P0   |
|  3   | UI Resource 获取 + IPC  |   3 改   |     ~100 行     |  中  |   P0   |
|  4   | McpAppContainer 组件    |   1 新   |   ~300-400 行   |  高  |   P0   |
|  5   | McpToolDisplay 扩展     |   1 改   |     ~50 行      |  低  |   P0   |
|  6   | CSP 策略调整            |   2 改   |     ~20 行      |  中  |   P0   |
|  —   | **流式渲染支持**        |  2-3 改  |     ~150 行     | 中高 |   P1   |
|  —   | **iframe 生命周期管理** |   1 改   |     ~100 行     |  中  |   P1   |
|  —   | **反向 Tool 调用**      |  2-3 改  |     ~80 行      |  中  |   P2   |
|      | **合计**                | ~10 文件 | **~850-950 行** |      |        |

**新增依赖**: `@modelcontextprotocol/ext-apps` (一个包)

---

## 5. 架构优势 (降低改造难度的因素)

| 优势                 | 说明                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| **MCP SDK 已集成**   | 不需要从头搭建 MCP 连接层                                                |
| **多 Agent 架构**    | Capability 协商只需在基类 `AbstractMcpAgent` 中改一处                    |
| **IPC Bridge 成熟**  | `@office-ai/platform` bridge 提供类型安全的 IPC，新增通道成本低          |
| **iframe 工程经验**  | `ExtensionSettingsPage` 和 `HTMLRenderer` 已验证了 sandbox + postMessage |
| **消息类型可扩展**   | `McpToolDisplay` 通过 `subtype` 分派，增加 UI 分支无侵入                 |
| **虚拟滚动**         | Virtuoso 支持动态高度 item，iframe resize 有现成 API                     |
| **Electron webview** | `webviewTag: true` 已开启，可作为 iframe 的高隔离替代方案                |

---

## 6. 风险矩阵与缓解策略

| 风险                        | 等级 | 影响                            | 缓解策略                                                                                       |
| --------------------------- | :--: | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| CSP 策略变更影响安全性      |  高  | MCP App iframe 需要加载外部资源 | 使用 `<webview>` 替代 `<iframe>` (Electron 独立进程隔离)；浏览器环境用 blob URL + 严格 sandbox |
| iframe 与 Virtuoso 滚动冲突 |  中  | 滚轮事件被 iframe 吞掉          | `pointer-events: none` on inactive iframes；`IntersectionObserver` 管理可见性                  |
| 多 iframe 内存泄漏          |  中  | 长对话堆积多个 MCP App iframe   | 可视区域外的 iframe 替换为截图 placeholder；LRU 策略销毁不可见 iframe                          |
| 流式渲染时序问题            |  中  | iframe 未就绪时消息丢失         | 消息缓冲队列 + iframe ready 握手；AppBridge SDK 已有部分处理                                   |
| 第三方 HTML/JS 安全         |  中  | MCP Server 提供任意代码         | `sandbox` 限制 + Electron `<webview>` 进程隔离 + CSP 白名单                                    |
| 键盘快捷键冲突              |  低  | 焦点在 iframe 时宿主快捷键失效  | `focusin/focusout` 事件管理                                                                    |

---

## 7. 推荐实施路线

### 阶段 1: 验证可行性 (2 天)

```
├─ 安装 @modelcontextprotocol/ext-apps
├─ 在 McpProtocol.ts 添加 UI capability 协商 (改造点 1-2)
├─ 写独立 demo 页面，用 AppBridge 连接 draw.io app server (https://mcp.draw.io/mcp)
└─ 验证 iframe 渲染 + postMessage 通信是否工作
```

### 阶段 2: 最小可用 (5 天)

```
├─ 实现 UI Resource 获取 + IPC 传递 (改造点 3)
├─ 开发 McpAppContainer 组件 (改造点 4)
├─ 扩展 McpToolDisplay (改造点 5)
├─ 调整 CSP (改造点 6)
├─ 用 draw.io 端到端验证完整流程
└─ Feature flag 控制，默认关闭
```

### 阶段 3: 生产化 (1-2 周)

```
├─ 流式渲染支持 (ontoolinputpartial → iframe)
├─ iframe 生命周期管理 (内存、可见性、LRU 清理)
├─ 反向 Tool 调用 (iframe → Host → Server)
├─ Electron <webview> 高隔离方案 (可选)
├─ 移动端适配
├─ 测试覆盖
└─ Feature flag 打开，灰度发布
```

---

## 8. 已确认决策

| 问题                            | 决策                                       | 理由                                                               |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| CSP 策略变更审批                | 直接改，PR 审核                            | 开源项目，PR 不合并即可回退                                        |
| Electron 用 webview 还是 iframe | **iframe**                                 | claude.ai 也是 iframe，跨平台统一，代码更简单                      |
| Web 端是否支持                  | **同步支持**，优先客户端                   | iframe 方案天然跨平台，区别仅在 CSP 配置                           |
| 优先支持哪些 MCP Apps           | draw.io + 可视化类 (threejs, map, heatmap) | 覆盖静态渲染 + CDN 加载 + 外部资源三种场景                         |
| 是否搭建隔离域                  | **先用 blob: URL + sandbox**               | 隔离域是独立基础设施项目，成本过高；blob: origin=null 已有基本隔离 |
| Feature flag 层级               | **用户级，默认关闭** + Trust list 双层控制 | 用户自行控制，添加白名单 MCP 时提示开启（不自动开启）              |
