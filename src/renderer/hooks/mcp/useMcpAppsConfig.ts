/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ConfigStorage } from '@/common/config/storage';
import type { IMcpServer } from '@/common/config/storage';

/**
 * Hook for MCP Apps feature flag and trust list management.
 * Two-layer control:
 * - Feature flag: `mcp.apps.enabled` (user toggle, default false)
 * - Trust list: `mcp.apps.trustList` (stable server keys allowed to render UI)
 */
export const getMcpAppTrustKey = (server: Pick<IMcpServer, 'name'>): string => server.name;

export const normalizeMcpAppsTrustList = (trustList: unknown, servers: Pick<IMcpServer, 'id' | 'name'>[]): string[] => {
  if (!Array.isArray(trustList)) {
    return [];
  }

  const trustKeysById = new Map(servers.map((server) => [server.id, getMcpAppTrustKey(server)]));
  const knownTrustKeys = new Set(servers.map((server) => getMcpAppTrustKey(server)));
  const normalized: string[] = [];

  trustList.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }

    const normalizedEntry = knownTrustKeys.has(entry) ? entry : (trustKeysById.get(entry) ?? entry);
    if (!normalized.includes(normalizedEntry)) {
      normalized.push(normalizedEntry);
    }
  });

  return normalized;
};

export const useMcpAppsConfig = () => {
  const [enabled, setEnabledState] = useState(false);
  const [trustList, setTrustListState] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      ConfigStorage.get('mcp.apps.enabled'),
      ConfigStorage.get('mcp.apps.trustList'),
      ConfigStorage.get('mcp.config'),
    ])
      .then(([enabledVal, trustVal, servers]) => {
        setEnabledState(enabledVal === true);
        const normalizedTrustList = normalizeMcpAppsTrustList(trustVal, Array.isArray(servers) ? servers : []);
        setTrustListState(normalizedTrustList);

        const shouldPersistMigratedTrustList =
          Array.isArray(trustVal) &&
          (trustVal.length !== normalizedTrustList.length ||
            trustVal.some((entry, index) => entry !== normalizedTrustList[index]));

        if (shouldPersistMigratedTrustList) {
          void ConfigStorage.set('mcp.apps.trustList', normalizedTrustList);
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

  const addTrust = useCallback(async (trustKey: string) => {
    setTrustListState((prev) => {
      if (prev.includes(trustKey)) return prev;
      const next = [...prev, trustKey];
      void ConfigStorage.set('mcp.apps.trustList', next);
      return next;
    });
  }, []);

  const removeTrust = useCallback(async (trustKey: string) => {
    setTrustListState((prev) => {
      const next = prev.filter((entry) => entry !== trustKey);
      void ConfigStorage.set('mcp.apps.trustList', next);
      return next;
    });
  }, []);

  const isServerTrusted = useCallback((trustKey: string) => trustList.includes(trustKey), [trustList]);

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
