import { test, expect } from '../fixtures';
import { cleanupE2EConversations, createConversationForWorkspaceMode, goToGuid, goToSettings } from '../helpers';

async function refreshConversationList(page: import('@playwright/test').Page): Promise<void> {
  await goToSettings(page, 'about');
  await goToGuid(page);
}

async function expandWorkspaceGroup(page: import('@playwright/test').Page, conversationId: string): Promise<void> {
  const workspacePath = `C:/aionui-e2e/${conversationId}`;
  await page.evaluate((targetWorkspacePath) => {
    const storageKey = 'aionui_workspace_expansion';
    const currentRaw = localStorage.getItem(storageKey);
    const current = currentRaw ? (JSON.parse(currentRaw) as string[]) : [];
    if (!current.includes(targetWorkspacePath)) {
      current.push(targetWorkspacePath);
      localStorage.setItem(storageKey, JSON.stringify(current));
    }
  }, workspacePath);
}

function getConversationRow(page: import('@playwright/test').Page, conversationId: string) {
  return page.locator(`[data-conversation-id="${conversationId}"]`).first();
}

async function ensureConversationRowVisible(page: import('@playwright/test').Page, conversationId: string) {
  const row = getConversationRow(page, conversationId);
  await expect(row).toBeVisible({ timeout: 15000 });
  return row;
}

async function openDeleteDialogForConversation(page: import('@playwright/test').Page, conversationId: string): Promise<void> {
  const row = await ensureConversationRowVisible(page, conversationId);
  await row.hover();

  const trigger = row.locator('[data-conversation-menu-trigger="true"]').first();
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();

  const deleteItem = page.locator('[data-menu-action="delete"]').last();
  if ((await deleteItem.count()) > 0) {
    await deleteItem.click();
  } else {
    await page.locator('.arco-dropdown-menu-item').last().click();
  }

  await expect(page.getByTestId('conversation-delete-dialog-content')).toBeVisible({ timeout: 10000 });
}

async function closeOpenModal(page: import('@playwright/test').Page): Promise<void> {
  const closeButton = page.locator('.arco-modal-close-btn').last();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    return;
  }

  await page.keyboard.press('Escape');
}

test.describe('Conversation Delete Dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupE2EConversations(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupE2EConversations(page);
  });

  test('shows the temporary-workspace delete reminder', async ({ page }) => {
    const conversation = await createConversationForWorkspaceMode(page, 'temporary', 'Temporary workspace topic');

    await refreshConversationList(page);
    await openDeleteDialogForConversation(page, conversation.id);
    await expect(page.getByTestId('conversation-delete-impact-temporary')).toBeVisible();
    await closeOpenModal(page);
  });

  test('shows the migrated-workspace delete reminder', async ({ page }) => {
    const conversation = await createConversationForWorkspaceMode(page, 'migrated', 'Migrated workspace topic');

    await expandWorkspaceGroup(page, conversation.id);
    await refreshConversationList(page);
    await openDeleteDialogForConversation(page, conversation.id);
    await expect(page.getByTestId('conversation-delete-impact-migrated')).toBeVisible();
    await closeOpenModal(page);
  });

  test('shows the manual-workspace delete reminder', async ({ page }) => {
    const conversation = await createConversationForWorkspaceMode(page, 'manual', 'Manual workspace topic');

    await expandWorkspaceGroup(page, conversation.id);
    await refreshConversationList(page);
    await openDeleteDialogForConversation(page, conversation.id);
    await expect(page.getByTestId('conversation-delete-impact-manual')).toBeVisible();
    await closeOpenModal(page);
  });

  test('shows all workspace reminder groups in the mixed batch delete dialog', async ({ page }) => {
    await createConversationForWorkspaceMode(page, 'temporary', 'Batch temporary topic');
    await createConversationForWorkspaceMode(page, 'migrated', 'Batch migrated topic');
    await createConversationForWorkspaceMode(page, 'manual', 'Batch manual topic');

    await refreshConversationList(page);

    await page.getByTestId('conversation-batch-toggle').click();
    await page.getByTestId('conversation-batch-select-all').click();
    await page.getByTestId('conversation-batch-delete').click();

    await expect(page.getByTestId('conversation-batch-delete-dialog-content')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('conversation-batch-delete-impact-temporary')).toBeVisible();
    await expect(page.getByTestId('conversation-batch-delete-impact-migrated')).toBeVisible();
    await expect(page.getByTestId('conversation-batch-delete-impact-manual')).toBeVisible();

    await closeOpenModal(page);
  });
});
