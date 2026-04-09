/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
import FileChangesPanel from '@/renderer/components/base/FileChangesPanel';
import { useDiffPreviewHandlers } from '@/renderer/hooks/file/useDiffPreviewHandlers';
import { parseDiff } from '@/renderer/utils/file/diffUtils';
import { McpAppMessageSection } from '@renderer/pages/conversation/Messages/mcp';
import { Card, Tag } from '@arco-design/web-react';
import { createTwoFilesPatch } from 'diff';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@renderer/components/Markdown';

/**
 * Parse ACP tool title in `mcp__<server>__<tool>` format.
 * Returns { serverName, toolName } if matched, undefined otherwise.
 */
function parseMcpToolTitle(title: string): { serverName: string; toolName: string } | undefined {
  const normalizedTitle = title.replace(/^(?:MCP\s+Tool|Tool|工具)\s*[:：]\s*/i, '').trim();

  const slashMatch = normalizedTitle.match(/^([^/]+)\/([^/]+)$/);
  if (slashMatch) {
    return { serverName: slashMatch[1], toolName: slashMatch[2] };
  }

  // Format: "mcp__<server-name>__<tool-name>" or title may contain " (server MCP Server)" suffix
  const match = normalizedTitle.match(/^mcp__([^_]+(?:__[^_]+)*?)__([^_]+(?:_[^_]+)*)$/);
  if (match) {
    return { serverName: match[1], toolName: match[2] };
  }
  // Also handle format with parenthetical server info: "tool_name (server MCP Server)"
  const parenMatch = normalizedTitle.match(/^(.+?)\s+\((.+?)\s+MCP\s+Server\)$/i);
  if (parenMatch) {
    return { serverName: parenMatch[2], toolName: parenMatch[1] };
  }
  return undefined;
}

const StatusTag: React.FC<{ status: string }> = ({ status }) => {
  const getTagProps = () => {
    switch (status) {
      case 'pending':
        return { color: 'blue', text: 'Pending' };
      case 'in_progress':
        return { color: 'orange', text: 'In Progress' };
      default:
        return { color: 'gray', text: status };
    }
  };

  const { color, text } = getTagProps();
  return <Tag color={color}>{text}</Tag>;
};

const getKindDisplayName = (kind: string) => {
  switch (kind) {
    case 'edit':
      return 'File Edit';
    case 'read':
      return 'File Read';
    case 'execute':
      return 'Shell Command';
    default:
      return kind;
  }
};

// Diff content display as a separate component to ensure hooks are called unconditionally
const DiffContentView: React.FC<{ oldText: string; newText: string; path: string }> = ({ oldText, newText, path }) => {
  const displayName = path.split(/[/\\]/).pop() || path || 'Unknown file';
  const formattedDiff = useMemo(
    () => createTwoFilesPatch(displayName, displayName, oldText, newText, '', '', { context: 3 }),
    [displayName, oldText, newText]
  );
  const fileInfo = useMemo(() => parseDiff(formattedDiff, displayName), [formattedDiff, displayName]);
  const { handleFileClick, handleDiffClick } = useDiffPreviewHandlers({
    diffText: formattedDiff,
    displayName,
    filePath: path || displayName,
  });

  return (
    <FileChangesPanel
      title={displayName}
      files={[fileInfo]}
      onFileClick={handleFileClick}
      onDiffClick={handleDiffClick}
      defaultExpanded={true}
    />
  );
};

