/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/storage';
import type { ICloudBackupSettings } from '@/common/types/backup';
import { isCloudBackupConfigured, withDefaultCloudBackupSettings } from '@/common/utils/backup';
import { backupService } from './BackupService';

export class BackupSchedulerService {
  private started = false;
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    await this.maybeRunStartupBackup();
    await this.scheduleNextRun();
  }

  async refresh(): Promise<void> {
    if (!this.started) {
      await this.start();
      return;
    }

    await this.scheduleNextRun();
  }

  clear(): void {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  private getTodayKey(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  private async getSettings(): Promise<ICloudBackupSettings> {
    return withDefaultCloudBackupSettings(await ConfigStorage.get('backup.cloud'));
  }

  private async saveSettings(settings: ICloudBackupSettings): Promise<void> {
    await ConfigStorage.set('backup.cloud', settings);
  }

  private async performAutomaticBackup(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.autoBackupEnabled || !isCloudBackupConfigured(settings)) {
      return;
    }

    await backupService.runRemoteBackup(settings, undefined, true);
  }

  private async maybeRunStartupBackup(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.autoBackupEnabled || !isCloudBackupConfigured(settings)) {
      return;
    }

    const todayKey = this.getTodayKey();
    if (settings.lastStartupAutoBackupDate === todayKey) {
      return;
    }

    await this.saveSettings({
      ...settings,
      lastStartupAutoBackupDate: todayKey,
    });

    try {
      await backupService.runRemoteBackup(settings, undefined, true);
    } catch {
      // Automatic backup failures are surfaced by backup task events.
    }
  }

  private async scheduleNextRun(): Promise<void> {
    this.clear();

    const settings = await this.getSettings();
    if (!settings.autoBackupEnabled || !isCloudBackupConfigured(settings) || settings.autoBackupIntervalHours <= 0) {
      return;
    }

    this.scheduleTimer = setTimeout(
      () => {
        void this.performAutomaticBackup().finally(() => {
          void this.scheduleNextRun();
        });
      },
      settings.autoBackupIntervalHours * 60 * 60 * 1000
    );
  }
}

export const backupSchedulerService = new BackupSchedulerService();
