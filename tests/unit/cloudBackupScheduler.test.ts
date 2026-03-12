/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
  isElectronDesktop: vi.fn(() => true),
  startCloudBackupClient: vi.fn(),
  startScheduler: vi.fn(),
  refreshScheduler: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: schedulerMocks.isElectronDesktop,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    backup: {
      startScheduler: {
        invoke: schedulerMocks.startScheduler,
      },
      refreshScheduler: {
        invoke: schedulerMocks.refreshScheduler,
      },
    },
  },
}));

vi.mock('../../src/renderer/services/cloudBackup', () => ({
  startCloudBackupClient: schedulerMocks.startCloudBackupClient,
}));

describe('cloudBackupScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schedulerMocks.isElectronDesktop.mockReturnValue(true);
    schedulerMocks.startScheduler.mockResolvedValue(undefined);
    schedulerMocks.refreshScheduler.mockResolvedValue(undefined);
  });

  it('starts the process scheduler and cloud backup client on desktop', async () => {
    vi.resetModules();
    const { startCloudBackupScheduler } = await import('../../src/renderer/services/cloudBackupScheduler');

    await startCloudBackupScheduler();

    expect(schedulerMocks.startCloudBackupClient).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.startScheduler).toHaveBeenCalledTimes(1);
  });

  it('refreshes the process scheduler on desktop', async () => {
    vi.resetModules();
    const { refreshCloudBackupScheduler } = await import('../../src/renderer/services/cloudBackupScheduler');

    await refreshCloudBackupScheduler();

    expect(schedulerMocks.refreshScheduler).toHaveBeenCalledTimes(1);
    expect(schedulerMocks.startCloudBackupClient).not.toHaveBeenCalled();
  });
});
