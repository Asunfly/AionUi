import type { BadgeProps } from '@arco-design/web-react';
import { Alert, Badge, Button } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import React, { useEffect, useMemo, useState } from 'react';
import type { IMessageAcpToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import { ConfigStorage } from '@/common/config/storage';
import type { IMcpServer } from '@/common/config/storage';
import { useMcpAppsConfig } from '@renderer/hooks/mcp/useMcpAppsConfig';
import { getMcpAppRenderState } from '@renderer/pages/conversation/Messages/codex/ToolCallComponent/McpToolDisplay';
import McpAppContainer from '@renderer/pages/conversation/Messages/codex/ToolCallComponent/McpAppContainer';
import { useTranslation } from 'react-i18next';
import './MessageToolGroupSummary.css';

type ToolItem = {
  key: string;
  name: string;
  desc: string;
  status: BadgeProps['status'];
  input?: string;
  output?: string;
};

type SummarizedMcpAppCandidate = {
  serverName: string;
  toolName: string;
  toolArguments?: Record<string, unknown>;
  toolResult?: unknown;
};

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const normalizeMcpToolIdentityValue = (value: string): string =>
  value.replace(/^(?:MCP\s+Tool|Tool|工具)\s*[:：]\s*/i, '').trim();

const extractAcpMcpInvocation = (
  rawInput?: Record<string, unknown>
): { serverName: string; toolName: string; toolArguments?: Record<string, unknown> } | undefined => {
  if (!rawInput) return undefined;

  const serverName = typeof rawInput.server === 'string' ? rawInput.server : undefined;
  const toolName = typeof rawInput.tool === 'string' ? rawInput.tool : undefined;
  const toolArguments =
    rawInput.arguments && typeof rawInput.arguments === 'object' && !Array.isArray(rawInput.arguments)
      ? (rawInput.arguments as Record<string, unknown>)
      : undefined;

  if (!serverName || !toolName) return undefined;

  return { serverName, toolName, toolArguments };
};

const getResultDisplayText = (resultDisplay: IMessageToolGroup['content'][0]['resultDisplay']): string | undefined => {
  if (!resultDisplay) return undefined;
  if (typeof resultDisplay === 'string') return resultDisplay;
  if ('fileDiff' in resultDisplay) return resultDisplay.fileDiff;
  if ('img_url' in resultDisplay) return resultDisplay.relative_path || resultDisplay.img_url;
  return undefined;
};

const parseMcpToolIdentity = (value: string): { serverName: string; toolName: string } | undefined => {
  const normalizedValue = normalizeMcpToolIdentityValue(value);

  const slashMatch = normalizedValue.match(/^([^/]+)\/([^/]+)$/);
  if (slashMatch) {
    return { serverName: slashMatch[1], toolName: slashMatch[2] };
  }

  const separatorMatch = normalizedValue.match(/^([^_]+(?:__[^_]+)*?)__([^_]+(?:_[^_]+)*)$/);
  if (separatorMatch) {
    return { serverName: separatorMatch[1], toolName: separatorMatch[2] };
  }

  const parenMatch = normalizedValue.match(/^(.+?)\s+\((.+?)\s+MCP\s+Server\)$/i);
  if (parenMatch) {
    return { serverName: parenMatch[2], toolName: parenMatch[1] };
  }

  return undefined;
};

const parseObjectCandidate = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const parseToolArguments = (description?: string): Record<string, unknown> | undefined => {
  if (!description) return undefined;

  const trimmed = description.trim();
  const direct = parseObjectCandidate(trimmed);
  if (direct) return direct;

  const lastLine = trimmed.split('\n').pop()?.trim();
  if (!lastLine) return undefined;
  return parseObjectCandidate(lastLine);
};

const getAcpToolResultText = (message: IMessageAcpToolCall): string | undefined => {
  const content = message.content.update.content;
  if (!content?.length) return undefined;

  const texts = content
    .map((item) => {
      if (item.type === 'content' && item.content?.text) return item.content.text;
      if (item.type === 'diff' && item.path) return `[diff] ${item.path}`;
      return '';
    })
    .filter(Boolean);

  return texts.length > 0 ? texts.join('\n') : undefined;
};

const getGeminiMcpAppCandidate = (message: IMessageToolGroup): SummarizedMcpAppCandidate | undefined => {
  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const tool = message.content[index];
    if (tool.status !== 'Success' && tool.status !== 'Executing') continue;

    const confirmedIdentity =
      tool.confirmationDetails?.type === 'mcp'
        ? {
            serverName: tool.confirmationDetails.serverName,
            toolName: tool.confirmationDetails.toolName,
          }
        : undefined;
    const parsedIdentity = parseMcpToolIdentity(tool.name);
    const identity = confirmedIdentity || parsedIdentity;

    if (!identity) continue;

    return {
      ...identity,
      toolArguments: parseToolArguments(tool.description),
      toolResult: tool.resultDisplay,
    };
  }

  return undefined;
};

