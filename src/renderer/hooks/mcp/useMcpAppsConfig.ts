/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ConfigStorage } from '@/common/config/storage';

/**
 * Hook for MCP Apps feature flag and trust list management.
 * Two-layer control:
 * - Feature flag: `mcp.apps.enabled` (user toggle, default false)
 * - Trust list: `mcp.apps.trustList` (server IDs allowed to render UI)
 */
export const useMcpAppsConfig = () => {
  const [enabled, setEnabledState] = useState(false);
  const [trustList, setTrustListState] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([ConfigStorage.get('mcp.apps.enabled'), ConfigStorage.get('mcp.apps.trustList')])
      .then(([enabledVal, trustVal]) => {
        setEnabledState(enabledVal === true);
        if (Array.isArray(trustVal)) {
          setTrustListState(trustVal);
        }
        setLoaded(true);
      })
      .catch((error) => {
        console.error('[useMcpAppsConfig] Failed to load config:', error);
        setLoaded(true);
      });
  }, []);

  const setEnabled = useCallback(async (value: boolean) => {
    setEnabledState(value);
    await ConfigStorage.set('mcp.apps.enabled', value);
  }, []);

  const addTrust = useCallback(async (serverId: string) => {
    setTrustListState((prev) => {
      if (prev.includes(serverId)) return prev;
      const next = [...prev, serverId];
      void ConfigStorage.set('mcp.apps.trustList', next);
      return next;
    });
  }, []);

  const removeTrust = useCallback(async (serverId: string) => {
    setTrustListState((prev) => {
      const next = prev.filter((id) => id !== serverId);
      void ConfigStorage.set('mcp.apps.trustList', next);
      return next;
    });
  }, []);

  const isServerTrusted = useCallback((serverId: string) => trustList.includes(serverId), [trustList]);

  return useMemo(
    () => ({
      enabled,
      trustList,
      loaded,
      setEnabled,
      addTrust,
      removeTrust,
      isServerTrusted,
    }),
    [enabled, trustList, loaded, setEnabled, addTrust, removeTrust, isServerTrusted]
  );
};
