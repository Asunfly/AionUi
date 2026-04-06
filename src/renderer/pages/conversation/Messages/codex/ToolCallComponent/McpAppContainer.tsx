/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer, McpToolUiMeta } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import { Alert, Spin } from '@arco-design/web-react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps/app-bridge';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type McpAppContainerProps = {
  serverName: string;
  resourceUri: string;
  csp?: McpToolUiMeta['csp'];
  transport: IMcpServer['transport'];
  toolArguments?: Record<string, unknown>;
  toolResult?: unknown;
};

type ContainerState = 'loading' | 'ready' | 'connected' | 'error';
type CachedUiResource = {
  html: string;
  csp?: McpToolUiMeta['csp'];
};

const HOST_INFO = { name: 'AionUi', version: '1.0.0' };
const HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  serverTools: {},
  logging: {},
};

const INITIAL_SHELL_HEIGHT = 300;
const MIN_VIEWPORT_HEIGHT = 320;
const MAX_VIEWPORT_HEIGHT = 960;
const VIEWPORT_BOTTOM_MARGIN = 32;
const MAX_IFRAME_CONTENT_HEIGHT = 1600;
const INIT_TIMEOUT = 15_000;

const uiResourceCache = new Map<string, Promise<CachedUiResource>>();
const blobUrlCache = new Map<string, string>();

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
}

function getUiResourceCacheKey(serverName: string, resourceUri: string, transport: IMcpServer['transport']): string {
  return `${serverName}::${resourceUri}::${stableSerialize(transport)}`;
}

function getBlobCacheKey(resourceCacheKey: string, csp?: McpToolUiMeta['csp']): string {
  return `${resourceCacheKey}::${stableSerialize(csp)}`;
}

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
  return html.includes('<head>') ? html.replace('<head>', `<head>${metaTag}`) : `${metaTag}${html}`;
}

async function readUiResourceCached(
  cacheKey: string,
  params: {
    serverName: string;
    resourceUri: string;
    transport: IMcpServer['transport'];
  }
): Promise<CachedUiResource> {
  const cached = uiResourceCache.get(cacheKey);
  if (cached) return cached;

  const request = ipcBridge.mcpService.readUiResource
    .invoke(params)
    .then((response) => {
      if (!response.success || !response.data) {
        throw new Error(response.msg || 'Failed to load MCP app resource');
      }
      return response.data as CachedUiResource;
    })
    .catch((error) => {
      uiResourceCache.delete(cacheKey);
      throw error;
    });

  uiResourceCache.set(cacheKey, request);
  return request;
}