const getAcpMcpAppCandidate = (message: IMessageAcpToolCall): SummarizedMcpAppCandidate | undefined => {
  const { update } = message.content;
  if (update.status !== 'completed' && update.status !== 'in_progress') return undefined;

  const explicitInvocation = extractAcpMcpInvocation(update.rawInput);
  const identity = explicitInvocation || parseMcpToolIdentity(update.title || '');
  if (!identity) return undefined;

  return {
    ...identity,
    toolArguments: explicitInvocation?.toolArguments || update.rawInput,
    toolResult: getAcpToolResultText(message),
  };
};

const getSummarizedMcpAppCandidate = (
  messages: Array<IMessageToolGroup | IMessageAcpToolCall>
): SummarizedMcpAppCandidate | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const candidate =
      message.type === 'tool_group' ? getGeminiMcpAppCandidate(message) : getAcpMcpAppCandidate(message);
    if (candidate) return candidate;
  }

  return undefined;
};

const ToolGroupMapper = (m: IMessageToolGroup): ToolItem[] => {
  return m.content.map(({ name, callId, description, confirmationDetails, status, resultDisplay }) => {
    let desc = description.slice(0, 100);
    const type = confirmationDetails?.type;
    if (type === 'edit') desc = confirmationDetails.fileName;
    if (type === 'exec') desc = confirmationDetails.command;
    if (type === 'info') desc = confirmationDetails.urls?.join(';') || confirmationDetails.title;
    if (type === 'mcp') desc = confirmationDetails.serverName + ':' + confirmationDetails.toolName;

    // Input: use full description (for error it's JSON.stringify(args), for success it's invocation description)
    // When confirmationDetails exists (Confirming state), use structured details instead
    let input: string | undefined;
    if (confirmationDetails) {
      const { title: _title, type: _type, ...rest } = confirmationDetails;
      if (Object.keys(rest).length) input = formatValue(rest);
    } else if (description) {
      input = description;
    }

    // Output: from resultDisplay (available for success/error/executing states)
    const output = getResultDisplayText(resultDisplay);

    return {
      key: callId,
      name,
      desc,
      status: (status === 'Success'
        ? 'success'
        : status === 'Error'
          ? 'error'
          : status === 'Canceled'
            ? 'default'
            : 'processing') as BadgeProps['status'],
      input,
      output,
    };
  });
};

/**
 * Build a concise summary string from rawInput based on tool kind.
 * Shows the most relevant parameters so users can identify what the tool is doing.
 * e.g. Grep → "pattern" in path, Read → file_path, Execute → command
 */
