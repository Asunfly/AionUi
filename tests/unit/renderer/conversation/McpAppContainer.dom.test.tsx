import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readUiResourceInvokeMock = vi.fn();
const callMcpToolInvokeMock = vi.fn();
const sendToolInputMock = vi.fn();
const sendToolResultMock = vi.fn();
const teardownResourceMock = vi.fn();

let shouldAutoInitialize = true;
let activeBridge: { oninitialized?: () => void } | null = null;
let hostConnected = false;

const simulateAppInitializeAttempt = () => {
  if (!hostConnected || !activeBridge) {
    return;
  }

  activeBridge.oninitialized?.();
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

import McpAppContainer from '@/renderer/pages/conversation/Messages/codex/ToolCallComponent/McpAppContainer';

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('McpAppContainer init timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
        createObjectURL: vi.fn(() => 'blob:test-url'),
        revokeObjectURL: vi.fn(),
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