export function __resetMcpAppContainerCachesForTest(): void {
  uiResourceCache.clear();
  for (const blobUrl of blobUrlCache.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrlCache.clear();
}

const McpAppContainer: React.FC<McpAppContainerProps> = ({
  serverName,
  resourceUri,
  csp,
  transport,
  toolArguments,
  toolResult,
}) => {
  const { t } = useTranslation();
  const resourceCacheKey = useMemo(
    () => getUiResourceCacheKey(serverName, resourceUri, transport),
    [resourceUri, serverName, transport]
  );
  const cspSignature = useMemo(() => stableSerialize(csp), [csp]);
  const stableCsp = useMemo(() => csp, [cspSignature]);

  const shellRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const sentResultRef = useRef(false);
  const measuredSizeRef = useRef<{ width: number | null; height: number }>({
    width: null,
    height: INITIAL_SHELL_HEIGHT,
  });

  const [state, setState] = useState<ContainerState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasMeasuredSize, setHasMeasuredSize] = useState(false);
  const [iframeWidth, setIframeWidth] = useState<number | null>(null);
  const [iframeHeight, setIframeHeight] = useState(INITIAL_SHELL_HEIGHT);
  const [viewportMaxHeight, setViewportMaxHeight] = useState(MAX_VIEWPORT_HEIGHT);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);

  const updateViewportMaxHeight = useCallback(() => {
    const top = shellRef.current?.getBoundingClientRect().top;
    if (typeof top !== 'number') {
      setViewportMaxHeight(MAX_VIEWPORT_HEIGHT);
      return;
    }

    const availableHeight = window.innerHeight - top - VIEWPORT_BOTTOM_MARGIN;
    setViewportMaxHeight(Math.min(MAX_VIEWPORT_HEIGHT, Math.max(MIN_VIEWPORT_HEIGHT, Math.floor(availableHeight))));
  }, []);

  const clearInitTimeout = useCallback(() => {
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
  }, []);

  const startInitTimeout = useCallback(() => {
    clearInitTimeout();
    initTimeoutRef.current = setTimeout(() => {
      if (!initializedRef.current) {
        setState('error');
        setErrorMsg(t('mcp.apps.initTimeout'));
      }
    }, INIT_TIMEOUT);
  }, [clearInitTimeout, t]);

  const connectBridge = useCallback(
    (contentWindow: Window) => {
      if (bridgeRef.current) return;

      initializedRef.current = false;
      const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES);

      bridge.onsizechange = (params) => {
        const previous = measuredSizeRef.current;
        let nextWidth = previous.width;
        let nextHeight = previous.height;

        if (params.width && params.width > 0) {
          nextWidth = Math.ceil(params.width);
        }
        if (params.height && params.height > 0) {
          nextHeight = Math.ceil(params.height);
        }

        if (previous.width !== null && nextWidth !== null && nextWidth > previous.width && nextHeight < previous.height) {
          nextHeight = previous.height;
        }

        measuredSizeRef.current = { width: nextWidth, height: nextHeight };
        setHasMeasuredSize(true);
        setIframeWidth(nextWidth);
        setIframeHeight(nextHeight);
      };

      bridge.onopenlink = async (params) => {
        const url = params.url;
        if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return {};
      };

      bridge.onrequestteardown = () => {
        return;
      };

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
        initializedRef.current = true;
        clearInitTimeout();
        setState('connected');

        if (toolArguments) {
          void bridge.sendToolInput({ arguments: toolArguments });
        }

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

      const pmTransport = new PostMessageTransport(contentWindow, contentWindow);
      void bridge.connect(pmTransport).catch((error) => {
        clearInitTimeout();
        bridgeRef.current = null;
        setState('error');
        setErrorMsg(error instanceof Error ? error.message : String(error));
      });
    },
    [clearInitTimeout, serverName, toolArguments, toolResult, transport]
  );

  useEffect(() => {
    measuredSizeRef.current = { width: null, height: INITIAL_SHELL_HEIGHT };
    sentResultRef.current = false;
    setHasMeasuredSize(false);
    setIframeWidth(null);
    setIframeHeight(INITIAL_SHELL_HEIGHT);
  }, [serverName, resourceUri]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    connectBridge(iframe.contentWindow);
  }, [connectBridge]);

  useLayoutEffect(() => {
    updateViewportMaxHeight();
    const handleResize = () => updateViewportMaxHeight();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [updateViewportMaxHeight]);

  useLayoutEffect(() => {
    updateViewportMaxHeight();
  }, [iframeHeight, state, updateViewportMaxHeight]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await readUiResourceCached(resourceCacheKey, {
          serverName,
          resourceUri,
          transport,
        });

        if (cancelled) return;

        const effectiveCsp = stableCsp || response.csp;
        const blobCacheKey = getBlobCacheKey(resourceCacheKey, effectiveCsp);
        let url = blobUrlCache.get(blobCacheKey) || null;

        if (!url) {
          const html = injectCsp(response.html, effectiveCsp);
          const blob = new Blob([html], { type: 'text/html' });
          url = URL.createObjectURL(blob);
          blobUrlCache.set(blobCacheKey, url);
        }

        blobUrlRef.current = url;
        setIframeSrc(url);
        setState('ready');
        startInitTimeout();
      } catch (err) {
        if (cancelled) return;
        clearInitTimeout();
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clearInitTimeout, resourceCacheKey, resourceUri, serverName, stableCsp, startInitTimeout, t, transport]);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    connectBridge(iframe.contentWindow);
  }, [connectBridge]);

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

  useEffect(() => {
    return () => {
      clearInitTimeout();
      if (bridgeRef.current) {
        void bridgeRef.current.teardownResource({ reason: 'unmount' }).catch(() => {});
        bridgeRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [clearInitTimeout]);

  if (state === 'error') {
    return <Alert type='error' content={errorMsg || t('mcp.apps.error')} className='mt-2' />;
  }

  const renderedHeight = hasMeasuredSize
    ? Math.min(Math.max(iframeHeight, 1), MAX_IFRAME_CONTENT_HEIGHT)
    : Math.min(INITIAL_SHELL_HEIGHT, viewportMaxHeight);

  return (
    <div ref={shellRef} className='mt-2 w-full rounded border border-b-base overflow-hidden relative bg-1'>
      {(state === 'loading' || state === 'ready') && (
        <div className='absolute inset-0 flex items-center justify-center bg-base z-10'>
          <Spin tip={t('mcp.apps.loading')} />
        </div>
      )}
      <div
        data-testid='mcp-app-scroll-shell'
        className='w-full overflow-x-auto overflow-y-auto'
        style={{
          maxHeight: `${viewportMaxHeight}px`,
          overflowX: 'auto',
          overflowY: 'auto',
        }}>
        <iframe
          ref={iframeRef}
          src={iframeSrc || 'about:blank'}
          sandbox='allow-scripts'
          onLoad={handleIframeLoad}
          className='block border-none min-w-full'
          style={{
            width: iframeWidth ? `${iframeWidth}px` : '100%',
            height: `${renderedHeight}px`,
            maxHeight: 'none',
            opacity: state === 'connected' ? 1 : 0,
            transition: 'opacity 200ms ease-in',
            backgroundColor: 'transparent',
          }}
          title={`MCP App: ${serverName}`}
        />
      </div>
    </div>
  );
};

export default McpAppContainer;
