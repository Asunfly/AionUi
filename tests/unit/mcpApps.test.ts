/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer, IMcpTool, McpToolUiMeta } from '../../src/common/config/storage';
import { getMcpAppRenderState } from '../../src/renderer/pages/conversation/Messages/mcp';
import { AbstractMcpAgent } from '../../src/process/services/mcpServices/McpProtocol';

describe('McpToolUiMeta type and IMcpTool _meta.ui', () => {
  it('IMcpTool without _meta works unchanged', () => {
    const tool: IMcpTool = { name: 'list_files', description: 'Lists files' };
    expect(tool._meta).toBeUndefined();
  });

  it('IMcpTool with _meta.ui stores resource URI', () => {
    const tool: IMcpTool = {
      name: 'create_diagram',
      description: 'Create a diagram',
      _meta: {
        ui: {
          resourceUri: 'ui://drawio/view.html',
          csp: {
            connectDomains: ['https://esm.sh'],
            resourceDomains: ['https://cdnjs.cloudflare.com'],
          },
        },
      },
    };

    expect(tool._meta?.ui?.resourceUri).toBe('ui://drawio/view.html');
    expect(tool._meta?.ui?.csp?.connectDomains).toContain('https://esm.sh');
  });

  it('McpToolUiMeta type enforces required resourceUri', () => {
    const meta: McpToolUiMeta = { resourceUri: 'ui://test/app.html' };
    expect(meta.resourceUri).toBe('ui://test/app.html');
    expect(meta.csp).toBeUndefined();
  });

  it('McpToolUiMeta with full CSP', () => {
    const meta: McpToolUiMeta = {
      resourceUri: 'ui://map-server/map.html',
      csp: {
        connectDomains: ['https://api.mapbox.com', 'https://tiles.mapbox.com'],
        resourceDomains: ['https://cdn.mapbox.com'],
        frameDomains: [],
      },
    };

    expect(meta.csp?.connectDomains).toHaveLength(2);
    expect(meta.csp?.resourceDomains).toHaveLength(1);
    expect(meta.csp?.frameDomains).toHaveLength(0);
  });
});

describe('extractToolMetadata preserves _meta.ui', () => {
  // Simulate what McpProtocol.extractToolMetadata does
  function extractToolMetadata(
    sdkTools: Array<{ name: string; description?: string; _meta?: Record<string, unknown> }>
  ): IMcpTool[] {
    return sdkTools.map((tool) => {
      const base: IMcpTool = { name: tool.name, description: tool.description };
      const uiMeta = (tool._meta as Record<string, unknown>)?.ui;
      if (uiMeta && typeof uiMeta === 'object') {
        base._meta = { ui: uiMeta as McpToolUiMeta };
      }
      return base;
    });
  }

  it('passes through tools without _meta', () => {
    const tools = extractToolMetadata([{ name: 'basic_tool', description: 'A basic tool' }]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('basic_tool');
    expect(tools[0]._meta).toBeUndefined();
  });

  it('preserves _meta.ui from SDK tools', () => {
    const tools = extractToolMetadata([
      {
        name: 'create_diagram',
        description: 'Creates a diagram',
        _meta: {
          ui: {
            resourceUri: 'ui://drawio/view.html',
            csp: { connectDomains: ['https://esm.sh'] },
          },
        },
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0]._meta?.ui?.resourceUri).toBe('ui://drawio/view.html');
    expect(tools[0]._meta?.ui?.csp?.connectDomains).toEqual(['https://esm.sh']);
  });

  it('ignores _meta without ui field', () => {
    const tools = extractToolMetadata([
      {
        name: 'tool_with_other_meta',
        _meta: { visibility: ['model'] },
      },
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0]._meta).toBeUndefined();
  });

  it('handles mixed tools (with and without UI)', () => {
    const tools = extractToolMetadata([
      { name: 'tool_a' },
      { name: 'tool_b', _meta: { ui: { resourceUri: 'ui://app/b.html' } } },
      { name: 'tool_c', description: 'No UI' },
    ]);

    expect(tools).toHaveLength(3);
    expect(tools[0]._meta).toBeUndefined();
    expect(tools[1]._meta?.ui?.resourceUri).toBe('ui://app/b.html');
    expect(tools[2]._meta).toBeUndefined();
  });
});

describe('getMcpAppRenderState', () => {
  it('shows an enable prompt before rendering when MCP Apps are disabled', () => {
    expect(
      getMcpAppRenderState({
        hasUiMeta: true,
        enabled: false,
        hasServerConfig: true,
        trusted: false,
      })
    ).toBe('enable_prompt');
  });

  it('shows a trust prompt when interactive UI is available but not trusted yet', () => {
    expect(
      getMcpAppRenderState({
        hasUiMeta: true,
        enabled: true,
        hasServerConfig: true,
        trusted: false,
      })
    ).toBe('trust_prompt');
  });

  it('renders the MCP app once UI metadata, toggle, and trust are all present', () => {
    expect(
      getMcpAppRenderState({
        hasUiMeta: true,
        enabled: true,
        hasServerConfig: true,
        trusted: true,
      })
    ).toBe('render');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

class TestMcpAgent extends AbstractMcpAgent {
  public streamableCalls: Array<{ url: string; headers?: Record<string, string> }> = [];

  constructor() {
    super('aionui');
  }

  detectMcpServers() {
    return Promise.resolve([]);
  }

  installMcpServers() {
    return Promise.resolve({ success: true });
  }

  removeMcpServer() {
    return Promise.resolve({ success: true });
  }

  getSupportedTransports() {
    return ['http'];
  }

  exposeTestHttpConnection(transport: { url: string; headers?: Record<string, string> }) {
    return this.testHttpConnection(transport);
  }

  protected override testStreamableHttpConnection(transport: { url: string; headers?: Record<string, string> }) {
    this.streamableCalls.push(transport);
    return Promise.resolve({
      success: true,
      tools: [{ name: 'create_diagram', _meta: { ui: { resourceUri: 'ui://drawio/mcp-app.html' } } }],
    });
  }
}

describe('AbstractMcpAgent testHttpConnection', () => {
  it('delegates successful HTTP probes to the streamable HTTP transport', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { capabilities: { tools: { listChanged: true } } },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'mcp-session-id': 'session-123',
          },
        }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const agent = new TestMcpAgent();
    const result = await agent.exposeTestHttpConnection({ url: 'https://mcp.draw.io/mcp' });

    expect(result.success).toBe(true);
    expect(agent.streamableCalls).toEqual([{ url: 'https://mcp.draw.io/mcp' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0]._meta?.ui?.resourceUri).toBe('ui://drawio/mcp-app.html');
  });
});
