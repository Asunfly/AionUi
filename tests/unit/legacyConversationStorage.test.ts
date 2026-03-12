/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getChatHistory: vi.fn(),
  setChatHistory: vi.fn(),
  removeChatMessages: vi.fn(),
}));

vi.mock('@/process/initStorage', () => ({
  ProcessChat: {
    get: async (key: string) => {
      if (key !== 'chat.history') {
        throw new Error(`unexpected key: ${key}`);
      }
      return storageMocks.getChatHistory();
    },
    set: async (key: string, value: unknown) => {
      if (key !== 'chat.history') {
        throw new Error(`unexpected key: ${key}`);
      }
      return storageMocks.setChatHistory(value);
    },
  },
  ProcessChatMessage: {
    remove: storageMocks.removeChatMessages,
  },
}));

describe('deleteLegacyConversationStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes the deleted conversation from legacy history and message storage without touching workspace paths', async () => {
    storageMocks.getChatHistory.mockResolvedValue([
      {
        id: 'conv-1',
        extra: {
          workspace: '/user/custom-workspace',
          customWorkspace: true,
        },
      },
      {
        id: 'conv-2',
        extra: {
          workspace: '/tmp/aionui/work/gemini-temp-2',
          customWorkspace: false,
        },
      },
    ]);

    const { deleteLegacyConversationStorage } = await import('../../src/process/services/conversation/legacyConversationStorage');
    await deleteLegacyConversationStorage('conv-1');

    expect(storageMocks.setChatHistory).toHaveBeenCalledWith([
      {
        id: 'conv-2',
        extra: {
          workspace: '/tmp/aionui/work/gemini-temp-2',
          customWorkspace: false,
        },
      },
    ]);
    expect(storageMocks.removeChatMessages).toHaveBeenCalledWith('conv-1');
  });

  it('still removes legacy message storage when the conversation is already absent from history', async () => {
    storageMocks.getChatHistory.mockResolvedValue([
      {
        id: 'conv-2',
        extra: {
          workspace: '/tmp/aionui/work/gemini-temp-2',
          customWorkspace: false,
        },
      },
    ]);

    const { deleteLegacyConversationStorage } = await import('../../src/process/services/conversation/legacyConversationStorage');
    await deleteLegacyConversationStorage('conv-missing');

    expect(storageMocks.setChatHistory).not.toHaveBeenCalled();
    expect(storageMocks.removeChatMessages).toHaveBeenCalledWith('conv-missing');
  });
});
