import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readUiResourceInvokeMock = vi.fn();
const callMcpToolInvokeMock = vi.fn();
const sendToolInputMock = vi.fn();
const sendToolResultMock = vi.fn();
const teardownResourceMock = vi.fn();
const createObjectUrlMock = vi.fn();
const revokeObjectUrlMock = vi.fn();

let shouldAutoInitialize = true;
let activeBridge:
  | {
      oninitialized?: () => void;
      onsizechange?: (params: { width?: number; height?: number }) => void;
    }
  | null = null;
let hostConnected = false;

const simulateAppInitializeAttempt = () => {
  if (!hostConnected || !activeBridge) {
    return;
  }

  activeBridge.oninitialized?.();
};

const simulateAppResize = (params: { width?: number; height?: number }) => {
  activeBridge?.onsizechange?.(params);
};

vi.mock('@/common', () => ({
  ipcBridge: {
    mcpService: {
      readUiResource: {
        invoke: (...args: unknown[]) => readUiResourceInvokeMock(...args),
      },
      callMcpTool: {
        invoke: (...args: unknown[]) => callMcpToolInvokeMock(...args),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@modelcontextprotocol/ext-apps/app-bridge', () => {
  class MockAppBridge {
    onsizechange?: (params: { height?: number }) => void;
    onopenlink?: (params: { url: string }) => Promise<Record<string, never>>;
    onrequestteardown?: () => void;
    oncalltool?: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
    oninitialized?: () => void;

    constructor(..._args: unknown[]) {}

    async connect(..._args: unknown[]) {
      hostConnected = true;
      activeBridge = this;

      if (shouldAutoInitialize) {
        this.oninitialized?.();
      }
    }

    async sendToolInput(params: unknown) {
      sendToolInputMock(params);
    }

    async sendToolResult(params: unknown) {
      sendToolResultMock(params);
    }

    async teardownResource(params: unknown) {
      teardownResourceMock(params);
    }
  }

  class MockPostMessageTransport {
    constructor(..._args: unknown[]) {}
  }

  return {
    AppBridge: MockAppBridge,
    PostMessageTransport: MockPostMessageTransport,
  };
});

import McpAppContainer, {
  __resetMcpAppContainerCachesForTest,
} from '@/renderer/pages/conversation/Messages/codex/ToolCallComponent/McpAppContainer';

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('McpAppContainer init timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetMcpAppContainerCachesForTest();
    shouldAutoInitialize = true;
    activeBridge = null;
    hostConnected = false;

    readUiResourceInvokeMock.mockResolvedValue({
      success: true,
      data: {
        html: '<html><head></head><body><div id="app">ok</div></body></html>',
      },
    });

    callMcpToolInvokeMock.mockResolvedValue({ success: true, data: { content: [] } });

    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: createObjectUrlMock.mockImplementation(() => 'blob:test-url'),
        revokeObjectURL: revokeObjectUrlMock,
      })
    );

    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get() {
        return window;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('deduplicates identical UI resource reads across concurrent containers', async () => {
    render(
      <>
        <McpAppContainer
          serverName='drawio'
          resourceUri='ui://drawio/mcp-app.html'
          transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        />
        <McpAppContainer
          serverName='drawio'
          resourceUri='ui://drawio/mcp-app.html'
          transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        />
      </>
    );

    await flushPromises();
    await flushPromises();

    expect(readUiResourceInvokeMock).toHaveBeenCalledTimes(1);
  });

  it('remounts with a compact shell instead of restoring the previous measured size', async () => {
    const firstRender = render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        toolArguments={{ xml: '<mxGraphModel id="remember" />' }}
      />
    );

    await flushPromises();
    await flushPromises();

    act(() => {
      simulateAppResize({ width: 1200, height: 760 });
    });

    firstRender.unmount();

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        toolArguments={{ xml: '<mxGraphModel id="remember" />' }}
      />
    );

    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio') as HTMLIFrameElement;

    expect(Number.parseInt(iframe.style.height, 10)).toBe(300);
    expect(iframe.style.width).toBe('100%');
  });

  it('reuses the same blob URL when the identical UI resource remounts', async () => {
    const firstRender = render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    firstRender.unmount();

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(readUiResourceInvokeMock).toHaveBeenCalledTimes(1);
  });

  it('does not show timeout after the app initializes successfully', async () => {
    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        toolArguments={{ xml: '<mxGraphModel />' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio');
    fireEvent.load(iframe);

    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });

    expect(screen.queryByText('mcp.apps.initTimeout')).not.toBeInTheDocument();
  });

  it('sends tool input and tool result once the app initializes', async () => {
    shouldAutoInitialize = false;

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        toolArguments={{ xml: '<mxGraphModel id="bridge" />' }}
        toolResult='diagram created through bridge'
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio');

    act(() => {
      simulateAppInitializeAttempt();
    });

    fireEvent.load(iframe);

    await flushPromises();

    expect(sendToolInputMock).toHaveBeenCalledWith({
      arguments: { xml: '<mxGraphModel id="bridge" />' },
    });
    expect(sendToolResultMock).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'diagram created through bridge' }],
    });
  });

  it('caps shell height to the available viewport instead of letting the host grow indefinitely', async () => {
    shouldAutoInitialize = false;
    vi.stubGlobal('innerHeight', 620);
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 120,
      top: 120,
      left: 0,
      right: 800,
      bottom: 520,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    });

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio') as HTMLIFrameElement;
    const scrollShell = screen.getByTestId('mcp-app-scroll-shell') as HTMLDivElement;

    act(() => {
      simulateAppResize({ height: 1200 });
    });

    expect(Number.parseInt(scrollShell.style.maxHeight, 10)).toBeLessThan(800);
    expect(Number.parseInt(iframe.style.height, 10)).toBeGreaterThan(Number.parseInt(scrollShell.style.maxHeight, 10));
  });

  it('expands iframe width to match wide app content', async () => {
    shouldAutoInitialize = false;

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio') as HTMLIFrameElement;

    act(() => {
      simulateAppResize({ width: 1400 });
    });

    expect(iframe.style.width).toBe('1400px');
  });

  it('uses the reported height for small visualizations', async () => {
    shouldAutoInitialize = false;
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 140,
      top: 140,
      left: 0,
      right: 800,
      bottom: 540,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    });

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio') as HTMLIFrameElement;
    const scrollShell = screen.getByTestId('mcp-app-scroll-shell') as HTMLDivElement;

    act(() => {
      simulateAppResize({ width: 800, height: 400 });
    });

    expect(Number.parseInt(iframe.style.height, 10)).toBe(400);
    expect(Number.parseInt(iframe.style.height, 10)).toBeLessThanOrEqual(Number.parseInt(scrollShell.style.maxHeight, 10));
    expect(scrollShell.style.overflowY).toBe('auto');
    expect(scrollShell.style.overflowX).toBe('auto');
  });

  it('does not inflate the initial height of a wide visualization', async () => {
    shouldAutoInitialize = false;
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 140,
      top: 140,
      left: 0,
      right: 800,
      bottom: 540,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    });

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio') as HTMLIFrameElement;

    act(() => {
      simulateAppResize({ width: 1400, height: 400 });
    });

    expect(Number.parseInt(iframe.style.height, 10)).toBe(400);
  });

  it('caps shell growth for oversized visualizations instead of expanding indefinitely', async () => {
    shouldAutoInitialize = false;
    vi.stubGlobal('innerHeight', 1200);
    vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 120,
      top: 120,
      left: 0,
      right: 800,
      bottom: 520,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    });

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio') as HTMLIFrameElement;
    const scrollShell = screen.getByTestId('mcp-app-scroll-shell') as HTMLDivElement;

    act(() => {
      simulateAppResize({ width: 1600, height: 4000 });
    });

    expect(Number.parseInt(scrollShell.style.maxHeight, 10)).toBeLessThan(1000);
    expect(Number.parseInt(iframe.style.height, 10)).toBeLessThanOrEqual(1600);
  });

  it('does not lose initialize messages sent before the iframe load event', async () => {
    shouldAutoInitialize = false;

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
        toolArguments={{ xml: '<mxGraphModel />' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio');

    act(() => {
      simulateAppInitializeAttempt();
    });

    fireEvent.load(iframe);

    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(16_000);
    });

    expect(screen.queryByText('mcp.apps.initTimeout')).not.toBeInTheDocument();
  });

  it('shows timeout when the app never initializes', async () => {
    shouldAutoInitialize = false;

    render(
      <McpAppContainer
        serverName='drawio'
        resourceUri='ui://drawio/mcp-app.html'
        transport={{ type: 'http', url: 'https://mcp.draw.io/mcp' }}
      />
    );

    await flushPromises();
    await flushPromises();

    const iframe = screen.getByTitle('MCP App: drawio');
    fireEvent.load(iframe);

    act(() => {
      vi.advanceTimersByTime(16_000);
    });

    expect(screen.getByText('mcp.apps.initTimeout')).toBeInTheDocument();
  });
});
