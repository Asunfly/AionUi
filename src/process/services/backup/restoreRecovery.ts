/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { closeDatabase, getDatabase } from '@/process/database/export';
import WorkerManage from '@/process/WorkerManage';
import { copyDirectoryRecursively, ensureDirectory } from '@/process/utils';
import fs from 'fs/promises';
import path from 'path';
import type { IManagedBackupEntry } from './backupPaths';
import { filterManagedBackupEntriesByKeys, getBackupPathContext, getCurrentManagedBackupEntries } from './backupPaths';

const RESTORE_RECOVERY_STATE_VERSION = 1;
const RESTORE_RECOVERY_ROOT_NAME = 'restore-recovery';
const RESTORE_RECOVERY_STATE_FILE = 'pending-restore.json';

export type TRestoreRecoveryStartupStatus = 'none' | 'verify' | 'rolled_back' | 'rollback_failed';

interface IPendingRestoreRecoveryState {
  version: number;
  fileName: string;
  sourcePlatform: string;
  createdAt: string;
  snapshotDir: string;
  managedEntryKeys?: string[];
  relativeRoots: string[];
  startupAttempts: number;
  lastStartupAt?: string;
}

function getRestoreRecoveryRoot(): string {
  return path.join(getBackupPathContext().cacheDir, RESTORE_RECOVERY_ROOT_NAME);
}

