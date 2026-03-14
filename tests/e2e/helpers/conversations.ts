import type { TChatConversation, TWorkspaceSource } from '../../../src/common/storage';
import type { Page } from '@playwright/test';
import { invokeBridge } from './bridge';

const E2E_PROVIDER = {
  id: 'e2e-provider',
  platform: 'openai',
  name: 'E2E Provider',
  baseUrl: 'https://example.invalid',
  apiKey: 'e2e-key',
  enabled: true,
  useModel: 'gpt-4.1',
} as const;

export const E2E_CONVERSATION_PREFIX = '[E2E Trash/Backup]';

export type E2EWorkspaceMode = TWorkspaceSource;

type E2EGeminiConversation = Extract<TChatConversation, { type: 'gemini' }>;

function buildWorkspaceExtra(mode: E2EWorkspaceMode, workspacePath: string): E2EGeminiConversation['extra'] {
  if (mode === 'temporary') {
    return {
      workspace: workspacePath,
      customWorkspace: false,
      workspaceSource: 'temporary',
    };
  }

  return {
    workspace: workspacePath,
    customWorkspace: true,
    workspaceSource: mode,
  };
}

export async function listUserConversations(page: Page): Promise<TChatConversation[]> {
  return invokeBridge<TChatConversation[]>(page, 'database.get-user-conversations', {
    page: 0,
    pageSize: 10000,
  });
}

export async function createConversationForWorkspaceMode(page: Page, mode: E2EWorkspaceMode, nameSuffix: string): Promise<TChatConversation> {
  const randomToken = Math.random().toString(36).slice(2, 10);
  const conversationId = `e2e-${mode}-${Date.now()}-${randomToken}`;
  const workspacePath = `C:/aionui-e2e/${conversationId}`;

  const conversation: E2EGeminiConversation = {
    id: conversationId,
    name: `${E2E_CONVERSATION_PREFIX} ${nameSuffix}`,
    type: 'gemini',
    createTime: Date.now(),
    modifyTime: Date.now(),
    source: 'aionui',
    status: 'finished',
    model: E2E_PROVIDER,
    extra: buildWorkspaceExtra(mode, workspacePath),
  };

  return invokeBridge<TChatConversation>(page, 'create-conversation-with-conversation', { conversation });
}

export async function removeConversationById(page: Page, id: string): Promise<void> {
  await invokeBridge(page, 'remove-conversation', { id });
}

export async function cleanupE2EConversations(page: Page, prefix = E2E_CONVERSATION_PREFIX): Promise<void> {
  const conversations = await listUserConversations(page);
  const matched = conversations.filter((conversation) => conversation.name.startsWith(prefix));

  await Promise.all(
    matched.map(async (conversation) => {
      try {
        await removeConversationById(page, conversation.id);
      } catch {
        // Best-effort cleanup to keep tests isolated.
      }
    })
  );
}

