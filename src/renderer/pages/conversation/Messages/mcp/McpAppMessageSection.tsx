/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/config/storage';
import type { IMcpServer, McpToolUiMeta } from '@/common/config/storage';
import { getMcpAppTrustKey, useMcpAppsConfig } from '@/renderer/hooks/mcp/useMcpAppsConfig';
import McpAppContainer from '@/renderer/pages/conversation/Messages/codex/ToolCallComponent/McpAppContainer';
import { Alert, Button, Collapse } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type McpAppMessageSectionMetadata = {
  serverName: string;
  toolName: string;
  toolDisplayName: string;
  arguments?: Record<string, unknown>;
};

type McpAppMessageSectionProps = {
  mcp: McpAppMessageSectionMetadata;
  rawContent?: React.ReactNode;
  toolResult?: unknown;
  uiMeta?: McpToolUiMeta;
};

export type McpAppRenderState = 'raw' | 'enable_prompt' | 'trust_prompt' | 'render';

const CONFIG_REFRESH_INTERVAL_MS = 1000;
const CONFIG_REFRESH_MAX_ATTEMPTS = 10;

export function getMcpAppRenderState(args: {
  hasUiMeta: boolean;
  enabled: boolean;
  hasServerConfig: boolean;
  trusted: boolean;
}): McpAppRenderState {
  const { hasUiMeta, enabled, hasServerConfig, trusted } = args;

  if (!hasUiMeta || !hasServerConfig) return 'raw';
  if (!enabled) return 'enable_prompt';
  if (!trusted) return 'trust_prompt';
  return 'render';
}

const McpAppMessageSection: React.FC<McpAppMessageSectionProps> = ({ mcp, rawContent, toolResult, uiMeta }) => {
  const { t } = useTranslation();
  const { enabled, isServerTrusted, setEnabled, addTrust } = useMcpAppsConfig();
  const [serverConfig, setServerConfig] = useState<IMcpServer | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!mcp.serverName) {
      setServerConfig(null);
      return;
    }

    void ConfigStorage.get('mcp.config').then((servers) => {
      if (cancelled) return;
      const found = servers?.find((server) => server.name === mcp.serverName) ?? null;
      setServerConfig(found);
    });

    return () => {
      cancelled = true;
    };
  }, [mcp.serverName]);

  const resolvedUiMeta = uiMeta ?? serverConfig?.tools?.find((tool) => tool.name === mcp.toolName)?._meta?.ui;
  const trusted = serverConfig ? isServerTrusted(getMcpAppTrustKey(serverConfig)) : false;

  useEffect(() => {
    if (!enabled || uiMeta?.resourceUri || resolvedUiMeta?.resourceUri || !mcp.serverName) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const refreshConfig = () => {
      attempts += 1;
      void ConfigStorage.get('mcp.config').then((servers) => {
        if (cancelled) return;
        const found = servers?.find((server) => server.name === mcp.serverName) ?? null;
        setServerConfig(found);
      });

      if (attempts >= CONFIG_REFRESH_MAX_ATTEMPTS) {
        clearInterval(intervalId);
      }
    };
    const intervalId = window.setInterval(refreshConfig, CONFIG_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, mcp.serverName, mcp.toolName, resolvedUiMeta?.resourceUri, uiMeta?.resourceUri]);

  const renderState = getMcpAppRenderState({
    hasUiMeta: Boolean(resolvedUiMeta?.resourceUri),
    enabled,
    hasServerConfig: Boolean(serverConfig),
    trusted,
  });
  const canRenderApp = renderState === 'render';

  return (
    <>
      {renderState === 'enable_prompt' && (
        <Alert
          className='mt-2'
          type='info'
          content={
            <div className='flex items-center justify-between gap-3'>
              <span>{t('mcp.apps.enablePrompt')}</span>
              <Button size='mini' type='primary' onClick={() => void setEnabled(true)}>
                {t('common.confirm')}
              </Button>
            </div>
          }
        />
      )}

      {renderState === 'trust_prompt' && serverConfig && (
        <Alert
          className='mt-2'
          type='info'
          content={
            <div className='flex items-center justify-between gap-3'>
              <span>{t('mcp.apps.trustPrompt', { serverName: mcp.serverName })}</span>
              <Button size='mini' type='primary' onClick={() => void addTrust(getMcpAppTrustKey(serverConfig))}>
                {t('common.confirm')}
              </Button>
            </div>
          }
        />
      )}

      {canRenderApp && serverConfig && resolvedUiMeta?.resourceUri && (
        <McpAppContainer
          serverName={mcp.serverName}
          resourceUri={resolvedUiMeta.resourceUri}
          csp={resolvedUiMeta.csp}
          transport={serverConfig.transport}
          toolArguments={mcp.arguments}
          toolResult={toolResult}
        />
      )}

      {rawContent &&
        (canRenderApp ? (
          <Collapse bordered={false} className='mt-2'>
            <Collapse.Item name='raw' header={t('mcp.apps.rawData')}>
              {rawContent}
            </Collapse.Item>
          </Collapse>
        ) : (
          rawContent
        ))}
    </>
  );
};

export default McpAppMessageSection;
