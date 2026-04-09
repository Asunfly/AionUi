/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AllToolCallsCompleteHandler,
  CancelledToolCall,
  CompletedToolCall,
  Config,
  Status as CoreStatus,
  EditorType,
  ExecutingToolCall,
  OutputUpdateHandler,
  ScheduledToolCall,
  ToolCall,
  ToolCallRequestInfo,
  ToolCallsUpdateHandler,
  ValidatingToolCall,
  WaitingToolCall,
} from '@office-ai/aioncli-core';
import { CoreToolScheduler } from '@office-ai/aioncli-core';
import { useCallback, useMemo, useState } from 'react';
import type { HistoryItemToolGroup, HistoryItemWithoutId, IndividualToolCallDisplay } from './types';
import { ToolCallStatus } from './types';

export type ScheduleFn = (request: ToolCallRequestInfo | ToolCallRequestInfo[], signal: AbortSignal) => void;
export type MarkToolsAsSubmittedFn = (callIds: string[]) => void;

export type TrackedScheduledToolCall = ScheduledToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedValidatingToolCall = ValidatingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedWaitingToolCall = WaitingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedExecutingToolCall = ExecutingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedCompletedToolCall = CompletedToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedCancelledToolCall = CancelledToolCall & {
  responseSubmittedToGemini?: boolean;
};

export type TrackedToolCall =
  | TrackedScheduledToolCall
  | TrackedValidatingToolCall
  | TrackedWaitingToolCall
  | TrackedExecutingToolCall
  | TrackedCompletedToolCall
  | TrackedCancelledToolCall;

// aioncli-core v0.18.4: onEditorClose 回调已从 CoreToolSchedulerOptions 中移除
// aioncli-core v0.18.4: onEditorClose callback was removed from CoreToolSchedulerOptions
export function useReactToolScheduler(
  onComplete: (tools: CompletedToolCall[]) => Promise<void>,
  config: Config,
  setPendingHistoryItem: React.Dispatch<React.SetStateAction<HistoryItemWithoutId | null>>,
  getPreferredEditor: () => EditorType | undefined
): [TrackedToolCall[], ScheduleFn, MarkToolsAsSubmittedFn] {
  const [toolCallsForDisplay, setToolCallsForDisplay] = useState<TrackedToolCall[]>([]);

  const outputUpdateHandler: OutputUpdateHandler = useCallback(
    (toolCallId, outputChunk) => {
      setPendingHistoryItem((prevItem) => {
        if (prevItem?.type === 'tool_group') {
          return {
            ...prevItem,
            tools: prevItem.tools.map((toolDisplay) =>
              toolDisplay.callId === toolCallId && toolDisplay.status === ToolCallStatus.Executing
                ? { ...toolDisplay, resultDisplay: outputChunk }
                : toolDisplay
            ),
          };
        }
        return prevItem;
      });

      setToolCallsForDisplay((prevCalls) =>
        prevCalls.map((tc) => {
          if (tc.request.callId === toolCallId && tc.status === 'executing') {
            const executingTc = tc as TrackedExecutingToolCall;
            return { ...executingTc, liveOutput: outputChunk };
          }
          return tc;
        })
      );
    },
    [setPendingHistoryItem]
  );

  const allToolCallsCompleteHandler: AllToolCallsCompleteHandler = useCallback(
    async (completedToolCalls) => {
      await onComplete(completedToolCalls);
    },
    [onComplete]
  );

  const toolCallsUpdateHandler: ToolCallsUpdateHandler = useCallback(
    (updatedCoreToolCalls: ToolCall[]) => {
      setToolCallsForDisplay((prevTrackedCalls) =>
        updatedCoreToolCalls.map((coreTc) => {
          const existingTrackedCall = prevTrackedCalls.find((ptc) => ptc.request.callId === coreTc.request.callId);
          const newTrackedCall: TrackedToolCall = {
            ...coreTc,
            responseSubmittedToGemini: existingTrackedCall?.responseSubmittedToGemini ?? false,
          } as TrackedToolCall;
          return newTrackedCall;
        })
      );
    },
    [setToolCallsForDisplay]
  );

  const scheduler = useMemo(
    () =>
      new CoreToolScheduler({
        config,
        outputUpdateHandler,
        onAllToolCallsComplete: allToolCallsCompleteHandler,
        onToolCallsUpdate: toolCallsUpdateHandler,
        getPreferredEditor,
        // onEditorClose 在 aioncli-core v0.18.4 中已移除
        // onEditorClose was removed in aioncli-core v0.18.4
      }),
    [config, outputUpdateHandler, allToolCallsCompleteHandler, toolCallsUpdateHandler, getPreferredEditor]
  );

  const schedule: ScheduleFn = useCallback(
    (request: ToolCallRequestInfo | ToolCallRequestInfo[], signal: AbortSignal) => {
      void scheduler.schedule(request, signal);
    },
    [scheduler]
  );

  const markToolsAsSubmitted: MarkToolsAsSubmittedFn = useCallback((callIdsToMark: string[]) => {
    setToolCallsForDisplay((prevCalls) =>
      prevCalls.map((tc) =>
        callIdsToMark.includes(tc.request.callId) ? { ...tc, responseSubmittedToGemini: true } : tc
      )
    );
  }, []);

  return [toolCallsForDisplay, schedule, markToolsAsSubmitted];
}

/**
 * Maps a CoreToolScheduler status to the UI's ToolCallStatus enum.
 */
