/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { getDatabase } from '@/process/database';
import { getSystemDir, ProcessChat } from '@/process/initStorage';
import { getManagedWorkspaceRelativePath } from '@/process/services/backup/workspaceBackup';
import path from 'path';
import { movePathToTrash } from '../system/TrashService';
import { deleteLegacyConversationStorage } from './legacyConversationStorage';

function normalizeWorkspacePath(workspace: string): string {
  const normalized = path.resolve(workspace).replace(/\\/g, '/').replace(/\/+$/g, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function getLegacyConversations(): Promise<TChatConversation[]> {
  const history = await ProcessChat.get('chat.history');
  return Array.isArray(history) ? history : [];
}

function getConversationWorkspace(conversation: TChatConversation | undefined): string | null {
  return typeof conversation?.extra?.workspace === 'string' ? conversation.extra.workspace : null;
}

async function getAllDatabaseConversations(): Promise<TChatConversation[]> {
  const db = getDatabase();
  const conversations: TChatConversation[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const result = db.getUserConversations(undefined, page, 1000);
    conversations.push(...result.data);
    hasMore = result.hasMore;
    page += 1;
  }

  return conversations;
}

async function getWorkspaceToDelete(conversationId: string, conversation: TChatConversation | undefined): Promise<string | null> {
  const workspace = getConversationWorkspace(conversation);
  const customWorkspace = typeof conversation?.extra?.customWorkspace === 'boolean' ? conversation.extra.customWorkspace : undefined;
  const workDir = getSystemDir().workDir;

  if (!workspace) {
    return null;
  }

  const relativeRoot = getManagedWorkspaceRelativePath(workspace, workDir, process.platform, customWorkspace);
  if (!relativeRoot) {
    return null;
  }

  const candidateWorkspacePath = path.join(workDir, ...relativeRoot.split('/').filter(Boolean));
  const normalizedCandidatePath = normalizeWorkspacePath(candidateWorkspacePath);
  const [dbConversations, legacyConversations] = await Promise.all([getAllDatabaseConversations(), getLegacyConversations()]);

  const hasConversationReference = [...dbConversations, ...legacyConversations].some((item) => {
    if (item.id === conversationId) {
      return false;
    }

    const itemWorkspace = getConversationWorkspace(item);
    return itemWorkspace ? normalizeWorkspacePath(itemWorkspace) === normalizedCandidatePath : false;
  });
  if (hasConversationReference) {
    return null;
  }

  const sessionResult = getDatabase().getChannelSessions();
  const hasSessionReference =
    sessionResult.success &&
    (sessionResult.data || []).some((session) => {
      const sessionConversationId = (session as { conversationId?: string | null }).conversationId;
      if (sessionConversationId === conversationId) {
        return false;
      }

      const sessionWorkspace = typeof (session as { workspace?: string | null }).workspace === 'string' ? (session as { workspace: string }).workspace : null;
      return sessionWorkspace ? normalizeWorkspacePath(sessionWorkspace) === normalizedCandidatePath : false;
    });

  return hasSessionReference ? null : candidateWorkspacePath;
}

export async function deleteConversationData(conversationId: string): Promise<boolean> {
  const db = getDatabase();
  const dbConversationResult = db.getConversation(conversationId);
  const legacyConversations = await getLegacyConversations();
  const legacyConversation = legacyConversations.find((conversation) => conversation.id === conversationId);
  const databaseConversation = dbConversationResult.success ? dbConversationResult.data : null;
  const conversation = databaseConversation || legacyConversation;

  if (!conversation) {
    return false;
  }

  const workspaceToDelete = await getWorkspaceToDelete(conversationId, conversation || undefined);
  if (databaseConversation) {
    const deleteResult = db.deleteConversation(conversationId);
    if (!deleteResult.success) {
      return false;
    }
  }

  await deleteLegacyConversationStorage(conversationId).catch((error) => {
    console.warn('[deleteConversationData] Failed to cleanup legacy conversation storage:', error);
  });

  if (workspaceToDelete) {
    await movePathToTrash(workspaceToDelete).catch((error) => {
      console.warn('[deleteConversationData] Failed to move default workspace to trash:', error);
    });
  }

  return true;
}
