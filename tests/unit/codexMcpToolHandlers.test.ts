/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '../../src/common/adapter/ipcBridge';
import { CodexToolHandlers } from '../../src/process/agent/codex/handlers/CodexToolHandlers';
import { ConfigStorage } from '../../src/common/config/storage';
import { mcpService } from '../../src/process/services/mcpServices/McpService';
import type { ICodexMessageEmitter } from '../../src/process/agent/codex/messaging/CodexMessageEmitter';

class TestEmitter implements ICodexMessageEmitter {
  public messages: IResponseMessage[] = [];

  emitAndPersistMessage(message: IResponseMessage): void {
    this.messages.push(message);
  }

  persistMessage(): void {}

  addConfirmation(): void {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CodexToolHandlers MCP tool call lifecycle', () => {
  it('keeps begin and end updates on the same toolCallId for MCP app tools', async () => {
    vi.spyOn(ConfigStorage, 'get').mockResolvedValue([
      {
        id: 'drawio-id',
        name: 'drawio',
        enabled: true,
        transport: { type: 'http', url: 'https://mcp.draw.io/mcp' },
        tools: [
          {
            name: 'create_diagram',
            _meta: { ui: { resourceUri: 'ui://drawio/mcp-app.html' } },
          },
        ],
        createdAt: 1,
        updatedAt: 1,
        originalJson: '{}',
      },
    ] as never);
    vi.spyOn(mcpService, 'testMcpConnection').mockResolvedValue({ success: true, tools: [] });

    const emitter = new TestEmitter();
    const handlers = new CodexToolHandlers('conv-1', emitter);

    handlers.handleMcpToolCallBegin({
      type: 'mcp_tool_call_begin',
      invocation: {
        server: 'drawio',
        tool: 'create_diagram',
        arguments: { xml: '<mxGraphModel />' },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.handleMcpToolCallEnd({
      type: 'mcp_tool_call_end',
      invocation: {
        server: 'drawio',
        tool: 'create_diagram',
        arguments: { xml: '<mxGraphModel />' },
      },
      result: { ok: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitter.messages).toHaveLength(2);
    const beginMsg = emitter.messages[0];
    const endMsg = emitter.messages[1];

    expect(beginMsg.type).toBe('codex_tool_call');
    expect(endMsg.type).toBe('codex_tool_call');
    expect(beginMsg.data.toolCallId).toBe(endMsg.data.toolCallId);
    expect(beginMsg.data.data.uiMeta).toEqual({ resourceUri: 'ui://drawio/mcp-app.html' });
    expect(endMsg.data.data.uiMeta).toEqual({ resourceUri: 'ui://drawio/mcp-app.html' });
    expect(endMsg.data.data.serverName).toBe('drawio');
  });
});
