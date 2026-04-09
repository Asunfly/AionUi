import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageToolGroup } from '@/common/chat/chatLib';
import MessageToolGroup from '@/renderer/pages/conversation/Messages/components/MessageToolGroup';

const { mockConfigGet } = vi.hoisted(() => ({
  mockConfigGet: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    geminiConversation: {
      confirmMessage: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => mockConfigGet(...args),
  },
}));

vi.mock('@/renderer/hooks/mcp/useMcpAppsConfig', () => ({
  useMcpAppsConfig: () => ({
    enabled: true,
    trustList: ['drawio'],
    loaded: true,
    setEnabled: vi.fn(),
    addTrust: vi.fn(),
    removeTrust: vi.fn(),
    isServerTrusted: (trustKey: string) => trustKey === 'drawio',
  }),
  getMcpAppTrustKey: (server: { name: string }) => server.name,
}));

vi.mock('@/renderer/pages/conversation/Messages/codex/ToolCallComponent/McpAppContainer', () => ({
  default: ({ serverName, resourceUri }: { serverName: string; resourceUri: string }) => (
    <div data-testid='mcp-app-container'>
      {serverName}:{resourceUri}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('MessageToolGroup MCP apps rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigGet.mockImplementation(async (key: string) => {
      if (key === 'mcp.config') {
        return [
          {
            id: 'drawio-id',
            name: 'drawio',
            enabled: true,
            transport: { type: 'http', url: 'https://example.com/mcp' },
            tools: [
              {
                name: 'create_diagram',
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
          },
        ];
      }

      return undefined;
    });
  });

  it('renders MCP Apps UI for tool_group entries with MCP metadata', async () => {
    const message: IMessageToolGroup = {
      id: 'message-1',
      msg_id: 'message-1',
      type: 'tool_group',
      position: 'left',
      conversation_id: 'conversation-1',
      content: [
        {
          callId: 'call-1',
          name: 'Create Diagram',
          description: 'Create a diagram',
          renderOutputAsMarkdown: false,
          status: 'Success',
          mcp: {
            serverName: 'drawio',
            toolName: 'create_diagram',
            toolDisplayName: 'Create Diagram',
          },
        },
      ],
    };

    render(<MessageToolGroup message={message} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-app-container')).toHaveTextContent('drawio:ui://drawio/app.html');
    });
  });
});