const ContentView: React.FC<{ content: IMessageAcpToolCall['content']['update']['content'][0] }> = ({ content }) => {
  if (content.type === 'diff') {
    return (
      <DiffContentView oldText={content.oldText || ''} newText={content.newText || ''} path={content.path || ''} />
    );
  }

  // 处理 content 类型，包含 text 内容
  if (content.type === 'content' && content.content && content.content.type === 'text' && content.content.text) {
    return (
      <div className='mt-3'>
        <div className='bg-1 p-3 rounded border overflow-hidden'>
          <div className='overflow-x-auto break-words'>
            <MarkdownView>{content.content.text}</MarkdownView>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

/** MCP Apps rendering branch for ACP tool calls */
const AcpMcpAppSection: React.FC<{
  serverName: string;
  toolName: string;
  toolDisplayName: string;
  rawInput?: Record<string, unknown>;
  toolResult?: string;
}> = ({ serverName, toolName, toolDisplayName, rawInput, toolResult }) => {
  const { t } = useTranslation();
  const rawDetails =
    rawInput || toolResult ? (
      <div className='text-sm mb-2'>
        {rawInput && (
          <div className='mb-2'>
            <div className='text-xs text-t-secondary mb-1'>{t('tools.labels.arguments')}</div>
            <div className='bg-1 p-2 rounded text-sm border border-b-base'>
              <pre className='text-xs whitespace-pre-wrap text-t-primary'>{JSON.stringify(rawInput, null, 2)}</pre>
            </div>
          </div>
        )}
        {toolResult && (
          <div>
            <div className='text-xs text-t-secondary mb-1'>{t('tools.labels.result')}</div>
            <div className='bg-1 p-2 rounded text-sm border border-b-base'>
              <pre className='text-xs whitespace-pre-wrap text-t-primary'>{toolResult}</pre>
            </div>
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <McpAppMessageSection
      mcp={{
        serverName,
        toolName,
        toolDisplayName,
        arguments: rawInput,
      }}
      toolResult={toolResult}
      rawContent={rawDetails}
    />
  );
};

const MessageAcpToolCall: React.FC<{ message: IMessageAcpToolCall }> = ({ message }) => {
  const { content: messageContent } = message;
  if (!messageContent?.update) {
    return null;
  }
  const { update } = messageContent;
  const { toolCallId, kind, title, status, rawInput, content: diffContent } = update;

  // Detect MCP tool calls by title format: "mcp__<server>__<tool>"
  const mcpInfo = useMemo(() => {
    const serverName = typeof rawInput?.server === 'string' ? rawInput.server : undefined;
    const toolName = typeof rawInput?.tool === 'string' ? rawInput.tool : undefined;
    if (serverName && toolName) {
      return { serverName, toolName };
    }
    return parseMcpToolTitle(title || '');
  }, [rawInput, title]);

  // Extract tool result text from content items for MCP Apps
  const toolResultText = useMemo(() => {
    if (!diffContent?.length) return undefined;
    const texts = diffContent
      .filter((c) => c.type === 'content' && c.content?.type === 'text' && c.content?.text)
      .map((c) => c.content!.text!);
    return texts.length > 0 ? texts.join('\n') : undefined;
  }, [diffContent]);

  return (
    <Card className='w-full mb-2' size='small' bordered>
      <div className='flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-2'>
            <span className='font-medium text-t-primary'>{title || getKindDisplayName(kind)}</span>
            <StatusTag status={status} />
          </div>

          {/* MCP Apps interactive UI rendering */}
          {mcpInfo && (status === 'completed' || status === 'in_progress') && (
            <AcpMcpAppSection
              serverName={mcpInfo.serverName}
              toolName={mcpInfo.toolName}
              toolDisplayName={title || getKindDisplayName(kind)}
              rawInput={
                rawInput?.arguments && typeof rawInput.arguments === 'object' && !Array.isArray(rawInput.arguments)
                  ? (rawInput.arguments as Record<string, unknown>)
                  : rawInput
              }
              toolResult={toolResultText}
            />
          )}

          {/* Original content rendering (always shown as fallback when no MCP App, or collapsible when MCP App active) */}
          {!mcpInfo && rawInput && (
            <div className='text-sm'>
              {typeof rawInput === 'string' ? (
                <MarkdownView>{`\`\`\`\n${rawInput}\n\`\`\``}</MarkdownView>
              ) : (
                <pre className='bg-1 p-2 rounded text-xs overflow-x-auto'>{JSON.stringify(rawInput, null, 2)}</pre>
              )}
            </div>
          )}
          {!mcpInfo && diffContent && diffContent.length > 0 && (
            <div>
              {diffContent.map((item, index) => (
                <ContentView key={index} content={item} />
              ))}
            </div>
          )}
          <div className='text-xs text-t-secondary mt-2'>Tool Call ID: {toolCallId}</div>
        </div>
      </div>
    </Card>
  );
};

export default MessageAcpToolCall;
