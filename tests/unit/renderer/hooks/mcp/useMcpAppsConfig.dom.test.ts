import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { ConfigStorage } from '@/common/config/storage';
import { useMcpAppsConfig } from '@/renderer/hooks/mcp/useMcpAppsConfig';

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

const makeServer = (overrides?: Partial<IMcpServer>): IMcpServer => ({
  id: 'mcp_current_drawio',
  name: 'drawio',
  enabled: true,
  transport: { type: 'http', url: 'https://example.com/mcp' },
  createdAt: 1,
  updatedAt: 1,
  originalJson: '{}',
  ...overrides,
});

describe('useMcpAppsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('migrates trusted server IDs to stable server names on load', async () => {
    vi.mocked(ConfigStorage.get).mockImplementation(async (key) => {
      switch (key) {
        case 'mcp.apps.enabled':
          return true;
        case 'mcp.apps.trustList':
          return ['mcp_current_drawio'];
        case 'mcp.config':
          return [makeServer()];
        default:
          return undefined;
      }
    });

    const { result } = renderHook(() => useMcpAppsConfig());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.trustList).toEqual(['drawio']);
    expect(result.current.isServerTrusted('drawio')).toBe(true);
    expect(ConfigStorage.set).toHaveBeenCalledWith('mcp.apps.trustList', ['drawio']);
  });

  it('persists newly trusted servers by stable server name', async () => {
    vi.mocked(ConfigStorage.get).mockResolvedValue(undefined);

    const { result } = renderHook(() => useMcpAppsConfig());

    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    await act(async () => {
      await result.current.addTrust('drawio');
    });

    expect(result.current.trustList).toEqual(['drawio']);
    expect(result.current.isServerTrusted('drawio')).toBe(true);
    expect(ConfigStorage.set).toHaveBeenLastCalledWith('mcp.apps.trustList', ['drawio']);
  });
});
