/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessChat, ProcessChatMessage } from '@/process/initStorage';

export async function deleteLegacyConversationStorage(conversationId: string): Promise<void> {
  const history = (await ProcessChat.get('chat.history')) || [];
  if (Array.isArray(history)) {
    const filteredHistory = history.filter((conversation) => conversation.id !== conversationId);
    if (filteredHistory.length !== history.length) {
      await ProcessChat.set('chat.history', filteredHistory);
    }
  }

  await ProcessChatMessage.remove(conversationId);
}
