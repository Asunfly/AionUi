/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';
import type { IMcpServer, McpToolUiMeta } from '@/common/config/storage';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getEnhancedEnv, resolveNpxPath } from '@/process/utils/shellEnv';

/** Expected MIME type for MCP App UI resources */
const MCP_APP_MIME_TYPE = 'text/html';

type McpUiResourceResult = {
  html: string;
  csp?: McpToolUiMeta['csp'];
};

type CachedConnection = {
  client: Client;
  createdAt: number;
};

/**
 * Service for MCP Apps UI resource fetching.
 *
 * Maintains persistent MCP client connections to fetch `ui://` resources
 * from MCP servers that declare the `io.modelcontextprotocol/ui` extension.
 */
export class McpAppsService {
  /** Persistent connections keyed by server name */
  private connections = new Map<string, CachedConnection>();
  /** Max age before reconnecting (5 minutes) */
  private readonly maxConnectionAge = 5 * 60 * 1000;

  /**
   * Read a UI resource from an MCP server.
   * Creates or reuses a persistent connection.
   */
  async readUiResource(
    serverName: string,
    resourceUri: string,
    transport: IMcpServer['transport']
  ): Promise<McpUiResourceResult> {
    const client = await this.getOrCreateClient(serverName, transport);

    const response = await client.readResource({ uri: resourceUri });
    const content = response.contents[0];

    if (!content || !('text' in content)) {
      throw new Error(`No text content returned for UI resource: ${resourceUri}`);
    }

    return {
      html: content.text as string,
      // CSP metadata is typically declared in the tool's _meta.ui, not in the resource.
      // The caller should pass CSP from the tool metadata.
    };
  }

  /**
   * Call a tool on an MCP server (reverse tool call from iframe).
   * Reuses the persistent connection.
   */
  async callTool(
    serverName: string,
    toolName: string,
    transport: IMcpServer['transport'],
    args?: Record<string, unknown>
  ): Promise<unknown> {
    const client = await this.getOrCreateClient(serverName, transport);
    const result = await client.callTool({ name: toolName, arguments: args || {} });
    return result;
  }

  /**
   * Disconnect a specific server's persistent connection.
   */
  async disconnect(serverName: string): Promise<void> {
    const cached = this.connections.get(serverName);
    if (cached) {
      this.connections.delete(serverName);
      try {
        await cached.client.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  /**
   * Disconnect all persistent connections.
   */
  async disconnectAll(): Promise<void> {
    const names = [...this.connections.keys()];
    await Promise.allSettled(names.map((name) => this.disconnect(name)));
  }

  private async getOrCreateClient(serverName: string, transport: IMcpServer['transport']): Promise<Client> {
    const cached = this.connections.get(serverName);
    if (cached && Date.now() - cached.createdAt < this.maxConnectionAge) {
      return cached.client;
    }

    // Close stale connection if any
    if (cached) {
      await this.disconnect(serverName);
    }

    const client = new Client(
      {
        name: getPlatformServices().paths.getName(),
        version: getPlatformServices().paths.getVersion(),
      },
      {
        capabilities: {
          sampling: {},
          experimental: {
            'io.modelcontextprotocol/ui': {},
          },
        },
      }
    );

    const mcpTransport = this.createTransport(transport);
    await client.connect(mcpTransport);

    this.connections.set(serverName, { client, createdAt: Date.now() });
    return client;
  }

  private createTransport(transport: IMcpServer['transport']) {
    switch (transport.type) {
      case 'stdio': {
        const enhancedEnv = {
          ...getEnhancedEnv(transport.env),
          TERM: 'dumb',
          NO_COLOR: '1',
        };
        const command = transport.command === 'npx' ? resolveNpxPath(enhancedEnv) : transport.command;
        return new StdioClientTransport({
          command,
          args: transport.args || [],
          env: enhancedEnv,
          stderr: 'pipe',
        });
      }
      case 'sse':
        return new SSEClientTransport(new URL(transport.url), {
          requestInit: { headers: transport.headers },
        });
      case 'streamable_http':
        return new StreamableHTTPClientTransport(new URL(transport.url), {
          requestInit: { headers: transport.headers },
        });
      case 'http':
        // HTTP transport uses StreamableHTTP as fallback
        return new StreamableHTTPClientTransport(new URL(transport.url), {
          requestInit: { headers: transport.headers },
        });
      default:
        throw new Error(`Unsupported transport type for MCP Apps: ${(transport as { type: string }).type}`);
    }
  }
}
