import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import type { IMcpServer } from '@/common/config/storage';

const getConfigMock = vi.fn();
const isServerTrustedMock = vi.fn();

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => getConfigMock(...args),
  },
}));

vi.mock('@renderer/hooks/mcp/useMcpAppsConfig', () => ({
  useMcpAppsConfig: () => ({
    enabled: true,
    trustList: ['drawio-id'],
    loaded: true,
    setEnabled: vi.fn(),
    addTrust: vi.fn(),
    removeTrust: vi.fn(),
    isServerTrusted: isServerTrustedMock,
  }),
}));

vi.mock('@renderer/pages/conversation/Messages/codex/ToolCallComponent/McpAppContainer', () => ({
  default: ({
    serverName,
    resourceUri,
    toolArguments,
    toolResult,
  }: {
    serverName: string;
    resourceUri: string;
    toolArguments?: Record<string, unknown>;
    toolResult?: unknown;
  }) => (
    <div data-testid='mcp-app'>
      <span>{serverName}</span>
      <span>{resourceUri}</span>
      <span>{JSON.stringify(toolArguments)}</span>
      <span>{String(toolResult)}</span>
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

describe('MessageToolGroupSummary MCP Apps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isServerTrustedMock.mockReturnValue(true);
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an MCP app for Gemini tool_group entries when UI metadata is available', async () => {
    const message: IMessageToolGroup = {
      id: 'msg-1',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'tool_group',
      content: [
        {
          callId: 'call-1',
          name: 'drawio__create_diagram',
          description: '{"content":"产研开发流程图","format":"mermaid"}',
          renderOutputAsMarkdown: false,
          resultDisplay: 'diagram created',
          status: 'Success',
          confirmationDetails: {
            type: 'mcp',
            title: 'Confirm MCP Tool: create_diagram',
            serverName: 'drawio',
            toolName: 'create_diagram',
            toolDisplayName: 'create_diagram',
          },
        },
      ],
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-app')).toBeInTheDocument();
    });

    expect(screen.getByText('drawio')).toBeInTheDocument();
    expect(screen.getByText('ui://drawio/app.html')).toBeInTheDocument();
    expect(screen.getByText('{"content":"产研开发流程图","format":"mermaid"}')).toBeInTheDocument();
    expect(screen.getByText('diagram created')).toBeInTheDocument();
  });

  it('renders an MCP app when the tool name uses server slash tool format', async () => {
    const message: IMessageToolGroup = {
      id: 'msg-3',
      msg_id: 'msg-3',
      conversation_id: 'conv-1',
      type: 'tool_group',
      content: [
        {
          callId: 'call-3',
          name: 'drawio/create_diagram',
          description: '{"xml":"<mxGraphModel />"}',
          renderOutputAsMarkdown: false,
          resultDisplay: 'diagram created via slash format',
          status: 'Success',
        },
      ],
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-app')).toBeInTheDocument();
    });

    expect(screen.getByText('drawio')).toBeInTheDocument();
    expect(screen.getByText('ui://drawio/app.html')).toBeInTheDocument();
    expect(screen.getByText('{"xml":"<mxGraphModel />"}')).toBeInTheDocument();
    expect(screen.getByText('diagram created via slash format')).toBeInTheDocument();
  });

  it('renders an MCP app when the tool name includes a Tool prefix before server slash tool format', async () => {
    const message: IMessageToolGroup = {
      id: 'msg-4',
      msg_id: 'msg-4',
      conversation_id: 'conv-1',
      type: 'tool_group',
      content: [
        {
          callId: 'call-4',
          name: 'Tool: drawio/create_diagram',
          description: '{"xml":"<mxGraphModel id=\"tool-prefix\" />"}',
          renderOutputAsMarkdown: false,
          resultDisplay: 'diagram created via prefixed slash format',
          status: 'Success',
        },
      ],
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-app')).toBeInTheDocument();
    });

    expect(screen.getByText('drawio')).toBeInTheDocument();
    expect(screen.getByText('ui://drawio/app.html')).toBeInTheDocument();
    expect(screen.getByText('diagram created via prefixed slash format')).toBeInTheDocument();
  });

  it('renders an MCP app for summarized ACP tool calls when the title uses server slash tool format', async () => {
    const message: IMessageAcpToolCall = {
      id: 'acp-msg-1',
      msg_id: 'acp-msg-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'acp-call-1',
          status: 'completed',
          title: 'drawio/create_diagram',
          kind: 'execute',
          rawInput: { xml: '<mxGraphModel />' },
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'diagram created from summarized acp tool call',
              },
            },
          ],
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-app')).toBeInTheDocument();
    });

    expect(screen.getByText('drawio')).toBeInTheDocument();
    expect(screen.getByText('ui://drawio/app.html')).toBeInTheDocument();
    expect(screen.getByText('{"xml":"<mxGraphModel />"}')).toBeInTheDocument();
    expect(screen.getByText('diagram created from summarized acp tool call')).toBeInTheDocument();
  });

  it('renders an MCP app for summarized ACP tool calls when the title includes a Tool prefix', async () => {
    const message: IMessageAcpToolCall = {
      id: 'acp-msg-2',
      msg_id: 'acp-msg-2',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'acp-call-2',
          status: 'completed',
          title: 'Tool: drawio/create_diagram',
          kind: 'execute',
          rawInput: {
            server: 'drawio',
            tool: 'create_diagram',
            arguments: { xml: '<mxGraphModel id="acp-prefix" />' },
          },
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'diagram created from prefixed summarized acp tool call',
              },
            },
          ],
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-app')).toBeInTheDocument();
    });

    expect(screen.getByText('drawio')).toBeInTheDocument();
    expect(screen.getByText('ui://drawio/app.html')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-app').textContent).toContain('acp-prefix');
    expect(screen.getByText('diagram created from prefixed summarized acp tool call')).toBeInTheDocument();
  });

  it('does not render an MCP app when the summarized tool is not an MCP tool', async () => {
    const message: IMessageToolGroup = {
      id: 'msg-2',
      msg_id: 'msg-2',
      conversation_id: 'conv-1',
      type: 'tool_group',
      content: [
        {
          callId: 'call-2',
          name: 'ReadFile',
          description: '{"file_path":"README.md"}',
          renderOutputAsMarkdown: false,
          status: 'Success',
          resultDisplay: 'done',
        },
      ],
    };

    render(<MessageToolGroupSummary messages={[message]} />);

    expect(screen.queryByTestId('mcp-app')).not.toBeInTheDocument();
    expect(getConfigMock).not.toHaveBeenCalled();
  });
});
