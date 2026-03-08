/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_CLOUD_BACKUP_REMOTE_PATH } from '../../src/common/types/backup';
import { getDefaultCloudBackupSettings, isCloudBackupConfigured, normalizeCloudBackupConfig, normalizeRemotePath, withDefaultCloudBackupSettings } from '../../src/common/utils/backup';

describe('cloud backup utils', () => {
  it('fills missing settings with stable defaults', () => {
    const settings = withDefaultCloudBackupSettings({
      activeProvider: 'nutstore',
      nutstore: {
        username: 'demo',
        password: 'secret',
      },
    });

    expect(settings.activeProvider).toBe('nutstore');
    expect(settings.webdav.remotePath).toBe(DEFAULT_CLOUD_BACKUP_REMOTE_PATH);
    expect(settings.nutstore.remotePath).toBe(DEFAULT_CLOUD_BACKUP_REMOTE_PATH);
    expect(settings.includeDefaultWorkspaceFiles).toBe(false);
    expect(settings.autoBackupEnabled).toBe(false);
    expect(settings.autoBackupIntervalHours).toBe(24);
    expect(settings.maxBackupCount).toBe(10);
    expect(settings.lastBackupStatus).toBe('idle');
  });

  it('normalizes remote paths and falls back to the default directory', () => {
    expect(normalizeRemotePath()).toBe(DEFAULT_CLOUD_BACKUP_REMOTE_PATH);
    expect(normalizeRemotePath('')).toBe(DEFAULT_CLOUD_BACKUP_REMOTE_PATH);
    expect(normalizeRemotePath('nested/backups')).toBe('/nested/backups');
    expect(normalizeRemotePath('\\nested\\backups\\')).toBe('/nested/backups/');
  });

  it('maps nutstore to the fixed WebDAV endpoint', () => {
    const settings = withDefaultCloudBackupSettings({
      activeProvider: 'nutstore',
      nutstore: {
        username: 'nut-user',
        password: 'nut-pass',
        remotePath: '',
      },
    });

    expect(normalizeCloudBackupConfig(settings)).toEqual({
      provider: 'nutstore',
      host: 'https://dav.jianguoyun.com/dav',
      username: 'nut-user',
      password: 'nut-pass',
      remotePath: DEFAULT_CLOUD_BACKUP_REMOTE_PATH,
    });
  });

  it('validates provider completeness with the correct rules', () => {
    const defaults = getDefaultCloudBackupSettings();

    expect(isCloudBackupConfigured(defaults)).toBe(false);

    expect(
      isCloudBackupConfigured({
        ...defaults,
        webdav: {
          host: 'https://example.com/dav',
          username: 'demo',
          password: 'secret',
          remotePath: '/demo',
        },
      })
    ).toBe(true);

    expect(
      isCloudBackupConfigured({
        ...defaults,
        activeProvider: 'nutstore',
        nutstore: {
          username: 'demo',
          password: 'secret',
          remotePath: '/demo',
        },
      })
    ).toBe(true);
  });
});