function getRestoreRecoveryStatePath(): string {
  return path.join(getRestoreRecoveryRoot(), RESTORE_RECOVERY_STATE_FILE);
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(targetPath: string): Promise<void> {
  if (await exists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

async function ensureParentDir(targetPath: string): Promise<void> {
  ensureDirectory(path.dirname(targetPath));
}

async function copyEntryToPayload(entry: IManagedBackupEntry, payloadRoot: string): Promise<boolean> {
  if (!(await exists(entry.sourcePath))) {
    return false;
  }

  const targetPath = path.join(payloadRoot, entry.zipPath);
  if (entry.type === 'directory') {
    ensureDirectory(targetPath);
    await copyDirectoryRecursively(entry.sourcePath, targetPath);
  } else {
    await ensureParentDir(targetPath);
    await fs.copyFile(entry.sourcePath, targetPath);
  }

  return true;
}

async function restoreEntryFromPayload(entry: IManagedBackupEntry, payloadRoot: string): Promise<void> {
  const sourcePath = path.join(payloadRoot, entry.zipPath);
  if (!(await exists(sourcePath))) {
    return;
  }

  if (entry.type === 'directory') {
    ensureDirectory(entry.restorePath);
    await copyDirectoryRecursively(sourcePath, entry.restorePath);
  } else {
    await ensureParentDir(entry.restorePath);
    await fs.copyFile(sourcePath, entry.restorePath);
  }
}

function buildWorkspacePayloadPath(payloadRoot: string, relativePath: string): string {
  return path.join(payloadRoot, 'payload', 'workspaces', ...relativePath.split('/').filter(Boolean));
}

async function createWorkspaceRollbackSnapshot(relativeRoots: string[], snapshotDir: string): Promise<void> {
  if (!relativeRoots.length) {
    return;
  }

  const { workDir } = getBackupPathContext();
  for (const relativeRoot of relativeRoots) {
    const sourcePath = path.join(workDir, ...relativeRoot.split('/').filter(Boolean));
    if (!(await exists(sourcePath))) {
      continue;
    }

    const targetPath = buildWorkspacePayloadPath(snapshotDir, relativeRoot);
    ensureDirectory(path.dirname(targetPath));
    await copyDirectoryRecursively(sourcePath, targetPath);
  }
}

async function replaceManagedData(entries: IManagedBackupEntry[], payloadDir: string): Promise<void> {
  for (const entry of entries) {
    await removeIfExists(entry.restorePath);
  }

  for (const entry of entries) {
    await restoreEntryFromPayload(entry, payloadDir);
  }
}

async function replaceDefaultWorkspaceDirectories(relativeRoots: string[], payloadDir: string): Promise<void> {
  if (!relativeRoots.length) {
    return;
  }

  const { workDir } = getBackupPathContext();
  for (const relativeRoot of relativeRoots) {
    const restorePath = path.join(workDir, ...relativeRoot.split('/').filter(Boolean));
    await removeIfExists(restorePath);

    const sourcePath = buildWorkspacePayloadPath(payloadDir, relativeRoot);
    if (!(await exists(sourcePath))) {
      continue;
    }

    ensureDirectory(path.dirname(restorePath));
    await copyDirectoryRecursively(sourcePath, restorePath);
  }
}

async function readPendingRestoreRecoveryState(): Promise<IPendingRestoreRecoveryState | null> {
  const statePath = getRestoreRecoveryStatePath();
  if (!(await exists(statePath))) {
    return null;
  }

  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<IPendingRestoreRecoveryState>;
    if (parsed.version !== RESTORE_RECOVERY_STATE_VERSION || typeof parsed.fileName !== 'string' || typeof parsed.sourcePlatform !== 'string' || typeof parsed.createdAt !== 'string' || typeof parsed.snapshotDir !== 'string' || !Array.isArray(parsed.relativeRoots) || typeof parsed.startupAttempts !== 'number') {
      return null;
    }

    return {
      version: parsed.version,
      fileName: parsed.fileName,
      sourcePlatform: parsed.sourcePlatform,
      createdAt: parsed.createdAt,
      snapshotDir: parsed.snapshotDir,
      managedEntryKeys: Array.isArray(parsed.managedEntryKeys) ? parsed.managedEntryKeys.filter((item): item is string => typeof item === 'string') : undefined,
      relativeRoots: parsed.relativeRoots.filter((item): item is string => typeof item === 'string'),
      startupAttempts: parsed.startupAttempts,
      lastStartupAt: typeof parsed.lastStartupAt === 'string' ? parsed.lastStartupAt : undefined,
    };
  } catch (error) {
    console.error('[RestoreRecovery] Failed to read pending restore state:', error);
    return null;
  }
}

async function writePendingRestoreRecoveryState(state: IPendingRestoreRecoveryState): Promise<void> {
  ensureDirectory(getRestoreRecoveryRoot());
  await fs.writeFile(getRestoreRecoveryStatePath(), JSON.stringify(state, null, 2));
}

async function rollbackPendingRestoreRecovery(state: IPendingRestoreRecoveryState): Promise<void> {
  WorkerManage.clear();
  closeDatabase();

  const currentEntries = getCurrentManagedBackupEntries();
  const entries = state.managedEntryKeys?.length ? filterManagedBackupEntriesByKeys(currentEntries, state.managedEntryKeys) : currentEntries;
  await replaceManagedData(entries, state.snapshotDir);
  await replaceDefaultWorkspaceDirectories(state.relativeRoots, state.snapshotDir);
  getDatabase();
}

export async function preparePendingRestoreRecovery(entries: IManagedBackupEntry[], relativeRoots: string[], fileName: string, sourcePlatform: string): Promise<void> {
  const recoveryRoot = getRestoreRecoveryRoot();
  await removeIfExists(recoveryRoot);
  ensureDirectory(recoveryRoot);

  const snapshotDir = path.join(recoveryRoot, `snapshot-${Date.now()}`);
  ensureDirectory(snapshotDir);

  for (const entry of entries) {
    await copyEntryToPayload(
      {
        ...entry,
        sourcePath: entry.restorePath,
      },
      snapshotDir
    );
  }

  await createWorkspaceRollbackSnapshot(relativeRoots, snapshotDir);

  await writePendingRestoreRecoveryState({
    version: RESTORE_RECOVERY_STATE_VERSION,
    fileName,
    sourcePlatform,
    createdAt: new Date().toISOString(),
    snapshotDir,
    managedEntryKeys: entries.map((entry) => entry.key),
    relativeRoots,
    startupAttempts: 0,
  });
}

export async function confirmPendingRestoreRecovery(): Promise<void> {
  await removeIfExists(getRestoreRecoveryRoot());
}

export async function beginPendingRestoreRecoveryVerification(): Promise<TRestoreRecoveryStartupStatus> {
  const state = await readPendingRestoreRecoveryState();
  if (!state) {
    return 'none';
  }

  if (state.startupAttempts >= 1) {
    console.warn(`[RestoreRecovery] Detected unconfirmed restore for ${state.fileName}, attempting automatic rollback`);
    try {
      await rollbackPendingRestoreRecovery(state);
      await confirmPendingRestoreRecovery();
      console.warn(`[RestoreRecovery] Automatic rollback completed for ${state.fileName}`);
      return 'rolled_back';
    } catch (error) {
      console.error('[RestoreRecovery] Automatic rollback failed:', error);
      return 'rollback_failed';
    }
  }

  await writePendingRestoreRecoveryState({
    ...state,
    startupAttempts: state.startupAttempts + 1,
    lastStartupAt: new Date().toISOString(),
  });

  console.log(`[RestoreRecovery] Verifying restored startup for ${state.fileName}`);
  return 'verify';
}
