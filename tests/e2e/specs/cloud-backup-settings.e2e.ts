import { test, expect } from '../fixtures';
import { goToSettings } from '../helpers';

const NUTSTORE_HOST = 'https://dav.jianguoyun.com/dav';

async function openBackupPanel(page: import('@playwright/test').Page): Promise<void> {
  await goToSettings(page, 'system');

  const providerField = page.getByTestId('backup-provider-field');
  if ((await providerField.count()) === 0) {
    await page.getByTestId('backup-panel-toggle').click();
  }

  await expect(providerField).toBeVisible({ timeout: 10000 });
}

test.describe('Cloud Backup Settings', () => {
  test('keeps the backup panel collapsed by default and expands into the configuration area', async ({ page }) => {
    await goToSettings(page, 'system');

    await expect(page.getByTestId('backup-provider-field')).toHaveCount(0);
    await expect(page.getByTestId('backup-manual-action')).toHaveCount(0);

    await page.getByTestId('backup-panel-toggle').click();

    await expect(page.getByTestId('backup-provider-field')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('backup-manual-action')).toBeVisible();
    await expect(page.getByTestId('backup-restore-action')).toBeVisible();
  });

  test('enforces required-field gating in the backup configuration panel', async ({ page }) => {
    await openBackupPanel(page);

    const linkInput = page.getByTestId('backup-link-field').locator('input').first();
    const accountInput = page.getByTestId('backup-account-field').locator('input').first();
    const passwordInput = page.getByTestId('backup-password-field').locator('input').first();

    const isReadonlyHost = await linkInput.evaluate((element) => element.hasAttribute('readonly'));
    if (isReadonlyHost) {
      await expect(linkInput).toHaveValue(NUTSTORE_HOST);
    } else {
      await linkInput.fill('');
    }

    await accountInput.fill('');
    await passwordInput.fill('');

    await expect(page.getByTestId('backup-manual-action')).toBeDisabled();
    await expect(page.getByTestId('backup-restore-action')).toBeDisabled();
  });
});
