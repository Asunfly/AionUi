/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteMocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getUserConversations: vi.fn(),
  getChannelSessions: vi.fn(),
  deleteConversation: vi.fn(),
  getLegacyHistory: vi.fn(),
  deleteLegacyConversationStorage: vi.fn(),
  movePathToTrash: vi.fn(),
  getSystemDir: vi.fn(() => ({
    workDir: '/tmp/aionui-work',
  })),
}));

vi.mock('@/process/database', () => ({
  getDatabase: () => ({
    getConversation: deleteMocks.getConversation,
    getUserConversations: deleteMocks.getUserConversations,
    getChannelSessions: deleteMocks.getChannelSessions,
    deleteConversation: deleteMocks.deleteConversation,
  }),
}));

vi.mock('@/process/initStorage', () => ({
  ProcessChat: {
    get: async (key: string) => {
      if (key !== 'chat.history') {
        throw new Error(`unexpected key: ${key}`);
      }
      return deleteMocks.getLegacyHistory();
    },
  },
  getSystemDir: deleteMocks.getSystemDir,
}));

vi.mock('@/process/services/conversation/legacyConversationStorage', () => ({
  deleteLegacyConversationStorage: deleteMocks.deleteLegacyConversationStorage,
}));

vi.mock('@/process/services/system/TrashService', () => ({
  movePathToTrash: deleteMocks.movePathToTrash,
}));

describe('deleteConversationData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMocks.getUserConversations.mockReturnValue({
      data: [],
      hasMore: false,
    });
    deleteMocks.getChannelSessions.mockReturnValue({
      success: true,
      data: [],
    });
    deleteMocks.deleteConversation.mockReturnValue({
      success: true,
      data: true,
    });
    deleteMocks.getLegacyHistory.mockResolvedValue([]);
    deleteMocks.deleteLegacyConversationStorage.mockResolvedValue(undefined);
    deleteMocks.movePathToTrash.mockResolvedValue(undefined);
  });

  it('cleans the default temporary workspace when no other conversation references it', async () => {
    deleteMocks.getConversation.mockReturnValue({
      success: true,
      data: {
        id: 'conv-1',
        extra: {
          workspace: '/tmp/aionui-work/gemini-temp-1',
          customWorkspace: false,
        },
      },
    });

    const { deleteConversationData } = await import('../../src/process/services/conversation/deleteConversationData');
    const success = await deleteConversationData('conv-1');

    expect(success).toBe(true);
    expect(deleteMocks.deleteLegacyConversationStorage).toHaveBeenCalledWith('conv-1');
    expect(deleteMocks.movePathToTrash).toHaveBeenCalledWith(path.join('/tmp/aionui-work', 'gemini-temp-1'));
  });

  it('does not delete custom or shared workspaces', async () => {
    deleteMocks.getConversation.mockReturnValue({
      success: true,
      data: {
        id: 'conv-1',
        extra: {
          workspace: '/tmp/aionui-work/gemini-temp-1',
          customWorkspace: false,
        },
      },
    });
    deleteMocks.getUserConversations.mockReturnValue({
      data: [
        {
          id: 'conv-2',
          extra: {
            workspace: '/tmp/aionui-work/gemini-temp-1',
            customWorkspace: false,
          },
        },
      ],
      hasMore: false,
    });

    const { deleteConversationData } = await import('../../src/process/services/conversation/deleteConversationData');
    const success = await deleteConversationData('conv-1');

    expect(success).toBe(true);
    expect(deleteMocks.movePathToTrash).not.toHaveBeenCalled();

    vi.resetModules();
    deleteMocks.getConversation.mockReturnValue({
      success: true,
      data: {
        id: 'conv-3',
        extra: {
          workspace: '/Users/demo/project',
          customWorkspace: true,
        },
      },
    });
    deleteMocks.getUserConversations.mockReturnValue({
      data: [],
      hasMore: false,
    });

    const reimported = await import('../../src/process/services/conversation/deleteConversationData');
    const secondSuccess = await reimported.deleteConversationData('conv-3');

    expect(secondSuccess).toBe(true);
    expect(deleteMocks.movePathToTrash).not.toHaveBeenCalled();
  });

  it('does not delete the default workspace when a channel session still references it', async () => {
    deleteMocks.getConversation.mockReturnValue({
      success: true,
      data: {
        id: 'conv-1',
        extra: {
          workspace: '/tmp/aionui-work/gemini-temp-1',
          customWorkspace: false,
        },
      },
    });
    deleteMocks.getChannelSessions.mockReturnValue({
      success: true,
      data: [
        {
          id: 'session-1',
          conversationId: 'conv-2',
          workspace: '/tmp/aionui-work/gemini-temp-1',
        },
      ],
    });

    const { deleteConversationData } = await import('../../src/process/services/conversation/deleteConversationData');
    const success = await deleteConversationData('conv-1');

    expect(success).toBe(true);
    expect(deleteMocks.movePathToTrash).not.toHaveBeenCalled();
  });
});
