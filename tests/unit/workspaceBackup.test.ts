/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import path from 'path';
import { collectManagedWorkspaceRelativePaths, getManagedWorkspaceRelativePath, mapManagedWorkspacePath, normalizeManagedWorkspaceRelativePath, remapConversationExtraPaths } from '../../src/process/services/backup/workspaceBackup';

describe('workspace backup helpers', () => {
  it('collects only app-managed default workspace roots and deduplicates them', () => {
    const relativeRoots = collectManagedWorkspaceRelativePaths(
      [
        {
          workspace: 'C:\\AionUi\\work\\gemini-temp-1',
          customWorkspace: false,
        },
        {
          workspace: 'C:\\AionUi\\work\\gemini-temp-1',
          customWorkspace: false,
        },
        {
          workspace: 'C:\\AionUi\\work\\codex-temp-2',
        },
        {
          workspace: 'D:\\external-project',
          customWorkspace: true,
        },
      ],
      'C:\\AionUi\\work',
      'win32'
    );

    expect(relativeRoots).toEqual(['codex-temp-2', 'gemini-temp-1']);
  });

  it('maps managed workspace paths to the current machine work directory across platforms', () => {
    expect(mapManagedWorkspacePath('C:\\AionUi\\work\\gemini-temp-1', 'C:\\AionUi\\work', '/home/demo/.config/AionUi/work', 'win32', false)).toBe(path.join('/home/demo/.config/AionUi/work', 'gemini-temp-1'));
    expect(mapManagedWorkspacePath('/Users/demo/aionui/work/codex-temp-2', '/Users/demo/aionui/work', 'D:\\AionUi\\work', 'darwin')).toBe('D:\\AionUi\\work\\codex-temp-2');
    expect(mapManagedWorkspacePath('D:\\external-project', 'C:\\AionUi\\work', '/home/demo/.config/AionUi/work', 'win32', true)).toBe('D:\\external-project');
  });

  it('remaps conversation workspace fields and openclaw runtime validation together', () => {
    const result = remapConversationExtraPaths(
      {
        workspace: 'C:\\AionUi\\work\\openclaw-temp-1',
        customWorkspace: false,
        runtimeValidation: {
          expectedWorkspace: 'C:\\AionUi\\work\\openclaw-temp-1',
          expectedBackend: 'openclaw-gateway',
        },
      },
      'C:\\AionUi\\work',
      '/home/demo/.config/AionUi/work',
      'win32'
    );

    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      workspace: path.join('/home/demo/.config/AionUi/work', 'openclaw-temp-1'),
      customWorkspace: false,
      runtimeValidation: {
        expectedWorkspace: path.join('/home/demo/.config/AionUi/work', 'openclaw-temp-1'),
        expectedBackend: 'openclaw-gateway',
      },
    });
  });

  it('normalizes and validates stored relative workspace paths', () => {
    expect(normalizeManagedWorkspaceRelativePath('gemini-temp-1\\nested')).toBe('gemini-temp-1/nested');
    expect(normalizeManagedWorkspaceRelativePath('../escape')).toBeNull();
    expect(getManagedWorkspaceRelativePath('/tmp/work/../escape', '/tmp/work', 'linux')).toBeNull();
  });
});
