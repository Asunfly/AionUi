/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IBackupManifest, IBackupTaskEvent, ICloudBackupSettings, IRemoteBackupFile, TBackupErrorCode } from '@/common/types/backup';
import { withDefaultCloudBackupSettings } from '@/common/utils/backup';
import { ConfigStorage } from '@/common/storage';
import i18n from '@/renderer/i18n';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Message } from '@arco-design/web-react';

type TaskListener = (event: IBackupTaskEvent | null) => void;

const taskListeners = new Set<TaskListener>();
let taskSubscription: (() => void) | null = null;
let currentTaskEvent: IBackupTaskEvent | null = null;

function notifyTaskListeners(): void {
  taskListeners.forEach((listener) => listener(currentTaskEvent));
}

function getTaskLabel(task: IBackupTaskEvent['task']): string {
  const keyMap = {
    backup: 'settings.backup.taskLabel.backup',
    restore: 'settings.backup.taskLabel.restore',
    list: 'settings.backup.taskLabel.list',
  } as const;

  return i18n.t(keyMap[task], { defaultValue: task });
}

function getPhaseLabel(phase: IBackupTaskEvent['phase']): string {
  const keyMap = {
    idle: 'settings.backup.phase.idle',
    preparing: 'settings.backup.phase.preparing',
    connecting: 'settings.backup.phase.connecting',
    snapshotting: 'settings.backup.phase.snapshotting',
    collecting: 'settings.backup.phase.collecting',
    packaging: 'settings.backup.phase.packaging',
    uploading: 'settings.backup.phase.uploading',
    listing: 'settings.backup.phase.listing',
    downloading: 'settings.backup.phase.downloading',
    validating: 'settings.backup.phase.validating',
    restoring: 'settings.backup.phase.restoring',
    success: 'settings.backup.phase.success',
    error: 'settings.backup.phase.error',
  } as const;

  return i18n.t(keyMap[phase], { defaultValue: phase });
}

export function formatCloudBackupErrorMessage(code?: TBackupErrorCode, fallback?: string): string {
  const keyMap: Partial<Record<TBackupErrorCode, string>> = {
    invalid_url: 'settings.backup.error.invalidUrl',
    auth_failed: 'settings.backup.error.authFailed',
    invalid_endpoint: 'settings.backup.error.invalidEndpoint',
    network_error: 'settings.backup.error.networkError',
    remote_path_error: 'settings.backup.error.remotePathError',
    backup_canceled: 'settings.backup.error.canceled',
    task_conflict: 'settings.backup.error.taskConflict',
    unsupported_file: 'settings.backup.error.unsupportedFile',
    package_invalid: 'settings.backup.error.packageInvalid',
    unknown: 'settings.backup.error.unknown',
  };

  if (code && keyMap[code]) {
    return i18n.t(keyMap[code], { defaultValue: fallback || code });
  }

  return fallback || i18n.t('common.unknownError', { defaultValue: 'Unknown error' });
}

async function patchCloudBackupSettings(patch: Partial<ICloudBackupSettings>): Promise<void> {
  const current = withDefaultCloudBackupSettings(await ConfigStorage.get('backup.cloud'));
  await ConfigStorage.set('backup.cloud', {
    ...current,
    ...patch,
  });
}

function handleTaskEvent(event: IBackupTaskEvent): void {
  currentTaskEvent = event;
  notifyTaskListeners();

  if (event.task !== 'backup') {
    return;
  }

  const taskLabel = getTaskLabel(event.task);
  const phaseLabel = getPhaseLabel(event.phase);
  const errorMessage = formatCloudBackupErrorMessage(event.errorCode, event.message);

  if (event.phase === 'success') {
    void patchCloudBackupSettings({
      lastBackupStatus: 'success',
      lastBackupSuccessAt: event.timestamp,
      lastBackupMessage: event.fileName || `${taskLabel} ${phaseLabel}`,
    });
    if (event.task === 'backup' && event.automatic) {
      return;
    }
    return;
  }

  if (event.phase === 'error') {
    void patchCloudBackupSettings({
      lastBackupStatus: event.errorCode === 'backup_canceled' ? 'idle' : 'error',
      lastBackupMessage: errorMessage,
    });
    if (event.task === 'backup' && event.automatic) {
      Message.error(errorMessage || i18n.t('settings.backup.taskFailed', { defaultValue: '{{task}} failed', task: taskLabel }));
    }
    return;
  }

  void patchCloudBackupSettings({
    lastBackupStatus: 'running',
    lastBackupMessage: `${taskLabel} ${phaseLabel}`,
  });
}

