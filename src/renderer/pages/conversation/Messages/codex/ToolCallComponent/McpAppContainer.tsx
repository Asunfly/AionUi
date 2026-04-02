/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpToolUiMeta } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { Alert, Spin } from '@arco-design/web-react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps/app-bridge';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type McpAppContainerProps = {
  serverName: string;
  resourceUri: string;
  csp?: McpToolUiMeta['csp'];
  transport: import('@/common/config/storage').IMcpServer['transport'];
  /** Tool arguments sent via sendToolInput on init */
  toolArguments?: Record<string, unknown>;
  /** Tool result sent via sendToolResult when available */
  toolResult?: unknown;
};

type ContainerState = 'loading' | 'ready' | 'connected' | 'error';

/** Inject a Content-Security-Policy meta tag into the HTML <head> */
function injectCsp(html: string, csp?: McpToolUiMeta['csp']): string {
  if (!csp) return html;

  const directives: string[] = ["default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:"];
  if (csp.connectDomains?.length) {
    directives.push(`connect-src 'self' ${csp.connectDomains.join(' ')}`);
  }
  if (csp.resourceDomains?.length) {
    directives.push(`script-src 'self' 'unsafe-inline' 'unsafe-eval' ${csp.resourceDomains.join(' ')}`);
    directives.push(`style-src 'self' 'unsafe-inline' ${csp.resourceDomains.join(' ')}`);
    directives.push(`img-src 'self' data: blob: ${csp.resourceDomains.join(' ')}`);
    directives.push(`font-src 'self' data: ${csp.resourceDomains.join(' ')}`);
  }

  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${directives.join('; ')}">`;
  // Insert after <head> or at the start of the document
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>${metaTag}`);
  }
  return `${metaTag}${html}`;
}

const HOST_INFO = { name: 'AionUi', version: '1.0.0' };
const HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  serverTools: {},
  logging: {},
};
const MAX_HEIGHT = 800;
const INIT_TIMEOUT = 15_000;

const McpAppContainer: React.FC<McpAppContainerProps> = ({
  serverName,
  resourceUri,
  csp,
  transport,
  toolArguments,
  toolResult,
}) => {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const sentResultRef = useRef(false);

  const [state, setState] = useState<ContainerState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [iframeHeight, setIframeHeight] = useState(300);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);

  // Fetch UI resource HTML and create blob URL
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await ipcBridge.mcpService.readUiResource.invoke({
          serverName,
          resourceUri,
          transport,
        });

        if (cancelled) return;

        if (!response.success || !response.data) {
          setState('error');
          setErrorMsg(response.msg || t('mcp.apps.error'));
          return;
        }

        const html = injectCsp(response.data.html, csp || response.data.csp);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setIframeSrc(url);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverName, resourceUri, transport, csp, t]);

  // Initialize AppBridge after iframe loads
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || bridgeRef.current) return;

    const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES);

    // Handle size changes from the app
    bridge.onsizechange = (params) => {
      if (params.height && params.height > 0) {
        setIframeHeight(Math.min(params.height, MAX_HEIGHT));
      }
    };

    // Handle link open requests
    bridge.onopenlink = async (params) => {
      const url = params.url;
      // Only allow https URLs for security
      if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return {};
    };

    // Handle teardown requests from the app
    bridge.onrequestteardown = () => {
      // App requested to close itself — we keep the iframe but could show a placeholder
    };

    // Handle reverse tool calls (iframe → Host → Server)
    bridge.oncalltool = async (params) => {
      const response = await ipcBridge.mcpService.callMcpTool.invoke({
        serverName,
        toolName: params.name,
        transport,
        arguments: params.arguments as Record<string, unknown> | undefined,
      });
      if (response.success && response.data) {
        return response.data as { content: Array<{ type: 'text'; text: string }> };
      }
      return { content: [{ type: 'text' as const, text: response.msg || 'Tool call failed' }], isError: true };
    };

    bridge.oninitialized = () => {
      setState('connected');

      // Send tool input if available
      if (toolArguments) {
        void bridge.sendToolInput({ arguments: toolArguments });
      }

      // Send tool result if already available
      if (toolResult !== undefined && !sentResultRef.current) {
        sentResultRef.current = true;
        void bridge.sendToolResult({
          content:
            typeof toolResult === 'string'
              ? [{ type: 'text', text: toolResult }]
              : [{ type: 'text', text: JSON.stringify(toolResult) }],
        });
      }
    };

    bridgeRef.current = bridge;

    const pmTransport = new PostMessageTransport(iframe.contentWindow, iframe.contentWindow);
    void bridge.connect(pmTransport);

    // Timeout if app doesn't initialize
    const timeout = setTimeout(() => {
      if (state === 'ready') {
        setState('error');
        setErrorMsg(t('mcp.apps.initTimeout'));
      }
    }, INIT_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [toolArguments, toolResult, state, t]);

  // Send tool result when it arrives after initialization
  useEffect(() => {
    if (toolResult !== undefined && bridgeRef.current && state === 'connected' && !sentResultRef.current) {
      sentResultRef.current = true;
      void bridgeRef.current.sendToolResult({
        content:
          typeof toolResult === 'string'
            ? [{ type: 'text', text: toolResult }]
            : [{ type: 'text', text: JSON.stringify(toolResult) }],
      });
    }
  }, [toolResult, state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (bridgeRef.current) {
        void bridgeRef.current.teardownResource({ reason: 'unmount' }).catch(() => {});
        bridgeRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  if (state === 'error') {
    return <Alert type='error' content={errorMsg || t('mcp.apps.error')} className='mt-2' />;
  }

  return (
    <div className='mt-2 w-full rounded border border-b-base overflow-hidden relative'>
      {(state === 'loading' || state === 'ready') && (
        <div className='absolute inset-0 flex items-center justify-center bg-base z-10'>
          <Spin tip={t('mcp.apps.loading')} />
        </div>
      )}
      {iframeSrc && (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          sandbox='allow-scripts'
          onLoad={handleIframeLoad}
          className='w-full border-none'
          style={{
            height: `${iframeHeight}px`,
            maxHeight: `${MAX_HEIGHT}px`,
            opacity: state === 'connected' ? 1 : 0,
            transition: 'opacity 200ms ease-in',
            backgroundColor: 'transparent',
          }}
          title={`MCP App: ${serverName}`}
        />
      )}
    </div>
  );
};

export default McpAppContainer;
