/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  runRemoteBackup: vi.fn(),
}));

vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    get: schedulerMocks.getConfig,
    set: schedulerMocks.setConfig,
  },
}));

vi.mock('@/process/services/backup/BackupService', () => ({
  backupService: {
    runRemoteBackup: schedulerMocks.runRemoteBackup,
  },
}));

describe('BackupSchedulerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T08:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first-startup backup once per day and schedules interval backups', async () => {
    let settings = {
      activeProvider: 'webdav' as const,
      webdav: {
        host: 'https://example.com/dav',
        username: 'demo',
        password: 'secret',
        remotePath: '/AionUibackup',
      },
      nutstore: {
        username: '',
        password: '',
        remotePath: '/AionUibackup',
      },
      includeDefaultWorkspaceFiles: false,
      autoBackupEnabled: true,
      autoBackupIntervalHours: 1,
      maxBackupCount: 5,
      lastBackupStatus: 'idle' as const,
    };

    schedulerMocks.getConfig.mockImplementation(async () => settings);
    schedulerMocks.setConfig.mockImplementation(async (_key: string, nextSettings: typeof settings) => {
      settings = nextSettings;
    });
    schedulerMocks.runRemoteBackup.mockResolvedValue(undefined);

    vi.resetModules();
    const { BackupSchedulerService } = await import('../../src/process/services/backup/BackupSchedulerService');
    const service = new BackupSchedulerService();

    await service.start();

    expect(schedulerMocks.setConfig).toHaveBeenCalledWith(
      'backup.cloud',
      expect.objectContaining({
        lastStartupAutoBackupDate: '2026-03-07',
      })
    );
    expect(schedulerMocks.runRemoteBackup).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.runRemoteBackup).toHaveBeenCalledWith(expect.any(Object), undefined, true);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(schedulerMocks.runRemoteBackup).toHaveBeenCalledTimes(2);
  });

  it('does not rerun the startup backup when today already has a startup snapshot', async () => {
    const settings = {
      activeProvider: 'webdav' as const,
      webdav: {
        host: 'https://example.com/dav',
        username: 'demo',
        password: 'secret',
        remotePath: '/AionUibackup',
      },
      nutstore: {
        username: '',
        password: '',
        remotePath: '/AionUibackup',
      },
      includeDefaultWorkspaceFiles: false,
      autoBackupEnabled: true,
      autoBackupIntervalHours: 24,
      maxBackupCount: 5,
      lastBackupStatus: 'idle' as const,
      lastStartupAutoBackupDate: '2026-03-07',
    };

    schedulerMocks.getConfig.mockResolvedValue(settings);

    vi.resetModules();
    const { BackupSchedulerService } = await import('../../src/process/services/backup/BackupSchedulerService');
    const service = new BackupSchedulerService();

    await service.start();

    expect(schedulerMocks.setConfig).not.toHaveBeenCalled();
    expect(schedulerMocks.runRemoteBackup).not.toHaveBeenCalled();
  });
});
