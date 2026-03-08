/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCloudBackupConfigured } from '@/common/utils/backup';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { getCloudBackupSettings, runCloudRemoteBackup, saveCloudBackupSettings, startCloudBackupClient } from './cloudBackup';

let schedulerStarted = false;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;

function getTodayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function clearScheduleTimer(): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
}

async function performAutomaticBackup(): Promise<void> {
  const settings = await getCloudBackupSettings();
  if (!settings.autoBackupEnabled || !isCloudBackupConfigured(settings)) {
    return;
  }

  await runCloudRemoteBackup(settings, { automatic: true });
}

async function maybeRunStartupBackup(): Promise<void> {
  const settings = await getCloudBackupSettings();
  if (!settings.autoBackupEnabled || !isCloudBackupConfigured(settings)) {
    return;
  }

  const todayKey = getTodayKey();
  if (settings.lastStartupAutoBackupDate === todayKey) {
    return;
  }

  await saveCloudBackupSettings({
    ...settings,
    lastStartupAutoBackupDate: todayKey,
  });

  try {
    await runCloudRemoteBackup(settings, { automatic: true });
  } catch {
    // Startup auto backup failures are surfaced by the task event handler.
  }
}

async function scheduleNextRun(): Promise<void> {
  clearScheduleTimer();

  const settings = await getCloudBackupSettings();
  if (!settings.autoBackupEnabled || !isCloudBackupConfigured(settings) || settings.autoBackupIntervalHours <= 0) {
    return;
  }

  scheduleTimer = setTimeout(
    async () => {
      try {
        await performAutomaticBackup();
      } finally {
        void scheduleNextRun();
      }
    },
    settings.autoBackupIntervalHours * 60 * 60 * 1000
  );
}

export async function refreshCloudBackupScheduler(): Promise<void> {
  if (!isElectronDesktop()) {
    return;
  }

  await scheduleNextRun();
}

export async function startCloudBackupScheduler(): Promise<void> {
  if (!isElectronDesktop() || schedulerStarted) {
    return;
  }

  schedulerStarted = true;
  startCloudBackupClient();
  await maybeRunStartupBackup();
  await scheduleNextRun();
}
