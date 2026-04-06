/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@process/services/mcpServices/McpService';
import { mcpOAuthService } from '@process/services/mcpServices/McpOAuthService';
import { McpAppsService } from '@process/services/mcpServices/McpAppsService';
import { mainError, mainLog } from '@process/utils/mainLogger';

const mcpAppsService = new McpAppsService();
const MCP_APP_BRIDGE_TAG = '[McpAppBridge]';

function summarizeValue(value: unknown, maxLength = 200): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return 'empty';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function initMcpBridge(): void {
  // MCP 服务相关 IPC 处理程序
  ipcBridge.mcpService.getAgentMcpConfigs.provider(async (agents) => {
    try {
      const result = await mcpService.getAgentMcpConfigs(agents);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error getting MCP configs',
      };
    }
  });

  ipcBridge.mcpService.testMcpConnection.provider(async (server) => {
    try {
      const result = await mcpService.testMcpConnection(server);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error testing MCP connection',
      };
    }
  });

  ipcBridge.mcpService.syncMcpToAgents.provider(async ({ mcpServers, agents }) => {
    try {
      const result = await mcpService.syncMcpToAgents(mcpServers, agents);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error syncing MCP to agents',
      };
    }
  });

  ipcBridge.mcpService.removeMcpFromAgents.provider(async ({ mcpServerName, agents }) => {
    try {
      const result = await mcpService.removeMcpFromAgents(mcpServerName, agents);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error removing MCP from agents',
      };
    }
  });

  // OAuth 相关 IPC 处理程序
  ipcBridge.mcpService.checkOAuthStatus.provider(async (server) => {
    try {
      const result = await mcpOAuthService.checkOAuthStatus(server);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error checking OAuth status',
      };
    }
  });

  ipcBridge.mcpService.loginMcpOAuth.provider(async ({ server, config }) => {
    try {
      const result = await mcpOAuthService.login(server, config);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error during OAuth login',
      };
    }
  });

  ipcBridge.mcpService.logoutMcpOAuth.provider(async (serverName) => {
    try {
      await mcpOAuthService.logout(serverName);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error during OAuth logout',
      };
    }
  });

  ipcBridge.mcpService.getAuthenticatedServers.provider(async () => {
    try {
      const result = await mcpOAuthService.getAuthenticatedServers();
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Unknown error getting authenticated servers',
      };
    }
  });

  // MCP Apps — UI resource fetching
  ipcBridge.mcpService.readUiResource.provider(async ({ serverName, resourceUri, transport }) => {
    try {
      mainLog(MCP_APP_BRIDGE_TAG, 'readUiResource.request', {
        serverName,
        resourceUri,
        transportType: transport.type,
      });
      const result = await mcpAppsService.readUiResource(serverName, resourceUri, transport);
      mainLog(MCP_APP_BRIDGE_TAG, 'readUiResource.success', {
        serverName,
        resourceUri,
        htmlLength: result.html.length,
      });
      return { success: true, data: result };
    } catch (error) {
      mainError(MCP_APP_BRIDGE_TAG, 'readUiResource.error', {
        serverName,
        resourceUri,
        error: error instanceof Error ? error.message : summarizeValue(error),
      });
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Failed to read MCP Apps UI resource',
      };
    }
  });

  // MCP Apps — reverse tool call (iframe → Host → Server)
  ipcBridge.mcpService.callMcpTool.provider(async ({ serverName, toolName, transport, arguments: args }) => {
    try {
      mainLog(MCP_APP_BRIDGE_TAG, 'callMcpTool.request', {
        serverName,
        toolName,
        transportType: transport.type,
        arguments: summarizeValue(args),
      });
      const result = await mcpAppsService.callTool(serverName, toolName, transport, args);
      mainLog(MCP_APP_BRIDGE_TAG, 'callMcpTool.success', {
        serverName,
        toolName,
        result: summarizeValue(result),
      });
      return { success: true, data: result };
    } catch (error) {
      mainError(MCP_APP_BRIDGE_TAG, 'callMcpTool.error', {
        serverName,
        toolName,
        error: error instanceof Error ? error.message : summarizeValue(error),
      });
      return {
        success: false,
        msg: error instanceof Error ? error.message : 'Failed to call MCP tool',
      };
    }
  });
}
