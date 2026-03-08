/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
  isElectronDesktop: vi.fn(() => true),
  getCloudBackupSettings: vi.fn(),
  runCloudRemoteBackup: vi.fn(),
  saveCloudBackupSettings: vi.fn(),
  startCloudBackupClient: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: schedulerMocks.isElectronDesktop,
}));

vi.mock('../../src/renderer/services/cloudBackup', () => ({
  getCloudBackupSettings: schedulerMocks.getCloudBackupSettings,
  runCloudRemoteBackup: schedulerMocks.runCloudRemoteBackup,
  saveCloudBackupSettings: schedulerMocks.saveCloudBackupSettings,
  startCloudBackupClient: schedulerMocks.startCloudBackupClient,
}));

describe('cloudBackupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T08:00:00.000Z'));
    vi.clearAllMocks();
    schedulerMocks.isElectronDesktop.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first-startup backup once per day and schedules interval backups', async () => {
    schedulerMocks.getCloudBackupSettings.mockResolvedValue({
      activeProvider: 'webdav',
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
      lastBackupStatus: 'idle',
    });
    schedulerMocks.saveCloudBackupSettings.mockResolvedValue(undefined);
    schedulerMocks.runCloudRemoteBackup.mockResolvedValue(undefined);

    vi.resetModules();
    const { startCloudBackupScheduler } = await import('../../src/renderer/services/cloudBackupScheduler');

    await startCloudBackupScheduler();

    expect(schedulerMocks.startCloudBackupClient).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.saveCloudBackupSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        lastStartupAutoBackupDate: '2026-03-07',
      })
    );
    expect(schedulerMocks.runCloudRemoteBackup).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.runCloudRemoteBackup).toHaveBeenCalledWith(expect.any(Object), {
      automatic: true,
    });

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(schedulerMocks.runCloudRemoteBackup).toHaveBeenCalledTimes(2);
  });

  it('does not rerun the startup backup when today already has a startup snapshot', async () => {
    schedulerMocks.getCloudBackupSettings.mockResolvedValue({
      activeProvider: 'webdav',
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
      lastBackupStatus: 'idle',
      lastStartupAutoBackupDate: '2026-03-07',
    });
    schedulerMocks.saveCloudBackupSettings.mockResolvedValue(undefined);

    vi.resetModules();
    const { startCloudBackupScheduler } = await import('../../src/renderer/services/cloudBackupScheduler');

    await startCloudBackupScheduler();

    expect(schedulerMocks.saveCloudBackupSettings).not.toHaveBeenCalled();
    expect(schedulerMocks.runCloudRemoteBackup).not.toHaveBeenCalled();
  });
});