function ensureTaskSubscription(): void {
  if (!isElectronDesktop() || taskSubscription) {
    return;
  }

  taskSubscription = ipcBridge.backup.taskStatus.on((event) => {
    handleTaskEvent(event);
  });
}

type IBridgeResult<T> = { success: boolean; data?: T; msg?: string; code?: TBackupErrorCode };

function toCloudBackupError<T>(result: IBridgeResult<T>): Error {
  return new Error(formatCloudBackupErrorMessage(result.code, result.msg));
}

async function unwrapResponse<T>(promise: Promise<IBridgeResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.success || result.data === undefined) {
    throw toCloudBackupError(result);
  }

  return result.data;
}

export function startCloudBackupClient(): void {
  ensureTaskSubscription();
}

export function subscribeCloudBackupTask(listener: TaskListener): () => void {
  ensureTaskSubscription();
  taskListeners.add(listener);
  listener(currentTaskEvent);
  return () => {
    taskListeners.delete(listener);
  };
}

export function getCurrentCloudBackupTask(): IBackupTaskEvent | null {
  return currentTaskEvent;
}

export async function getCloudBackupSettings(): Promise<ICloudBackupSettings> {
  return withDefaultCloudBackupSettings(await ConfigStorage.get('backup.cloud'));
}

export async function saveCloudBackupSettings(settings: ICloudBackupSettings): Promise<ICloudBackupSettings> {
  const normalized = withDefaultCloudBackupSettings(settings);
  await ConfigStorage.set('backup.cloud', normalized);
  return normalized;
}

export async function getSuggestedCloudBackupFileName(remark?: string): Promise<string> {
  ensureTaskSubscription();
  return ipcBridge.backup.getSuggestedFileName.invoke({ remark });
}

export async function checkCloudBackupConnection(settings: ICloudBackupSettings): Promise<void> {
  ensureTaskSubscription();
  const result = (await ipcBridge.backup.checkRemoteConnection.invoke({ settings })) as IBridgeResult<{ reachable: boolean }>;
  if (!result.success) {
    throw toCloudBackupError(result);
  }
}

export async function runCloudRemoteBackup(settings: ICloudBackupSettings, options?: { fileName?: string; automatic?: boolean; requestId?: string }): Promise<IRemoteBackupFile> {
  ensureTaskSubscription();
  return unwrapResponse(
    ipcBridge.backup.runRemoteBackup.invoke({
      settings,
      fileName: options?.fileName,
      automatic: options?.automatic,
      requestId: options?.requestId,
    })
  );
}

export async function cancelCloudBackupTask(requestId?: string): Promise<boolean> {
  ensureTaskSubscription();
  const result = await unwrapResponse(ipcBridge.backup.cancelTask.invoke(requestId ? { requestId } : undefined));
  return result.canceled;
}

export async function listCloudRemotePackages(settings: ICloudBackupSettings): Promise<IRemoteBackupFile[]> {
  ensureTaskSubscription();
  return unwrapResponse(ipcBridge.backup.listRemotePackages.invoke({ settings }));
}

export async function restoreCloudRemotePackage(settings: ICloudBackupSettings, fileName: string, options?: { requestId?: string }): Promise<{ fileName: string; restartRequired: boolean; manifest?: IBackupManifest }> {
  ensureTaskSubscription();
  return unwrapResponse(
    ipcBridge.backup.restoreRemotePackage.invoke({
      settings,
      fileName,
      requestId: options?.requestId,
    })
  );
}
