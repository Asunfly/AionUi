/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smoke test: Connects to the draw.io MCP app server and verifies
 * the MCP Apps protocol works end-to-end (capability negotiation,
 * tool listing with _meta.ui, UI resource fetching).
 *
 * Requires network access to https://mcp.draw.io/mcp
 *
 * Run: bunx vitest run tests/smoke/mcpAppsDrawio.smoke.test.ts
 */

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DRAWIO_MCP_URL = 'https://mcp.draw.io/mcp';
const CONNECT_TIMEOUT = 15_000;

describe('draw.io MCP Apps smoke test', { timeout: 30_000 }, () => {
  let client: Client;

  it('connects to draw.io MCP server with UI capability', async () => {
    client = new Client(
      { name: 'AionUi-SmokeTest', version: '1.0.0' },
      {
        capabilities: {
          sampling: {},
          experimental: {
            'io.modelcontextprotocol/ui': {},
          },
        },
      }
    );

    const transport = new StreamableHTTPClientTransport(new URL(DRAWIO_MCP_URL));

    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), CONNECT_TIMEOUT)),
    ]);

    // If we got here, connection succeeded
    expect(client).toBeDefined();
  });

  it('lists tools containing create_diagram with _meta.ui', async () => {
    const result = await client.listTools();

    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);

    // Find the create_diagram tool
    const createDiagram = result.tools.find((t) => t.name === 'create_diagram');
    expect(createDiagram).toBeDefined();
    expect(createDiagram!.description).toBeDefined();

    // Verify it has _meta.ui (MCP Apps extension)
    const meta = createDiagram!._meta as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();

    const ui = meta?.ui as Record<string, unknown> | undefined;
    expect(ui).toBeDefined();
    expect(ui?.resourceUri).toBeDefined();
    expect(String(ui?.resourceUri)).toMatch(/^ui:\/\//);

    console.log('[smoke] create_diagram _meta.ui:', JSON.stringify(ui, null, 2));
  });

  it('fetches the UI resource HTML', async () => {
    const toolsResult = await client.listTools();
    const createDiagram = toolsResult.tools.find((t) => t.name === 'create_diagram');
    const ui = (createDiagram!._meta as Record<string, unknown>)?.ui as Record<string, unknown>;
    const resourceUri = String(ui.resourceUri);

    const resource = await client.readResource({ uri: resourceUri });

    expect(resource.contents).toBeDefined();
    expect(resource.contents.length).toBeGreaterThan(0);

    const content = resource.contents[0];
    expect('text' in content).toBe(true);

    const html = (content as { text: string }).text;
    expect(html).toContain('<');
    expect(html.length).toBeGreaterThan(100);

    console.log(`[smoke] UI resource HTML length: ${html.length} chars`);
    console.log(`[smoke] First 200 chars: ${html.substring(0, 200)}`);
  });

  it('cleans up connection', async () => {
    if (client) {
      await client.close();
    }
  });
});
