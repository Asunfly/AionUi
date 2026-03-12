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

  it('does not run an immediate startup backup and only schedules interval backups', async () => {
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
      autoBackupIntervalHours: 1,
      maxBackupCount: 5,
      lastBackupStatus: 'idle' as const,
    };

    schedulerMocks.getConfig.mockResolvedValue(settings);
    schedulerMocks.runRemoteBackup.mockResolvedValue(undefined);

    vi.resetModules();
    const { BackupSchedulerService } = await import('../../src/process/services/backup/BackupSchedulerService');
    const service = new BackupSchedulerService();

    await service.start();

    expect(schedulerMocks.setConfig).not.toHaveBeenCalled();
    expect(schedulerMocks.runRemoteBackup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(schedulerMocks.runRemoteBackup).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.runRemoteBackup).toHaveBeenCalledWith(expect.any(Object), undefined, true);
  });

  it('does not schedule anything when automatic backup is disabled', async () => {
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
      autoBackupEnabled: false,
      autoBackupIntervalHours: 24,
      maxBackupCount: 5,
      lastBackupStatus: 'idle' as const,
    };

    schedulerMocks.getConfig.mockResolvedValue(settings);

    vi.resetModules();
    const { BackupSchedulerService } = await import('../../src/process/services/backup/BackupSchedulerService');
    const service = new BackupSchedulerService();

    await service.start();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(schedulerMocks.setConfig).not.toHaveBeenCalled();
    expect(schedulerMocks.runRemoteBackup).not.toHaveBeenCalled();
  });
});
