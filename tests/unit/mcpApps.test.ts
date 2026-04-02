/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IMcpTool, McpToolUiMeta } from '../../src/common/config/storage';

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
