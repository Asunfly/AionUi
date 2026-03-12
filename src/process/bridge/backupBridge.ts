/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { backupService } from '@/process/services/backup/BackupService';
import { backupSchedulerService } from '@/process/services/backup/BackupSchedulerService';
import { getBackupErrorCode } from '@/process/services/backup/BackupTaskError';

export function initBackupBridge(): void {
  ipcBridge.backup.getSuggestedFileName.provider(({ remark }) => {
    return Promise.resolve(backupService.getSuggestedFileName(remark));
  });

  ipcBridge.backup.checkRemoteConnection.provider(async ({ settings }) => {
    try {
      const data = await backupService.checkRemoteConnection(settings);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        code: getBackupErrorCode(error),
      };
    }
  });

  ipcBridge.backup.runRemoteBackup.provider(async ({ settings, fileName, automatic, requestId }) => {
    try {
      const data = await backupService.runRemoteBackup(settings, fileName, automatic, requestId);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        code: getBackupErrorCode(error),
      };
    }
  });

  ipcBridge.backup.cancelTask.provider(async ({ requestId } = {}) => {
    try {
      return {
        success: true,
        data: {
          canceled: backupService.cancelTask(requestId),
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        code: getBackupErrorCode(error),
      };
    }
  });

  ipcBridge.backup.listRemotePackages.provider(async ({ settings }) => {
    try {
      const data = await backupService.listRemotePackages(settings);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        code: getBackupErrorCode(error),
      };
    }
  });

  ipcBridge.backup.restoreRemotePackage.provider(async ({ settings, fileName }) => {
    try {
      const data = await backupService.restoreRemotePackage(settings, fileName);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        code: getBackupErrorCode(error),
      };
    }
  });

  ipcBridge.backup.startScheduler.provider(async () => {
    await backupSchedulerService.start();
  });

  ipcBridge.backup.refreshScheduler.provider(async () => {
    await backupSchedulerService.refresh();
  });
}
