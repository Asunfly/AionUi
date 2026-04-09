import { describe, expect, it } from 'vitest';
import { mapToDisplay } from '@/process/agent/gemini/cli/useReactToolScheduler';
import type { TrackedToolCall } from '@/process/agent/gemini/cli/useReactToolScheduler';

describe('mapToDisplay MCP metadata', () => {
  it('includes MCP server and tool metadata for discovered MCP tool calls', () => {
    const trackedCall = {
      status: 'success',
      request: {
        callId: 'call-1',
        name: 'drawio__create_diagram',
        args: { title: 'ERD' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
      tool: {
        displayName: 'Create Diagram',
        isOutputMarkdown: false,
        serverName: 'drawio',
        serverToolName: 'create_diagram',
      },
      invocation: {
        getDescription: () => '{"title":"ERD"}',
        serverName: 'drawio',
        serverToolName: 'create_diagram',
      },
      response: {
        responseParts: [],
        resultDisplay: 'Diagram created',
        error: undefined,
        errorType: undefined,
      },
    } as unknown as TrackedToolCall;

    const display = mapToDisplay([trackedCall]);

    expect(display.tools[0].mcp).toEqual({
      arguments: { title: 'ERD' },
      serverName: 'drawio',
      toolName: 'create_diagram',
      toolDisplayName: 'Create Diagram',
    });
  });

  it('does not attach MCP metadata for non-MCP tools', () => {
    const trackedCall = {
      status: 'success',
      request: {
        callId: 'call-2',
        name: 'read_file',
        args: { path: 'README.md' },
        isClientInitiated: false,
        prompt_id: 'prompt-2',
      },
      tool: {
        displayName: 'ReadFile',
        isOutputMarkdown: false,
      },
      invocation: {
        getDescription: () => '{"path":"README.md"}',
      },
      response: {
        responseParts: [],
        resultDisplay: 'file contents',
        error: undefined,
        errorType: undefined,
      },
    } as unknown as TrackedToolCall;

    const display = mapToDisplay([trackedCall]);

    expect(display.tools[0].mcp).toBeUndefined();
  });
});
