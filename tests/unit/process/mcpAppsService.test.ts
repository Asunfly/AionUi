import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  readResource: vi.fn(),
  streamableHttpTransport: vi.fn(),
}));

vi.mock('@common/platform', () => ({
  getPlatformServices: () => ({
    paths: {
      getName: () => 'AionUi-Test',
      getVersion: () => '1.0.0',
    },
  }),
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: {
      getName: () => 'AionUi-Test',
      getVersion: () => '1.0.0',
    },
  }),
}));

vi.mock('@/process/utils/shellEnv', () => ({
  getEnhancedEnv: (env?: Record<string, string>) => env ?? {},
  resolveNpxPath: () => 'npx',
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function MockClient() {
    return {
      callTool: mocks.callTool,
      close: mocks.close,
      connect: mocks.connect,
      readResource: mocks.readResource,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mocks.streamableHttpTransport.mockImplementation(
    function MockStreamableHTTPClientTransport(url: URL, options?: unknown) {
      return {
        options,
        url: url.toString(),
      };
    }
  ),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(function MockSSEClientTransport(url: URL, options?: unknown) {
    return {
      options,
      url: url.toString(),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function MockStdioClientTransport(options?: unknown) {
    return {
      options,
    };
  }),
}));

import { McpAppsService } from '@/process/services/mcpServices/McpAppsService';

describe('McpAppsService connection cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.readResource.mockResolvedValue({
      contents: [{ text: '<html><body>drawio</body></html>' }],
    });
    mocks.callTool.mockResolvedValue({ content: [] });
  });

  it('reuses the MCP client while the same server transport is unchanged', async () => {
    const service = new McpAppsService();
    const transport = { type: 'streamable_http' as const, url: 'https://mcp.draw.io/mcp' };

    await service.readUiResource('drawio', 'ui://drawio/mcp-app.html', transport);
    await service.callTool('drawio', 'search_shapes', transport, { query: 'flowchart' });

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('reconnects the MCP client when an edited server keeps the same name but changes transport', async () => {
    const service = new McpAppsService();

    await service.readUiResource('drawio', 'ui://drawio/mcp-app.html', {
      type: 'streamable_http',
      url: 'https://old.example.test/mcp',
    });
    await service.readUiResource('drawio', 'ui://drawio/mcp-app.html', {
      type: 'streamable_http',
      url: 'https://new.example.test/mcp',
    });

    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.streamableHttpTransport).toHaveBeenLastCalledWith(new URL('https://new.example.test/mcp'), {
      requestInit: { headers: undefined },
    });
  });
});
