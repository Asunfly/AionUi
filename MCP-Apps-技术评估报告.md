# MCP Apps 技术评估报告

> 讨论日期: 2026-04-02
> 背景: 评估在自有客户端中集成 MCP Apps 协议以支持 draw.io 等交互式 UI 内联渲染的可行性

---

## 1. 问题起源

在 Claude Code (VS Code 扩展) 中调用 draw.io MCP 的 `create_diagram` 工具时，返回的是原始 XML 文本，无法渲染为可视化图表。而在 claude.ai 网页端，同样的工具调用能直接在对话中渲染出交互式流程图，甚至支持流式逐步绘制动画。

**核心问题**: 为什么同一个 MCP Server，在不同客户端上表现不同？如何让自有客户端也支持内联渲染？

---

## 2. draw.io 官方 MCP 架构分析

### 2.1 两个 MCP Server 的区别

draw.io 官方仓库 (https://github.com/jgraph/drawio-mcp) 提供了两个独立的 MCP 服务：

|          | mcp-tool-server                | mcp-app-server                                                        |
| -------- | ------------------------------ | --------------------------------------------------------------------- |
| 路径     | `mcp-tool-server/src/index.js` | `mcp-app-server/src/index.js` + `shared.js`                           |
| 协议     | 标准 MCP Tool                  | MCP Tool + **MCP Apps 扩展**                                          |
| 核心依赖 | `@modelcontextprotocol/sdk`    | `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps` ^1.1.2 |
| 渲染方式 | 返回 XML 文本 / 打开浏览器     | sandboxed iframe 内联渲染                                             |
| 流式支持 | 无                             | 支持 `ontoolinputpartial` 流式渐进渲染                                |
| 托管地址 | 无公共端点                     | `https://mcp.draw.io/mcp`                                             |
| 部署方式 | Node.js                        | Node.js (Express) 或 Cloudflare Workers                               |

### 2.2 mcp-app-server 关键实现 (shared.js)

`shared.js` 约 1200 行 JS，核心导出:

```
createServer(html, options)
├── 注册 Tool: create_diagram (接收 mxGraphModel XML)
├── 注册 App Resource: ui:// 资源 (自包含 HTML 页面)
└── HTML 内嵌:
    ├── MCP Apps SDK browser bundle (~319KB, 处理 postMessage 通信)
    ├── pako_deflate.min.js (~28KB, XML 压缩)
    └── draw.io viewer (运行时从 CDN 加载)
```

关键函数:

- `buildHtml(appWithDepsJs, pakoDeflateJs, options)` — 构建自包含 HTML
- `processAppBundle(raw)` — 剥离 ESM export，创建 App 变量别名 (绕过 sandbox 限制)
- `healPartialXml(partialXml)` — 修复 LLM 流式生成的残缺 XML
- `streamMergeXmlDelta(graph, pendingEdges, xmlNode)` — 增量合并新 cell 到画布
- `streamFollowNewCells(graph)` — 平滑动画跟随新元素 (lerp 插值)

### 2.3 claude.ai 前端实际渲染的 DOM 结构

从 claude.ai 页面抓取的实际 HTML:

```html
<div id="mcp-app-container-toolu_016ZLdaLzPcq8evMJz7MmSFJ" class="w-full">
  <div class="h-full w-full">
    <iframe
      sandbox="allow-scripts allow-same-origin allow-forms"
      allow="fullscreen *; clipboard-write *"
      src="https://{content-hash}.claudemcpcontent.com/mcp_apps
           ?connect-src=https://esm.sh+https://cdnjs.cloudflare.com+...
           &resource-src=https://esm.sh+...+https://assets.claude.ai
           &dev=true"
      style="width: 100%; border: none; background-color: transparent; height: 805px;"
    >
    </iframe>
  </div>
</div>
```

关键观察:

- **容器 ID**: `mcp-app-container-{tool_use_id}` — 按 tool call ID 隔离
- **HTML 托管域**: `{content-hash}.claudemcpcontent.com` — Anthropic 安全 CDN，内容哈希作子域名
- **Sandbox 权限**: `allow-scripts allow-same-origin allow-forms`
- **iframe 权限**: `fullscreen *; clipboard-write *`
- **CSP 通过 URL 参数传递**: `connect-src` 和 `resource-src` 白名单
- **高度动态调整**: `height: 805px` 由 iframe 内容通过 postMessage 通知宿主

---

## 3. MCP Apps 协议详解

### 3.1 基本信息

- **全称**: MCP Apps Extension
- **扩展 ID**: `io.modelcontextprotocol/ui`
- **规范编号**: SEP-1865
- **规范发布日期**: 2026-01-26
- **参与方**: Anthropic + OpenAI 联合设计
- **官方仓库**: https://github.com/modelcontextprotocol/ext-apps
- **官方文档**: https://modelcontextprotocol.io/extensions/apps/overview
- **API 文档**: https://apps.extensions.modelcontextprotocol.io/api/

### 3.2 三角色架构

```
┌──────────────────────────────────────────────────────────┐
│  Host（聊天客户端）                                        │
│                                                           │
│  ┌────────────┐    postMessage/JSON-RPC   ┌────────────┐ │
│  │   Server    │◄──── Host 代理转发 ────►│    View     │ │
│  │  (MCP服务)  │                          │ (sandboxed  │ │
│  │            │                          │   iframe)   │ │
│  └────────────┘                          └────────────┘ │
│    stdio / HTTP                           HTML/JS/CSS    │
└──────────────────────────────────────────────────────────┘
```

- **Server**: 标准 MCP 服务，注册 Tool + UI Resource
- **Host**: 聊天客户端，创建 iframe，做消息代理
- **View**: iframe 里运行的 HTML 页面

### 3.3 完整协议流程

```
1. 连接阶段
   Host ──► Server: MCP initialize (声明支持 io.modelcontextprotocol/ui)
   Server ──► Host: 返回 tool 列表，其中带 UI 的 tool 有 _meta.ui.resourceUri

2. Tool 调用阶段
   LLM 决定调用 tool
   Host: 检测 _meta.ui.resourceUri = "ui://xxx"
   Host ──► Server: 请求 ui:// 资源，获取 HTML
   Host: 创建 sandboxed iframe，加载 HTML
   Host: 缓冲消息直到 iframe 就绪

3. 消息转发阶段 (postMessage JSON-RPC)
   Host ──► iframe: ontoolinputpartial (LLM 流式输出的部分内容)
   Host ──► iframe: ontoolinput (完整 tool 输入)
   Host ──► iframe: ontoolresult (tool 执行结果)
   iframe ──► Host: tools/call (App 反向调用其他 MCP Tool)
   iframe ──► Host: context update (更新 LLM 上下文)
   iframe ──► Host: resize / fullscreen / openLink 等 UI 事件

4. 生命周期管理
   Host: 监听 iframe postMessage，处理 resize
   Host: 对话滚动时管理 iframe 可见性
   Host: 页面离开时销毁 iframe
```

### 3.4 优雅降级机制

MCP Apps 设计为渐进增强:

- Server 在连接时检测客户端是否声明了 UI capability
- **支持 UI**: 注册带 `_meta.ui` 的 tool，返回交互式 UI
- **不支持 UI**: 退回普通 tool，只返回文本
- 同一 Server 两种场景都能工作

---

## 4. 客户端集成方案

### 4.1 两条集成路径

#### 路径 A: `@mcp-ui/client` (React 组件)

- **仓库**: https://github.com/MCP-UI-Org/mcp-ui
- **文档**: https://mcpui.dev/
- **适用**: React 技术栈的客户端
- **特点**: 开箱即用的 React 组件，封装了 iframe 管理 + postMessage 代理 + 安全策略

#### 路径 B: `AppBridge` (框架无关)

- **来源**: `@modelcontextprotocol/ext-apps` SDK 内置模块
- **文档**: https://apps.extensions.modelcontextprotocol.io/api/modules/app-bridge.html
- **示例**: https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host
- **适用**: 任何技术栈
- **特点**: 底层 API，需要自己包装 UI 组件

### 4.2 客户端需要实现的工作清单

|   序号   | 工作项           | 说明                                                         |  预估代码量 |
| :------: | ---------------- | ------------------------------------------------------------ | ----------: |
|    1     | Capability 协商  | MCP 连接时声明支持 `io.modelcontextprotocol/ui`              |      ~20 行 |
|    2     | UI Tool 识别     | 检测 tool 描述中的 `_meta.ui.resourceUri`                    |      ~30 行 |
|    3     | UI Resource 获取 | 向 Server 请求 `ui://` 资源，拿到 HTML                       |      ~50 行 |
|    4     | iframe 容器管理  | 创建 sandboxed iframe，设置 CSP，处理 resize/fullscreen/销毁 |     ~200 行 |
|    5     | postMessage 代理 | Server ↔ Host ↔ iframe 之间转发 JSON-RPC 消息                |     ~150 行 |
|    6     | 消息缓冲队列     | iframe 未就绪时缓冲消息，就绪后回放                          |      ~50 行 |
| **合计** |                  | **核心协议层**                                               | **~500 行** |

### 4.3 当前已支持 MCP Apps 的客户端

| 客户端                      |  支持状态   |
| --------------------------- | :---------: |
| Claude (claude.ai 网页版)   |     ✅      |
| Claude Desktop              |     ✅      |
| VS Code GitHub Copilot      |     ✅      |
| Goose                       |     ✅      |
| Postman                     |     ✅      |
| MCPJam                      |     ✅      |
| Claude Code (CLI / VS Code) | ❌ 尚未支持 |

---

## 5. 风险评估

### 5.1 CSP (内容安全策略) 冲突 — 高风险

如果宿主页面有严格的 CSP header (`frame-src 'none'`、`script-src 'self'` 等)，MCP Apps 需要:

- `frame-src` 允许 blob: 或 data: URI
- iframe 内部加载外部 CDN (esm.sh, cdnjs, jsdelivr, unpkg)
- `connect-src` 放行 MCP Server 域名

**改 CSP 可能影响整站安全策略，需要安全团队审批。**

### 5.2 iframe 与宿主 UI 交互冲突 — 中风险

| 问题场景                    | 后果                                        |
| --------------------------- | ------------------------------------------- |
| iframe 内部滚动 vs 页面滚动 | 滚轮事件被 iframe 吞掉                      |
| iframe 高度动态变化         | 聊天消息列表的虚拟滚动 / 自动滚底逻辑被打乱 |
| 多个 MCP App 同时存在       | 长对话堆积多个 iframe，内存持续增长         |
| 键盘快捷键冲突              | 焦点在 iframe 内时宿主快捷键全部失效        |
| 移动端触摸事件              | iframe 的 touch 处理和外层手势冲突          |

### 5.3 流式渲染时序问题 — 中风险

- iframe 未加载完毕时 Host 已开始转发 `ontoolinputpartial` → 消息丢失
- 需要实现消息缓冲队列 + iframe ready 握手机制
- AppBridge 处理了部分，但网络慢 / iframe 超时等边界情况需要额外兜底

### 5.4 安全风险 — 需要评估

MCP Apps 本质是执行第三方 MCP Server 提供的任意 HTML/JS:

- sandbox 能防住大部分攻击
- 如果使用 `allow-same-origin`（claude.ai 使用了），风险上升
- Anthropic 用 `{hash}.claudemcpcontent.com` 隔离域兜底
- **自有客户端需要考虑是否有类似的隔离域基础设施**

### 5.5 各技术栈适配难度

| 客户端技术栈             | 适配难度 | 说明                                       |
| ------------------------ | :------: | ------------------------------------------ |
| React SPA                |    低    | `@mcp-ui/client` 直接用                    |
| Vue / Svelte / Angular   |    中    | 用 AppBridge，自行封装组件                 |
| Electron 桌面应用        |    中    | webview 内嵌 iframe，注意双层嵌套          |
| 终端 CLI                 |  不可能  | 没有 DOM，只能降级为文本                   |
| Flutter / Swift / Kotlin |    高    | 需要 WebView 组件 + postMessage 桥接原生层 |

---

## 6. 建议的实施路线

```
阶段 1: 验证可行性 (1-2 天)
  └─ 拉取 ext-apps 仓库，跑通 basic-host 示例
  └─ 连接 draw.io app server (https://mcp.draw.io/mcp) 验证渲染

阶段 2: 最小化集成 (3-5 天)
  └─ 在目标客户端中引入 AppBridge 或 @mcp-ui/client
  └─ 实现 capability 协商 + iframe 容器 + postMessage 代理
  └─ 用 feature flag 控制，默认关闭

阶段 3: 生产化 (1-2 周)
  └─ CSP 策略适配
  └─ iframe 生命周期管理 (内存、resize、滚动)
  └─ 安全隔离方案 (是否需要独立域名托管 HTML)
  └─ 流式渲染边界情况处理
  └─ 移动端适配
  └─ 灰度发布验证
```

---

## 7. 关键参考资源

| 资源                    | 地址                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| MCP Apps 官方文档       | https://modelcontextprotocol.io/extensions/apps/overview                                     |
| MCP Apps 规范           | https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx |
| ext-apps SDK 仓库       | https://github.com/modelcontextprotocol/ext-apps                                             |
| AppBridge API 文档      | https://apps.extensions.modelcontextprotocol.io/api/modules/app-bridge.html                  |
| @mcp-ui/client (React)  | https://mcpui.dev/                                                                           |
| basic-host 示例         | https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host               |
| draw.io MCP 仓库        | https://github.com/jgraph/drawio-mcp                                                         |
| draw.io app-server 源码 | `mcp-app-server/src/shared.js` (~1200 行，核心渲染逻辑)                                      |
| draw.io 托管端点        | https://mcp.draw.io/mcp                                                                      |
| MCP Blog - Apps 发布    | https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/                              |

---

## 8. 待继续讨论

- [ ] 拉取实际项目仓库代码后，评估具体技术栈的适配方案
- [ ] 确认项目现有的 CSP 策略
- [ ] 确认是否需要支持移动端
- [ ] 确认安全隔离方案（是否需要独立域名）
- [ ] 评估除 draw.io 之外还需要支持哪些 MCP Apps
