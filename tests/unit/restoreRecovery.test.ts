/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const restoreRecoveryMocks = vi.hoisted(() => ({
  workerClear: vi.fn(),
  closeDatabase: vi.fn(),
  getDatabase: vi.fn(() => ({})),
}));

const restoreRecoveryState = vi.hoisted(() => ({
  cacheDir: '',
  workDir: '',
  dataDir: '',
  configDir: '',
  entries: [] as Array<{
    key: string;
    type: 'file' | 'directory';
    sourcePath: string;
    restorePath: string;
    zipPath: string;
  }>,
}));

vi.mock('@/process/WorkerManage', () => ({
  default: {
    clear: restoreRecoveryMocks.workerClear,
  },
}));

vi.mock('@/process/database/export', () => ({
  closeDatabase: restoreRecoveryMocks.closeDatabase,
  getDatabase: restoreRecoveryMocks.getDatabase,
}));

vi.mock('@/process/utils', () => ({
  ensureDirectory: (dirPath: string) => {
    fsSync.mkdirSync(dirPath, { recursive: true });
  },
  copyDirectoryRecursively: async (sourcePath: string, targetPath: string) => {
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
  },
}));

vi.mock('../../src/process/services/backup/backupPaths', () => ({
  getBackupPathContext: () => ({
    cacheDir: restoreRecoveryState.cacheDir,
    workDir: restoreRecoveryState.workDir,
    dataDir: restoreRecoveryState.dataDir,
    configDir: restoreRecoveryState.configDir,
    previewHistoryDir: path.join(restoreRecoveryState.cacheDir, 'preview-history'),
    conversationHistoryDir: path.join(restoreRecoveryState.cacheDir, 'aionui-chat-history'),
  }),
  getCurrentManagedBackupEntries: () => restoreRecoveryState.entries,
  filterManagedBackupEntriesByKeys: (entries: Array<{ key: string }>, entryKeys: string[]) => entries.filter((entry) => entryKeys.includes(entry.key)),
}));

