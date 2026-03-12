/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { startCloudBackupClient } from './cloudBackup';

export async function refreshCloudBackupScheduler(): Promise<void> {
  if (!isElectronDesktop()) {
    return;
  }

  await ipcBridge.backup.refreshScheduler.invoke();
}

export async function startCloudBackupScheduler(): Promise<void> {
  if (!isElectronDesktop()) {
    return;
  }

  startCloudBackupClient();
  await ipcBridge.backup.startScheduler.invoke();
}