function mapCoreStatusToDisplayStatus(coreStatus: CoreStatus): ToolCallStatus {
  switch (coreStatus) {
    case 'validating':
      return ToolCallStatus.Executing;
    case 'awaiting_approval':
      return ToolCallStatus.Confirming;
    case 'executing':
      return ToolCallStatus.Executing;
    case 'success':
      return ToolCallStatus.Success;
    case 'cancelled':
      return ToolCallStatus.Canceled;
    case 'error':
      return ToolCallStatus.Error;
    case 'scheduled':
      return ToolCallStatus.Pending;
    default: {
      console.warn(`Unknown core status encountered: ${coreStatus}`);
      return ToolCallStatus.Error;
    }
  }
}

function parseQualifiedMcpToolName(name: string): { serverName: string; toolName: string } | undefined {
  const [serverName, ...toolNameParts] = name.split('__');
  if (!serverName || toolNameParts.length === 0) {
    return undefined;
  }

  const toolName = toolNameParts.join('__');
  if (!toolName) {
    return undefined;
  }

  return { serverName, toolName };
}

function getMcpToolDisplay(
  trackedCall: TrackedToolCall,
  displayName: string
): IndividualToolCallDisplay['mcp'] | undefined {
  const tool = trackedCall.tool as
    | Partial<{
        displayName: string;
        serverName: string;
        serverToolName: string;
      }>
    | undefined;
  const invocation = ('invocation' in trackedCall ? trackedCall.invocation : undefined) as
    | Partial<{
        serverName: string;
        serverToolName: string;
      }>
    | undefined;
  const confirmationDetails =
    trackedCall.status === 'awaiting_approval' && trackedCall.confirmationDetails?.type === 'mcp'
      ? trackedCall.confirmationDetails
      : undefined;
  const requestInfo = parseQualifiedMcpToolName(trackedCall.request.name);
  const serverName =
    tool?.serverName ?? invocation?.serverName ?? confirmationDetails?.serverName ?? requestInfo?.serverName;
  const toolName =
    tool?.serverToolName ?? invocation?.serverToolName ?? confirmationDetails?.toolName ?? requestInfo?.toolName;

  if (!serverName || !toolName) {
    return undefined;
  }

  return {
    serverName,
    toolName,
    toolDisplayName: confirmationDetails?.toolDisplayName ?? tool?.displayName ?? displayName,
    arguments: trackedCall.request.args,
  };
}

/**
 * Transforms `TrackedToolCall` objects into `HistoryItemToolGroup` objects for UI display.
 */
export function mapToDisplay(toolOrTools: TrackedToolCall[] | TrackedToolCall): HistoryItemToolGroup {
  const toolCalls = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];

  const toolDisplays = toolCalls.map((trackedCall): IndividualToolCallDisplay => {
    let displayName: string;
    let description: string;
    let renderOutputAsMarkdown = false;

    if (trackedCall.status === 'error') {
      displayName = trackedCall.tool === undefined ? trackedCall.request.name : trackedCall.tool.displayName;
      // Include error message in description for better debugging visibility
      // 在描述中包含错误信息，便于调试
      const errorMsg = trackedCall.response.error?.message;
      const argsStr = JSON.stringify(trackedCall.request.args);
      description = errorMsg ? `${errorMsg}\n${argsStr}` : argsStr;
    } else {
      displayName = trackedCall.tool.displayName;
      description = trackedCall.invocation.getDescription();
      renderOutputAsMarkdown = trackedCall.tool.isOutputMarkdown;
    }

    const mcp = getMcpToolDisplay(trackedCall, displayName);
    const buildDisplay = (
      status: ToolCallStatus,
      resultDisplay: IndividualToolCallDisplay['resultDisplay'],
      confirmationDetails: IndividualToolCallDisplay['confirmationDetails']
    ): IndividualToolCallDisplay => ({
      callId: trackedCall.request.callId,
      name: displayName,
      description,
      mcp,
      renderOutputAsMarkdown,
      status,
      resultDisplay,
      confirmationDetails,
    });

    switch (trackedCall.status) {
      case 'success':
        return buildDisplay(
          mapCoreStatusToDisplayStatus(trackedCall.status),
          trackedCall.response.resultDisplay,
          undefined
        );
      case 'error': {
        // Fallback: when resultDisplay is empty, construct from error info
        // 兜底：当 resultDisplay 为空时，从错误信息中构造显示内容
        let errorResultDisplay = trackedCall.response.resultDisplay;
        if (!errorResultDisplay) {
          const errMsg = trackedCall.response.error?.message;
          const errType = trackedCall.response.errorType;
          if (errMsg || errType) {
            errorResultDisplay = [errType && `[${errType}]`, errMsg].filter(Boolean).join(' ');
          }
        }
        return buildDisplay(mapCoreStatusToDisplayStatus(trackedCall.status), errorResultDisplay, undefined);
      }
      case 'cancelled':
        return buildDisplay(
          mapCoreStatusToDisplayStatus(trackedCall.status),
          trackedCall.response.resultDisplay,
          undefined
        );
      case 'awaiting_approval':
        return buildDisplay(mapCoreStatusToDisplayStatus(trackedCall.status), undefined, trackedCall.confirmationDetails);
      case 'executing':
        return buildDisplay(
          mapCoreStatusToDisplayStatus(trackedCall.status),
          (trackedCall as TrackedExecutingToolCall).liveOutput ?? undefined,
          undefined
        );
      case 'validating': // Fallthrough
      case 'scheduled':
        return buildDisplay(mapCoreStatusToDisplayStatus(trackedCall.status), undefined, undefined);
      default: {
        return {
          callId: (trackedCall as TrackedToolCall).request.callId,
          name: 'Unknown Tool',
          description: 'Encountered an unknown tool call state.',
          status: ToolCallStatus.Error,
          resultDisplay: 'Unknown tool call state',
          confirmationDetails: undefined,
          renderOutputAsMarkdown: false,
        };
      }
    }
  });

  return {
    type: 'tool_group',
    tools: toolDisplays,
  };
}