describe('restoreRecovery', () => {
  let tempRoot: string;
  let configFilePath: string;
  let managedDirPath: string;
  let workspaceRootPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-restore-recovery-'));
    restoreRecoveryState.cacheDir = path.join(tempRoot, 'cache');
    restoreRecoveryState.workDir = path.join(tempRoot, 'work');
    restoreRecoveryState.dataDir = path.join(tempRoot, 'data');
    restoreRecoveryState.configDir = path.join(tempRoot, 'config');

    await fs.mkdir(restoreRecoveryState.cacheDir, { recursive: true });
    await fs.mkdir(restoreRecoveryState.workDir, { recursive: true });

    configFilePath = path.join(tempRoot, 'managed', 'aionui-config.txt');
    managedDirPath = path.join(tempRoot, 'managed', 'assistants');
    workspaceRootPath = path.join(restoreRecoveryState.workDir, 'default-temp-workspace');

    await fs.mkdir(path.dirname(configFilePath), { recursive: true });
    await fs.writeFile(configFilePath, 'original-config');

    await fs.mkdir(managedDirPath, { recursive: true });
    await fs.writeFile(path.join(managedDirPath, 'assistant.md'), 'original-assistant');

    await fs.mkdir(workspaceRootPath, { recursive: true });
    await fs.writeFile(path.join(workspaceRootPath, 'note.txt'), 'original-workspace');

    restoreRecoveryState.entries = [
      {
        key: 'configFile',
        type: 'file',
        sourcePath: configFilePath,
        restorePath: configFilePath,
        zipPath: 'payload/cache/aionui-config.txt',
      },
      {
        key: 'assistants',
        type: 'directory',
        sourcePath: managedDirPath,
        restorePath: managedDirPath,
        zipPath: 'payload/cache/assistants',
      },
    ];
  });

  afterEach(async () => {
    vi.resetModules();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rolls back immediately on the first startup when restore preparation was interrupted', async () => {
    const { beginPendingRestoreRecoveryVerification, preparePendingRestoreRecovery } = await import('../../src/process/services/backup/restoreRecovery');

    await preparePendingRestoreRecovery(restoreRecoveryState.entries, ['default-temp-workspace'], 'AionUi_v1_test.zip', 'win32');

    const statePath = path.join(restoreRecoveryState.cacheDir, 'restore-recovery', 'pending-restore.json');
    const initialState = JSON.parse(await fs.readFile(statePath, 'utf-8')) as {
      fileName: string;
      managedEntryKeys: string[];
      phase: string;
      relativeRoots: string[];
      startupAttempts: number;
      snapshotDir: string;
    };

    expect(initialState.fileName).toBe('AionUi_v1_test.zip');
    expect(initialState.managedEntryKeys).toEqual(['configFile', 'assistants']);
    expect(initialState.phase).toBe('restoring');
    expect(initialState.relativeRoots).toEqual(['default-temp-workspace']);
    expect(initialState.startupAttempts).toBe(0);
    expect(await fs.readFile(path.join(initialState.snapshotDir, 'payload', 'cache', 'aionui-config.txt'), 'utf-8')).toBe('original-config');
    expect(await fs.readFile(path.join(initialState.snapshotDir, 'payload', 'workspaces', 'default-temp-workspace', 'note.txt'), 'utf-8')).toBe('original-workspace');

    await fs.writeFile(configFilePath, 'partially-restored-config');
    await fs.writeFile(path.join(managedDirPath, 'assistant.md'), 'partially-restored-assistant');
    await fs.writeFile(path.join(workspaceRootPath, 'note.txt'), 'partially-restored-workspace');

    const startupStatus = await beginPendingRestoreRecoveryVerification();

    expect(startupStatus).toBe('rolled_back');
    expect(await fs.readFile(configFilePath, 'utf-8')).toBe('original-config');
    expect(await fs.readFile(path.join(managedDirPath, 'assistant.md'), 'utf-8')).toBe('original-assistant');
    expect(await fs.readFile(path.join(workspaceRootPath, 'note.txt'), 'utf-8')).toBe('original-workspace');
    await expect(fs.access(path.join(restoreRecoveryState.cacheDir, 'restore-recovery'))).rejects.toThrow();
  });

  it('marks completed restores for verification and rolls back on the next startup when still unconfirmed', async () => {
    const { beginPendingRestoreRecoveryVerification, markPendingRestoreRecoveryForVerification, preparePendingRestoreRecovery } = await import('../../src/process/services/backup/restoreRecovery');

    await preparePendingRestoreRecovery(restoreRecoveryState.entries, ['default-temp-workspace'], 'AionUi_v1_test.zip', 'win32');
    await markPendingRestoreRecoveryForVerification();

    const statePath = path.join(restoreRecoveryState.cacheDir, 'restore-recovery', 'pending-restore.json');
    const verificationState = JSON.parse(await fs.readFile(statePath, 'utf-8')) as {
      phase: string;
      startupAttempts: number;
    };
    expect(verificationState.phase).toBe('verify');
    expect(verificationState.startupAttempts).toBe(0);

    const firstStartupStatus = await beginPendingRestoreRecoveryVerification();
    const verifiedState = JSON.parse(await fs.readFile(statePath, 'utf-8')) as {
      startupAttempts: number;
      lastStartupAt?: string;
    };

    expect(firstStartupStatus).toBe('verify');
    expect(verifiedState.startupAttempts).toBe(1);
    expect(verifiedState.lastStartupAt).toEqual(expect.any(String));

    await fs.writeFile(configFilePath, 'restored-config');
    await fs.writeFile(path.join(managedDirPath, 'assistant.md'), 'restored-assistant');
    await fs.writeFile(path.join(workspaceRootPath, 'note.txt'), 'restored-workspace');

    const startupStatus = await beginPendingRestoreRecoveryVerification();

    expect(startupStatus).toBe('rolled_back');
    expect(restoreRecoveryMocks.workerClear).toHaveBeenCalledTimes(1);
    expect(restoreRecoveryMocks.closeDatabase).toHaveBeenCalledTimes(1);
    expect(restoreRecoveryMocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(configFilePath, 'utf-8')).toBe('original-config');
    expect(await fs.readFile(path.join(managedDirPath, 'assistant.md'), 'utf-8')).toBe('original-assistant');
    expect(await fs.readFile(path.join(workspaceRootPath, 'note.txt'), 'utf-8')).toBe('original-workspace');
    await expect(fs.access(path.join(restoreRecoveryState.cacheDir, 'restore-recovery'))).rejects.toThrow();
  });

  it('treats phase-less recovery state as interrupted restore instead of inferring verify mode', async () => {
    const { beginPendingRestoreRecoveryVerification, preparePendingRestoreRecovery } = await import('../../src/process/services/backup/restoreRecovery');

    await preparePendingRestoreRecovery(restoreRecoveryState.entries, ['default-temp-workspace'], 'AionUi_v1_test.zip', 'win32');

    const statePath = path.join(restoreRecoveryState.cacheDir, 'restore-recovery', 'pending-restore.json');
    const legacyLikeState = JSON.parse(await fs.readFile(statePath, 'utf-8')) as {
      version: number;
      fileName: string;
      sourcePlatform: string;
      createdAt: string;
      snapshotDir: string;
      managedEntryKeys: string[];
      relativeRoots: string[];
      startupAttempts: number;
    };

    await fs.writeFile(
      statePath,
      JSON.stringify({
        ...legacyLikeState,
        startupAttempts: 1,
      }),
      'utf-8'
    );

    await fs.writeFile(configFilePath, 'partially-restored-config');
    await fs.writeFile(path.join(managedDirPath, 'assistant.md'), 'partially-restored-assistant');
    await fs.writeFile(path.join(workspaceRootPath, 'note.txt'), 'partially-restored-workspace');

    const startupStatus = await beginPendingRestoreRecoveryVerification();

    expect(startupStatus).toBe('rolled_back');
    expect(await fs.readFile(configFilePath, 'utf-8')).toBe('original-config');
    expect(await fs.readFile(path.join(managedDirPath, 'assistant.md'), 'utf-8')).toBe('original-assistant');
    expect(await fs.readFile(path.join(workspaceRootPath, 'note.txt'), 'utf-8')).toBe('original-workspace');
  });
});
