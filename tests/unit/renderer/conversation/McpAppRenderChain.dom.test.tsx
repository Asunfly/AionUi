import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageToolGroup } from '@/common/chat/chatLib';
import type { IMcpServer } from '@/common/config/storage';

const readUiResourceInvokeMock = vi.fn();
const callMcpToolInvokeMock = vi.fn();
const getConfigMock = vi.fn();
const teardownResourceMock = vi.fn();

let hostConnected = false;

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

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => getConfigMock(...args),
  },
}));

vi.mock('@renderer/hooks/mcp/useMcpAppsConfig', () => ({
  getMcpAppTrustKey: (server: { name: string }) => server.name,
  useMcpAppsConfig: () => ({
    enabled: true,
    trustList: ['drawio'],
    loaded: true,
    setEnabled: vi.fn(),
    addTrust: vi.fn(),
    removeTrust: vi.fn(),
    isServerTrusted: () => true,
  }),
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

import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

describe('MCP app render chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostConnected = false;

    readUiResourceInvokeMock.mockResolvedValue({
      success: true,
      data: {
        html: '<html><head></head><body><div id="app">drawio</div></body></html>',
      },
    });

    callMcpToolInvokeMock.mockResolvedValue({ success: true, data: { content: [] } });

    getConfigMock.mockImplementation(async (key: string) => {
      if (key === 'mcp.config') {
        return [
          {
            id: 'drawio-id',
            name: 'drawio',
            enabled: true,
            transport: { type: 'http', url: 'https://mcp.draw.io/mcp' },
            tools: [
              {
                name: 'create_diagram',
                description: 'Create a diagram',
                _meta: {
                  ui: {
                    resourceUri: 'ui://drawio/app.html',
                  },
                },
              },
            ],
            createdAt: 1,
            updatedAt: 1,
            originalJson: '{}',
          } satisfies IMcpServer,
        ];
      }

      return null;
    });

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
    vi.unstubAllGlobals();
  });

  it('renders the summarized MCP app through the real container and starts the bridge before iframe load', async () => {
    const message: IMessageToolGroup = {
      id: 'msg-chain-1',
      msg_id: 'msg-chain-1',
      conversation_id: 'conv-1',
      type: 'tool_group',
      content: [
        {
          callId: 'call-chain-1',
          name: 'drawio/create_diagram',
          description: '{"xml":"<mxGraphModel id=\"chain\" />"}',
          renderOutputAsMarkdown: false,
          resultDisplay: 'diagram created through the summarized chain',
          status: 'Success',
        },
      ],
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    await waitFor(() => {
      expect(readUiResourceInvokeMock).toHaveBeenCalledWith({
        serverName: 'drawio',
        resourceUri: 'ui://drawio/app.html',
        transport: { type: 'http', url: 'https://mcp.draw.io/mcp' },
      });
    });

    await waitFor(() => {
      expect(hostConnected).toBe(true);
    });

    const iframe = await screen.findByTitle('MCP App: drawio');

    expect(iframe).toHaveAttribute('src', 'blob:test-url');
  });
});
