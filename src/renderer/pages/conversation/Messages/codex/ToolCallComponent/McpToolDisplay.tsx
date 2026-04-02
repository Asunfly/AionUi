/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CodexToolCallUpdate } from '@/common/chat/chatLib';
import { ConfigStorage } from '@/common/config/storage';
import type { IMcpServer } from '@/common/config/storage';
import { Collapse, Tag } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMcpAppsConfig } from '@renderer/hooks/mcp/useMcpAppsConfig';
import BaseToolCallDisplay from './BaseToolCallDisplay';
import McpAppContainer from './McpAppContainer';

type McpToolUpdate = Extract<CodexToolCallUpdate, { subtype: 'mcp_tool_call_begin' | 'mcp_tool_call_end' }>;

const McpToolDisplay: React.FC<{ content: McpToolUpdate }> = ({ content }) => {
  const { toolCallId, title, status, description, subtype, data } = content;
  const { t } = useTranslation();
  const { enabled, isServerTrusted } = useMcpAppsConfig();

  const [serverConfig, setServerConfig] = useState<IMcpServer | null>(null);

  const inv = data?.invocation || {};
  const toolName = inv.tool || inv.name || inv.method || 'unknown';
  const serverName =
    ('serverName' in (data || {}) ? (data as { serverName?: string }).serverName : undefined) || inv.server || '';
  const uiMeta = data?.uiMeta;
  const toolResult = subtype === 'mcp_tool_call_end' && data && 'result' in data ? data.result : undefined;

  // Look up server config to get transport info for McpAppContainer
  useEffect(() => {
    if (!uiMeta?.resourceUri || !serverName) return;
    void ConfigStorage.get('mcp.config').then((servers) => {
      const found = servers?.find((s) => s.name === serverName);
      if (found) setServerConfig(found);
    });
  }, [uiMeta?.resourceUri, serverName]);

  const canRenderApp = enabled && uiMeta?.resourceUri && serverConfig && isServerTrusted(serverConfig.id);

  const getDisplayTitle = () => {
    if (title) return title;
    switch (subtype) {
      case 'mcp_tool_call_begin':
        return t('tools.titles.mcp_tool_starting', { toolName });
      case 'mcp_tool_call_end':
        return t('tools.titles.mcp_tool', { toolName });
      default:
        return 'MCP Tool';
    }
  };

  const toolDetails = inv.tool || inv.name || inv.method ? { toolName, arguments: inv.arguments } : null;

  return (
    <BaseToolCallDisplay
      toolCallId={toolCallId}
      title={getDisplayTitle()}
      status={status}
      description={description}
      icon='🔌'
    >
      {/* MCP App interactive UI */}
      {canRenderApp && serverConfig && uiMeta?.resourceUri && (
        <McpAppContainer
          serverName={serverName}
          resourceUri={uiMeta.resourceUri}
          csp={uiMeta.csp}
          transport={serverConfig.transport}
          toolArguments={inv.arguments as Record<string, unknown> | undefined}
          toolResult={toolResult}
        />
      )}

      {/* Collapsible raw data — shown when app is rendered, or always when no app */}
      {canRenderApp ? (
        <Collapse bordered={false} className='mt-2'>
          <Collapse.Item name='raw' header={t('mcp.apps.rawData')}>
            <RawToolDetails toolDetails={toolDetails} subtype={subtype} result={toolResult} />
          </Collapse.Item>
        </Collapse>
      ) : (
        <RawToolDetails toolDetails={toolDetails} subtype={subtype} result={toolResult} />
      )}
    </BaseToolCallDisplay>
  );
};

/** Displays tool name, arguments, and result as text/JSON */
const RawToolDetails: React.FC<{
  toolDetails: { toolName: string; arguments?: unknown } | null;
  subtype: string;
  result?: unknown;
}> = ({ toolDetails, subtype, result }) => {
  const { t } = useTranslation();

  return (
    <>
      {toolDetails && (
        <div className='text-sm mb-2'>
          <div className='text-xs text-t-secondary mb-1'>{t('tools.labels.tool_details')}</div>
          <div className='bg-1 p-2 rounded text-sm border border-b-base'>
            <div className='flex items-center gap-2'>
              <Tag size='small' color='purple'>
                {t('tools.labels.tool')}
              </Tag>
              <span className='font-mono text-xs text-t-primary'>{toolDetails.toolName}</span>
            </div>
            {toolDetails.arguments && (
              <div className='mt-2'>
                <div className='text-xs text-t-secondary mb-1'>{t('tools.labels.arguments')}</div>
                <pre className='text-xs bg-2 p-2 rounded border border-b-base overflow-x-auto text-t-primary'>
                  {JSON.stringify(toolDetails.arguments, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {subtype === 'mcp_tool_call_end' && result && (
        <div className='text-sm mb-2'>
          <div className='text-xs text-t-secondary mb-1'>{t('tools.labels.result')}</div>
          <div className='bg-1 p-2 rounded text-sm max-h-40 overflow-y-auto border border-b-base'>
            <pre className='text-xs whitespace-pre-wrap text-t-primary'>
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};

export default McpToolDisplay;
