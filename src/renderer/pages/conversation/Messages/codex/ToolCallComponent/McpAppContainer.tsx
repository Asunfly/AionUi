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
  /** Tool arguments sent via sendToolInput on init */
  toolArguments?: Record<string, unknown>;
  /** Tool result sent via sendToolResult when available */
  toolResult?: unknown;
};

type ContainerState = 'loading' | 'ready' | 'connected' | 'error';
type CachedUiResource = {
  html: string;
  csp?: McpToolUiMeta['csp'];
};
type RememberedAppSize = {
  height: number;
  width: number | null;
};

const INITIAL_HEIGHT = 300;
const SIZE_CACHE_STORAGE_KEY = 'mcp-app:size-cache:v2';
const uiResourceCache = new Map<string, Promise<CachedUiResource>>();
const rememberedSizeCache = new Map<string, RememberedAppSize>();

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

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function getTransportSignature(transport: IMcpServer['transport']): string {
  return stableSerialize(transport);
}

function getUiResourceCacheKey(serverName: string, resourceUri: string, transport: IMcpServer['transport']): string {
  return `${serverName}::${resourceUri}::${getTransportSignature(transport)}`;
}

function getSizeCacheKey(
  serverName: string,
  resourceUri: string,
  toolArguments?: Record<string, unknown>,
  toolResult?: unknown
): string {
  const argsHash = hashString(stableSerialize(toolArguments));
  const resultHash = hashString(stableSerialize(toolResult));
  return `${serverName}::${resourceUri}::${argsHash}::${resultHash}`;
}

function readPersistedSizeCache(): Record<string, RememberedAppSize> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(SIZE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, RememberedAppSize>;
  } catch {
    return {};
  }
}

function getRememberedSize(cacheKey: string): RememberedAppSize | undefined {
  const inMemory = rememberedSizeCache.get(cacheKey);
  if (inMemory) return inMemory;

  const persisted = readPersistedSizeCache()[cacheKey];
  if (persisted) {
    rememberedSizeCache.set(cacheKey, persisted);
  }
  return persisted;
}

function getInitialHeightFromRememberedSize(size: RememberedAppSize | undefined): number {
  if (!size) return INITIAL_HEIGHT;

  if (size.width !== null && size.width >= WIDE_LAYOUT_WIDTH_THRESHOLD) {
    return Math.min(size.height, SMALL_VISUALIZATION_HEIGHT_THRESHOLD);
  }

  return size.height;
}

function rememberSize(cacheKey: string, size: RememberedAppSize): void {
  rememberedSizeCache.set(cacheKey, size);

  if (typeof window === 'undefined') return;

  try {
    const persisted = readPersistedSizeCache();
    persisted[cacheKey] = size;
    window.localStorage.setItem(SIZE_CACHE_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    return;
  }
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
  if (cached) {
    return cached;
  }

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
  rememberedSizeCache.clear();
}

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
const MAX_HEIGHT = 960;
const MIN_HEIGHT = 320;
const VIEWPORT_BOTTOM_MARGIN = 32;
const MAX_IFRAME_CONTENT_HEIGHT = 1600;
const WIDE_LAYOUT_WIDTH_THRESHOLD = 1000;
const SMALL_VISUALIZATION_HEIGHT_THRESHOLD = 420;
const VISUALIZATION_PREFERRED_HEIGHT_RATIO = 0.72;
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
  const resourceCacheKey = useMemo(
    () => getUiResourceCacheKey(serverName, resourceUri, transport),
    [resourceUri, serverName, transport]
  );
  const sizeCacheKey = useMemo(
    () => getSizeCacheKey(serverName, resourceUri, toolArguments, toolResult),
    [resourceUri, serverName, toolArguments, toolResult]
  );
  const rememberedSize = useMemo(() => getRememberedSize(sizeCacheKey), [sizeCacheKey]);
  const cspSignature = useMemo(() => stableSerialize(csp), [csp]);
  const shellRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const sentResultRef = useRef(false);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  const [state, setState] = useState<ContainerState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [iframeHeight, setIframeHeight] = useState(getInitialHeightFromRememberedSize(rememberedSize));
  const [iframeWidth, setIframeWidth] = useState<number | null>(rememberedSize?.width ?? null);
  const [viewportMaxHeight, setViewportMaxHeight] = useState(MAX_HEIGHT);
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);

  useEffect(() => {
    const nextRememberedSize = getRememberedSize(sizeCacheKey);
    setIframeHeight(getInitialHeightFromRememberedSize(nextRememberedSize));
    setIframeWidth(nextRememberedSize?.width ?? null);
  }, [sizeCacheKey]);

  const updateViewportMaxHeight = useCallback(() => {
    const top = shellRef.current?.getBoundingClientRect().top;
    if (typeof top !== 'number') {
      setViewportMaxHeight(MAX_HEIGHT);
      return;
    }

    const availableHeight = window.innerHeight - top - VIEWPORT_BOTTOM_MARGIN;
    const nextHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.floor(availableHeight)));
    setViewportMaxHeight(nextHeight);
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
        let nextWidth = iframeWidth;
        let nextHeight = iframeHeight;
        if (params.width && params.width > 0) {
          nextWidth = Math.ceil(params.width);
          setIframeWidth(nextWidth);
        }
        if (params.height && params.height > 0) {
          nextHeight = Math.ceil(params.height);
          setIframeHeight(nextHeight);
        }

        rememberSize(sizeCacheKey, {
          width: nextWidth,
          height: nextHeight,
        });
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
    [clearInitTimeout, iframeHeight, iframeWidth, serverName, sizeCacheKey, toolArguments, toolResult, transport]
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    connectBridge(iframe.contentWindow);
  }, [connectBridge]);

  useLayoutEffect(() => {
    updateViewportMaxHeight();

    const handleResize = () => {
      updateViewportMaxHeight();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [updateViewportMaxHeight]);

  useLayoutEffect(() => {
    updateViewportMaxHeight();
  }, [iframeHeight, state, updateViewportMaxHeight]);

  // Fetch UI resource HTML and create blob URL
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

        const html = injectCsp(response.html, csp || response.csp);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
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
  }, [clearInitTimeout, csp, cspSignature, resourceCacheKey, resourceUri, serverName, startInitTimeout, t, transport]);

  // Initialize AppBridge after iframe loads
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    connectBridge(iframe.contentWindow);
  }, [connectBridge]);

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

  const preferredVisualizationHeight = Math.min(
    viewportMaxHeight,
    Math.max(MIN_HEIGHT, Math.floor(viewportMaxHeight * VISUALIZATION_PREFERRED_HEIGHT_RATIO))
  );
  const isWideLayout = typeof iframeWidth === 'number' && iframeWidth >= WIDE_LAYOUT_WIDTH_THRESHOLD;
  const shouldUseVisualizationHeightFallback =
    iframeHeight <= SMALL_VISUALIZATION_HEIGHT_THRESHOLD && !isWideLayout;
  const renderedHeight = shouldUseVisualizationHeightFallback
    ? Math.max(iframeHeight, preferredVisualizationHeight)
    : Math.min(Math.max(iframeHeight, MIN_HEIGHT), MAX_IFRAME_CONTENT_HEIGHT);

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