const buildParamSummary = (kind: string, rawInput?: Record<string, unknown>): string | undefined => {
  if (!rawInput) return undefined;

  if (kind === 'read' || kind === 'edit') {
    return (rawInput.file_path as string) || (rawInput.path as string) || (rawInput.fileName as string);
  }
  if (kind === 'execute') {
    return rawInput.command as string;
  }
  if (kind === 'search' || kind === 'grep') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`"${rawInput.pattern}"`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    else if (rawInput.glob) parts.push(`in ${rawInput.glob}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'glob') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`${rawInput.pattern}`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'write') {
    return (rawInput.file_path as string) || (rawInput.path as string);
  }

  // Fallback: pick the first meaningful param value
  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url']) {
    if (rawInput[key] && typeof rawInput[key] === 'string') return rawInput[key] as string;
  }
  return undefined;
};

const ToolAcpMapper = (message: IMessageAcpToolCall): ToolItem | undefined => {
  const update = message.content.update;
  if (!update) return;

  // Input: from rawInput
  const input = update.rawInput ? formatValue(update.rawInput) : undefined;

  // Output: from content items
  let output: string | undefined;
  if (update.content?.length) {
    output = update.content
      .map((item) => {
        if (item.type === 'content' && item.content?.text) return item.content.text;
        if (item.type === 'diff' && item.path) return `[diff] ${item.path}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const keyParam = buildParamSummary(update.kind, update.rawInput);

  return {
    key: update.toolCallId,
    name: update.title,
    desc: keyParam || (update.rawInput?.command as string) || update.kind,
    status:
      update.status === 'completed'
        ? 'success'
        : update.status === 'failed'
          ? 'error'
          : ('default' as BadgeProps['status']),
    input,
    output,
  };
};

const ToolItemDetail: React.FC<{ item: ToolItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = item.input || item.output;

  return (
    <div className='flex flex-col'>
      <div className='flex flex-row color-#86909C gap-12px items-center'>
        <Badge status={item.status} className={item.status === 'processing' ? 'badge-breathing' : ''}></Badge>
        <span
          className={
            'flex-1 min-w-0' +
            (expanded ? ' break-all' : ' truncate') +
            (hasDetail ? ' cursor-pointer hover:color-#4E5969' : '')
          }
          onClick={hasDetail ? () => setExpanded(!expanded) : undefined}
        >
          <span className='font-medium text-13px'>{item.name}</span>
          {item.desc !== item.name && <span className='m-l-4px opacity-80 text-13px'>{item.desc}</span>}
        </span>
        {hasDetail && (
          <span
            className='flex-shrink-0 cursor-pointer hover:color-#4E5969 transition-colors'
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />}
          </span>
        )}
      </div>
      {expanded && hasDetail && (
        <div className='tool-detail-panel m-l-20px m-t-4px'>
          {item.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Input</div>
              <pre className='tool-detail-content'>{item.input}</pre>
            </div>
          )}
          {item.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>Output</div>
              <pre className='tool-detail-content'>{item.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SummarizedMcpApp: React.FC<{ messages: Array<IMessageToolGroup | IMessageAcpToolCall> }> = ({ messages }) => {
  const { t } = useTranslation();
  const { enabled, isServerTrusted, setEnabled, addTrust } = useMcpAppsConfig();
  const [serverConfig, setServerConfig] = useState<IMcpServer | null>(null);
  const candidate = useMemo(() => getSummarizedMcpAppCandidate(messages), [messages]);

  useEffect(() => {
    if (!candidate?.serverName) {
      setServerConfig(null);
      return;
    }

    let cancelled = false;
    void ConfigStorage.get('mcp.config').then((servers) => {
      if (cancelled) return;
      const found = servers?.find((server) => server.name === candidate.serverName) ?? null;
      setServerConfig(found);
    });

    return () => {
      cancelled = true;
    };
  }, [candidate?.serverName]);

  const uiMeta = serverConfig?.tools?.find((tool) => tool.name === candidate?.toolName)?._meta?.ui;
  const renderState = getMcpAppRenderState({
    hasUiMeta: Boolean(uiMeta?.resourceUri),
    enabled,
    hasServerConfig: Boolean(serverConfig),
    trusted: serverConfig ? isServerTrusted(serverConfig.id) : false,
  });

  if (!candidate || renderState === 'raw') {
    return null;
  }

  if (renderState === 'enable_prompt') {
    return (
      <Alert
        className='mb-10px'
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
    );
  }

  if (renderState === 'trust_prompt' && serverConfig) {
    return (
      <Alert
        className='mb-10px'
        type='info'
        content={
          <div className='flex items-center justify-between gap-3'>
            <span>{t('mcp.apps.trustPrompt', { serverName: candidate.serverName })}</span>
            <Button size='mini' type='primary' onClick={() => void addTrust(serverConfig.id)}>
              {t('common.confirm')}
            </Button>
          </div>
        }
      />
    );
  }

  if (renderState !== 'render' || !serverConfig || !uiMeta?.resourceUri) {
    return null;
  }

  return (
    <div className='mb-10px'>
      <McpAppContainer
        serverName={candidate.serverName}
        resourceUri={uiMeta.resourceUri}
        csp={uiMeta.csp}
        transport={serverConfig.transport}
        toolArguments={candidate.toolArguments}
        toolResult={candidate.toolResult}
      />
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: Array<IMessageToolGroup | IMessageAcpToolCall> }> = ({
  messages,
}) => {
  const hasRunningTools = messages.some(
    (m) =>
      (m.type === 'tool_group' &&
        m.content.some((t) => t.status !== 'Success' && t.status !== 'Error' && t.status !== 'Canceled')) ||
      (m.type === 'acp_tool_call' && m.content.update.status !== 'completed')
  );
  const [showMore, setShowMore] = useState(hasRunningTools);

  // Auto-expand when new tools start running (during creation)
  useEffect(() => {
    if (hasRunningTools) setShowMore(true);
  }, [hasRunningTools]);
  const tools = useMemo(() => {
    return messages.flatMap((m) => {
      if (m.type === 'tool_group') return ToolGroupMapper(m);
      return ToolAcpMapper(m);
    });
  }, [messages]);

  return (
    <div>
      <SummarizedMcpApp messages={messages} />
      <div className='flex items-center gap-10px color-#86909C cursor-pointer' onClick={() => setShowMore(!showMore)}>
        <Badge status='default' text='View Steps' className={'![&_span.arco-badge-status-text]:color-#86909C'}></Badge>
        {showMore ? <IconDown /> : <IconRight />}
      </div>
      {showMore && (
        <div className='p-l-20px flex flex-col gap-8px pt-8px'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
