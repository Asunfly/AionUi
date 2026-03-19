/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_DB_VERSION } from '../../src/process/database/schema';

const backupServiceMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  listFiles: vi.fn(),
  downloadFile: vi.fn(),
  checkConnection: vi.fn(),
  ensureDirectory: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  dbBackup: vi.fn(),
  getDatabase: vi.fn(),
}));

const restoreRecoveryMocks = vi.hoisted(() => ({
  preparePendingRestoreRecovery: vi.fn(),
  confirmPendingRestoreRecovery: vi.fn(),
  markPendingRestoreRecoveryForVerification: vi.fn(),
}));

const backupPathMocks = vi.hoisted(() => ({
  getBackupPathContext: vi.fn(() => ({
    cacheDir: path.join(process.cwd(), '.cache-vitest'),
    workDir: path.join(process.cwd(), '.work-vitest'),
    dataDir: path.join(process.cwd(), '.data-vitest'),
  })),
  getCurrentManagedBackupEntries: vi.fn(() => []),
  getManagedBackupEntries: vi.fn(() => []),
  filterManagedBackupEntriesByKeys: vi.fn((entries: Array<{ key: string }>, entryKeys: string[]) =>
    entries.filter((entry) => entryKeys.includes(entry.key))
  ),
}));

backupServiceMocks.getDatabase.mockImplementation(() => ({
  backup: backupServiceMocks.dbBackup,
  getUserConversations: vi.fn(() => ({
    data: [],
    total: 0,
    page: 0,
    pageSize: 1000,
    hasMore: false,
  })),
  getChannelSessions: vi.fn(() => ({
    success: true,
    data: [],
  })),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    backup: {
      taskStatus: {
        emit: backupServiceMocks.emit,
      },
    },
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(process.cwd(), '.tmp-vitest')),
    getVersion: vi.fn(() => '1.8.23'),
  },
}));

vi.mock('@/process/database/export', () => ({
  closeDatabase: vi.fn(),
  getDatabase: backupServiceMocks.getDatabase,
}));

vi.mock('@/process/WorkerManage', () => ({
  default: {
    clear: vi.fn(),
  },
}));

vi.mock('@process/utils', () => ({
  getConfigPath: vi.fn(() => path.join(process.cwd(), '.config-vitest')),
}));

vi.mock('@/process/utils', () => ({
  ensureDirectory: (dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
  },
  copyDirectoryRecursively: vi.fn(),
  getConfigPath: vi.fn(() => path.join(process.cwd(), '.config-vitest')),
  getDataPath: vi.fn(() => path.join(process.cwd(), '.data-vitest')),
}));

vi.mock('../../src/process/services/backup/backupPaths', () => backupPathMocks);

vi.mock('../../src/process/services/backup/restoreRecovery', () => restoreRecoveryMocks);

vi.mock('../../src/process/services/backup/WebDavClient', () => ({
  CloudWebDavClient: class {
    checkConnection = backupServiceMocks.checkConnection;
    ensureDirectory = backupServiceMocks.ensureDirectory;
    listFiles = backupServiceMocks.listFiles;
    downloadFile = backupServiceMocks.downloadFile;
    uploadFile = backupServiceMocks.uploadFile;
    deleteFile = backupServiceMocks.deleteFile;
  },
}));

import { BackupService } from '../../src/process/services/backup/BackupService';

function encodeLegacyStorageJson(data: unknown): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(data)), 'utf-8').toString('base64');
}

describe('BackupService', () => {
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
    autoBackupIntervalHours: 24 as const,
    maxBackupCount: 5,
    lastBackupStatus: 'idle' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    backupServiceMocks.checkConnection.mockResolvedValue(true);
    backupServiceMocks.ensureDirectory.mockResolvedValue(undefined);
    backupServiceMocks.listFiles.mockResolvedValue([]);
    backupServiceMocks.downloadFile.mockReset();
    backupServiceMocks.uploadFile.mockResolvedValue(undefined);
    backupServiceMocks.deleteFile.mockResolvedValue(undefined);
    backupServiceMocks.dbBackup.mockResolvedValue(undefined);
    restoreRecoveryMocks.preparePendingRestoreRecovery.mockResolvedValue(undefined);
    restoreRecoveryMocks.confirmPendingRestoreRecovery.mockResolvedValue(undefined);
    restoreRecoveryMocks.markPendingRestoreRecoveryForVerification.mockResolvedValue(undefined);
    backupPathMocks.getCurrentManagedBackupEntries.mockReturnValue([]);
    backupPathMocks.getManagedBackupEntries.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('generates a structured backup file name with an optional remark suffix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T15:45:30Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const hostnameSpy = vi.spyOn(os, 'hostname').mockReturnValue('OFFICE-PC');
    const service = new BackupService();

    const fileName = service.getSuggestedFileName('nightly build');

    expect(fileName).toMatch(
      new RegExp(
        `^AionUi_v1\\.8\\.23_\\d{8}-\\d{6}_[A-Z0-9]{6}_${process.platform}-${process.arch}_OFFICE-PC_nightly-build\\.zip$`
      )
    );

    hostnameSpy.mockRestore();
  });

  it('validates the configured remote directory when checking the cloud backup connection', async () => {
    const service = new BackupService();

    await expect(service.checkRemoteConnection(settings)).resolves.toEqual({ reachable: true });

    expect(backupServiceMocks.checkConnection).toHaveBeenCalledTimes(1);
    expect(backupServiceMocks.ensureDirectory).toHaveBeenCalledTimes(1);
    expect(backupServiceMocks.checkConnection.mock.invocationCallOrder[0]).toBeLessThan(
      backupServiceMocks.ensureDirectory.mock.invocationCallOrder[0]
    );
  });

  it('fails fast when the remote backup directory cannot be prepared before snapshotting', async () => {
    const service = new BackupService();

    backupServiceMocks.ensureDirectory.mockRejectedValueOnce(new Error('remote path unavailable'));

    await expect(
      service.runRemoteBackup(settings, 'AionUi_v1_manual.zip', false, 'req-remote-path')
    ).rejects.toMatchObject({
      message: 'remote path unavailable',
    });

    expect(backupServiceMocks.dbBackup).not.toHaveBeenCalled();
    expect(backupServiceMocks.uploadFile).not.toHaveBeenCalled();
  });

  it('lists only managed backup archives and sorts them by modified time descending', async () => {
    const service = new BackupService();

    backupServiceMocks.listFiles.mockResolvedValue([
      {
        type: 'file',
        basename: 'AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_OFFICE-PC.zip',
        lastmod: '2026-03-07T15:45:30.000Z',
        size: 2048,
      },
      {
        type: 'directory',
        basename: 'nested',
        lastmod: '2026-03-07T15:44:00.000Z',
        size: 0,
      },
      {
        type: 'file',
        basename: 'manual-notes.txt',
        lastmod: '2026-03-07T15:46:00.000Z',
        size: 512,
      },
      {
        type: 'file',
        basename: 'AionUi_v1.8.23_20260306-154530_DEF456_win32-x64_OFFICE-PC.zip',
        lastmod: '2026-03-06T15:45:30.000Z',
        size: 1024,
      },
    ]);

    const files = await service.listRemotePackages(settings);

    expect(files).toEqual([
      {
        fileName: 'AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_OFFICE-PC.zip',
        modifiedTime: '2026-03-07T15:45:30.000Z',
        size: 2048,
      },
      {
        fileName: 'AionUi_v1.8.23_20260306-154530_DEF456_win32-x64_OFFICE-PC.zip',
        modifiedTime: '2026-03-06T15:45:30.000Z',
        size: 1024,
      },
    ]);
  });

  it('preserves the freshly uploaded backup when retention timestamps tie', async () => {
    const service = new BackupService();
    const retentionSettings = {
      ...settings,
      maxBackupCount: 1,
    };

    backupServiceMocks.listFiles.mockResolvedValue([
      {
        type: 'file',
        basename: 'AionUi_v1.8.23_20260307-154530_OLD001_win32-x64_OFFICE-PC.zip',
        lastmod: '2026-03-07T15:45:30.000Z',
        size: 2048,
      },
      {
        type: 'file',
        basename: 'AionUi_v1.8.23_20260307-154530_NEW001_win32-x64_OFFICE-PC.zip',
        lastmod: '2026-03-07T15:45:30.000Z',
        size: 2048,
      },
    ]);

    await service.runRemoteBackup(
      retentionSettings,
      'AionUi_v1.8.23_20260307-154530_NEW001_win32-x64_OFFICE-PC.zip',
      false,
      'req-retention'
    );

    expect(backupServiceMocks.deleteFile).toHaveBeenCalledWith(
      'AionUi_v1.8.23_20260307-154530_OLD001_win32-x64_OFFICE-PC.zip',
      expect.anything()
    );
    expect(backupServiceMocks.deleteFile.mock.calls.map(([fileName]) => fileName)).not.toContain(
      'AionUi_v1.8.23_20260307-154530_NEW001_win32-x64_OFFICE-PC.zip'
    );
  });

  it('collects default workspace directories referenced only by legacy chat history', async () => {
    const service = new BackupService();
    const tempRoot = path.join(process.cwd(), '.tmp-vitest', `backup-legacy-${Date.now()}`);
    const context = {
      cacheDir: path.join(tempRoot, 'cache'),
      workDir: path.join(tempRoot, 'work'),
      dataDir: path.join(tempRoot, 'data'),
    };
    const dbWorkspacePath = path.join(context.workDir, 'db-workspace');
    const legacyWorkspacePath = path.join(context.workDir, 'legacy-workspace');

    backupPathMocks.getBackupPathContext.mockReturnValueOnce(context);
    backupServiceMocks.getDatabase.mockImplementationOnce(() => ({
      backup: backupServiceMocks.dbBackup,
      getUserConversations: vi.fn(() => ({
        data: [{ extra: { workspace: dbWorkspacePath } }],
        total: 1,
        page: 0,
        pageSize: 1000,
        hasMore: false,
      })),
      getChannelSessions: vi.fn(() => ({
        success: true,
        data: [],
      })),
    }));

    await fs.promises.mkdir(context.cacheDir, { recursive: true });
    await fs.promises.mkdir(dbWorkspacePath, { recursive: true });
    await fs.promises.mkdir(legacyWorkspacePath, { recursive: true });
    await fs.promises.writeFile(
      path.join(context.cacheDir, 'aionui-chat.txt'),
      encodeLegacyStorageJson({
        'chat.history': [
          {
            id: 'legacy-only',
            extra: {
              workspace: legacyWorkspacePath,
            },
          },
        ],
      }),
      'utf-8'
    );

    try {
      const workspaceDirectories = await (
        service as unknown as {
          collectDefaultWorkspaceDirectories: () => Promise<Array<{ relativePath: string }>>;
        }
      ).collectDefaultWorkspaceDirectories();

      expect(workspaceDirectories.map((item) => item.relativePath)).toEqual(['db-workspace', 'legacy-workspace']);
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('blocks restore when the backup database version is newer than the current application schema', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        backupSchemaVersion: 1,
        appVersion: '1.8.23',
        dbVersion: 999,
        createdAt: '2026-03-07T15:45:30.000Z',
        providerType: 'webdav',
        sourcePlatform: 'win32',
        sourceArch: 'x64',
        sourceHostname: 'OFFICE-PC',
        includedSections: ['database'],
        defaultWorkspaceFiles: {
          included: false,
          relativeRoots: [],
        },
        sourceSystemDirs: {
          cacheDir: 'cache',
          workDir: 'work',
          dataDir: 'data',
          configDir: 'config',
        },
        fileName: 'AionUi_v1_test.zip',
      })
    );
    zip.file('payload/db/aionui.db', 'sqlite');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(service.restoreRemotePackage(settings, 'AionUi_v1_test.zip')).rejects.toThrow(
      `Backup database version 999 is newer than supported version ${CURRENT_DB_VERSION}.`
    );
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'restore',
        phase: 'error',
        errorCode: 'package_invalid',
      })
    );
    expect(restoreRecoveryMocks.preparePendingRestoreRecovery).not.toHaveBeenCalled();
  });

  it('rejects restore packages that contain unsafe zip entry paths', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        backupSchemaVersion: 1,
        appVersion: '1.8.23',
        dbVersion: CURRENT_DB_VERSION,
        createdAt: '2026-03-07T15:45:30.000Z',
        providerType: 'webdav',
        sourcePlatform: 'win32',
        sourceArch: 'x64',
        sourceHostname: 'OFFICE-PC',
        includedSections: ['database'],
        defaultWorkspaceFiles: {
          included: false,
          relativeRoots: [],
        },
        sourceSystemDirs: {
          cacheDir: 'cache',
          workDir: 'work',
          dataDir: 'data',
          configDir: 'config',
        },
        fileName: 'AionUi_v1_test.zip',
      })
    );
    zip.file('payload/db/aionui.db', 'sqlite');
    zip.file('payload\\db\\..\\..\\escape.txt', 'boom');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(service.restoreRemotePackage(settings, 'AionUi_v1_test.zip')).rejects.toThrow(
      'Backup package contains unsafe file paths.'
    );
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'restore',
        phase: 'error',
        errorCode: 'package_invalid',
      })
    );
  });

  it('extracts explicit directory entries so empty workspace folders survive restore', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    const targetDir = path.join(process.cwd(), '.tmp-vitest', `backup-empty-dir-${Date.now()}`);
    zip.file(
      'manifest.json',
      JSON.stringify({
        backupSchemaVersion: 1,
        appVersion: '1.8.23',
        dbVersion: CURRENT_DB_VERSION,
        createdAt: '2026-03-07T15:45:30.000Z',
        providerType: 'webdav',
        sourcePlatform: 'win32',
        sourceArch: 'x64',
        sourceHostname: 'OFFICE-PC',
        includedSections: ['database', 'defaultWorkspaceFiles'],
        managedEntryKeys: ['database'],
        defaultWorkspaceFiles: {
          included: true,
          relativeRoots: ['workspace-empty'],
        },
        sourceSystemDirs: {
          cacheDir: 'cache',
          workDir: 'work',
          dataDir: 'data',
          configDir: 'config',
        },
        fileName: 'AionUi_v1_test.zip',
      })
    );
    zip.file('payload/db/aionui.db', 'sqlite');
    zip.folder('payload/workspaces/workspace-empty');

    try {
      await (
        service as unknown as {
          extractAndValidateArchive: (archiveBuffer: Buffer, outputDir: string) => Promise<unknown>;
        }
      ).extractAndValidateArchive(await zip.generateAsync({ type: 'nodebuffer' }), targetDir);

      expect(fs.existsSync(path.join(targetDir, 'payload', 'workspaces', 'workspace-empty'))).toBe(true);
    } finally {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('limits zip extraction concurrency to keep restore memory usage bounded', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    const targetDir = path.join(process.cwd(), '.tmp-vitest', `backup-concurrency-${Date.now()}`);
    zip.file(
      'manifest.json',
      JSON.stringify({
        backupSchemaVersion: 1,
        appVersion: '1.8.23',
        dbVersion: CURRENT_DB_VERSION,
        createdAt: '2026-03-07T15:45:30.000Z',
        providerType: 'webdav',
        sourcePlatform: 'win32',
        sourceArch: 'x64',
        sourceHostname: 'OFFICE-PC',
        includedSections: ['database'],
        managedEntryKeys: ['database'],
        defaultWorkspaceFiles: {
          included: false,
          relativeRoots: [],
        },
        sourceSystemDirs: {
          cacheDir: 'cache',
          workDir: 'work',
          dataDir: 'data',
          configDir: 'config',
        },
        fileName: 'AionUi_v1_test.zip',
      })
    );
    zip.file('payload/db/aionui.db', 'sqlite');
    for (let index = 0; index < 8; index += 1) {
      zip.file(`payload/cache/file-${index}.txt`, Buffer.alloc(1024, String(index)));
    }

    let activeWrites = 0;
    let maxActiveWrites = 0;
    const originalWriteFile = fs.promises.writeFile;
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (...args: Parameters<typeof fs.promises.writeFile>) => {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);

      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return await originalWriteFile(...args);
      } finally {
        activeWrites -= 1;
      }
    });

    try {
      await (
        service as unknown as {
          extractAndValidateArchive: (archiveBuffer: Buffer, outputDir: string) => Promise<unknown>;
        }
      ).extractAndValidateArchive(await zip.generateAsync({ type: 'nodebuffer' }), targetDir);

      expect(maxActiveWrites).toBeLessThanOrEqual(4);
    } finally {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }
  });

  it('restores a valid backup package, returns its manifest, and emits request-scoped restore events', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    const manifest = {
      backupSchemaVersion: 1,
      appVersion: '1.8.23',
      dbVersion: CURRENT_DB_VERSION,
      createdAt: '2026-03-07T15:45:30.000Z',
      providerType: 'webdav' as const,
      sourcePlatform: 'linux',
      sourceArch: 'x64',
      sourceHostname: 'OFFICE-PC',
      includedSections: ['database'],
      managedEntryKeys: ['database'],
      defaultWorkspaceFiles: {
        included: false,
        relativeRoots: [] as string[],
      },
      sourceSystemDirs: {
        cacheDir: 'cache',
        workDir: 'work',
        dataDir: 'data',
        configDir: 'config',
      },
      fileName: 'AionUi_v1_test.zip',
    };
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('payload/db/aionui.db', 'sqlite');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await service.restoreRemotePackage(settings, 'AionUi_v1_test.zip', 'restore-req');

    expect(result).toEqual({
      fileName: 'AionUi_v1_test.zip',
      restartRequired: true,
      manifest,
    });
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'restore',
        phase: 'success',
        fileName: 'AionUi_v1_test.zip',
        requestId: 'restore-req',
      })
    );
    expect(restoreRecoveryMocks.preparePendingRestoreRecovery).toHaveBeenCalledWith(
      [],
      [],
      'AionUi_v1_test.zip',
      manifest.sourcePlatform
    );
    expect(restoreRecoveryMocks.markPendingRestoreRecoveryForVerification).toHaveBeenCalledTimes(1);
    expect(restoreRecoveryMocks.confirmPendingRestoreRecovery).not.toHaveBeenCalled();
  });

  it('restores only the managed entries declared by an older backup manifest', async () => {
    const service = new BackupService();
    const createRollbackSnapshot = vi.fn().mockResolvedValue(undefined);
    const createWorkspaceRollbackSnapshot = vi.fn().mockResolvedValue(undefined);
    const replaceManagedData = vi.fn().mockResolvedValue(undefined);
    const replaceDefaultWorkspaceDirectories = vi.fn().mockResolvedValue(undefined);
    const rewriteManagedWorkspacePaths = vi.fn().mockResolvedValue(undefined);
    Object.assign(service as unknown as Record<string, unknown>, {
      createRollbackSnapshot,
      createWorkspaceRollbackSnapshot,
      replaceManagedData,
      replaceDefaultWorkspaceDirectories,
      rewriteManagedWorkspacePaths,
    });

    const currentEntries = [
      {
        key: 'database',
        type: 'file' as const,
        sourcePath: '/source/db',
        restorePath: '/restore/db',
        zipPath: 'payload/db/aionui.db',
      },
      {
        key: 'futureCache',
        type: 'directory' as const,
        sourcePath: '/source/future-cache',
        restorePath: '/restore/future-cache',
        zipPath: 'payload/cache/future-cache',
      },
    ];
    backupPathMocks.getCurrentManagedBackupEntries.mockReturnValue(currentEntries);

    const zip = new JSZip();
    const manifest = {
      backupSchemaVersion: 1,
      appVersion: '1.8.23',
      dbVersion: CURRENT_DB_VERSION,
      createdAt: '2026-03-07T15:45:30.000Z',
      providerType: 'webdav' as const,
      sourcePlatform: 'linux',
      sourceArch: 'x64',
      sourceHostname: 'OFFICE-PC',
      includedSections: ['database'],
      defaultWorkspaceFiles: {
        included: false,
        relativeRoots: [] as string[],
      },
      sourceSystemDirs: {
        cacheDir: 'cache',
        workDir: 'work',
        dataDir: 'data',
        configDir: 'config',
      },
      fileName: 'AionUi_v1_test.zip',
    };
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('payload/db/aionui.db', 'sqlite');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));

    await service.restoreRemotePackage(settings, 'AionUi_v1_test.zip', 'restore-req');

    expect(createRollbackSnapshot).toHaveBeenCalledWith([currentEntries[0]], expect.any(String));
    expect(replaceManagedData).toHaveBeenCalledWith([currentEntries[0]], expect.stringContaining('staging'));
    expect(restoreRecoveryMocks.preparePendingRestoreRecovery).toHaveBeenCalledWith(
      [currentEntries[0]],
      [],
      'AionUi_v1_test.zip',
      manifest.sourcePlatform
    );
  });

  it('cleans pending restore recovery state when restore fails after snapshotting', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    const manifest = {
      backupSchemaVersion: 1,
      appVersion: '1.8.23',
      dbVersion: CURRENT_DB_VERSION,
      createdAt: '2026-03-07T15:45:30.000Z',
      providerType: 'webdav' as const,
      sourcePlatform: 'linux',
      sourceArch: 'x64',
      sourceHostname: 'OFFICE-PC',
      includedSections: ['database'],
      defaultWorkspaceFiles: {
        included: false,
        relativeRoots: [] as string[],
      },
      sourceSystemDirs: {
        cacheDir: 'cache',
        workDir: 'work',
        dataDir: 'data',
        configDir: 'config',
      },
      fileName: 'AionUi_v1_test.zip',
    };
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('payload/db/aionui.db', 'sqlite');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));

    (
      service as unknown as { rewriteManagedWorkspacePaths: (value: unknown) => Promise<void> }
    ).rewriteManagedWorkspacePaths = vi.fn().mockRejectedValue(new Error('restore failed'));

    await expect(service.restoreRemotePackage(settings, 'AionUi_v1_test.zip', 'restore-req')).rejects.toThrow(
      'restore failed'
    );
    expect(restoreRecoveryMocks.preparePendingRestoreRecovery).toHaveBeenCalledWith(
      [],
      [],
      'AionUi_v1_test.zip',
      manifest.sourcePlatform
    );
    expect(restoreRecoveryMocks.confirmPendingRestoreRecovery).toHaveBeenCalled();
  });

  it('rolls back restored data when reopening the database fails after replacement', async () => {
    const service = new BackupService();
    const zip = new JSZip();
    const manifest = {
      backupSchemaVersion: 1,
      appVersion: '1.8.23',
      dbVersion: CURRENT_DB_VERSION,
      createdAt: '2026-03-07T15:45:30.000Z',
      providerType: 'webdav' as const,
      sourcePlatform: 'linux',
      sourceArch: 'x64',
      sourceHostname: 'OFFICE-PC',
      includedSections: ['database'],
      defaultWorkspaceFiles: {
        included: false,
        relativeRoots: [] as string[],
      },
      sourceSystemDirs: {
        cacheDir: 'cache',
        workDir: 'work',
        dataDir: 'data',
        configDir: 'config',
      },
      fileName: 'AionUi_v1_test.zip',
    };
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('payload/db/aionui.db', 'sqlite');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));
    backupServiceMocks.getDatabase.mockImplementationOnce(() => {
      throw new Error('reopen failed');
    });

    const createRollbackSnapshot = vi.fn().mockResolvedValue(undefined);
    const createWorkspaceRollbackSnapshot = vi.fn().mockResolvedValue(undefined);
    const replaceManagedData = vi.fn().mockResolvedValue(undefined);
    const replaceDefaultWorkspaceDirectories = vi.fn().mockResolvedValue(undefined);
    const rewriteManagedWorkspacePaths = vi.fn().mockResolvedValue(undefined);
    Object.assign(service as unknown as Record<string, unknown>, {
      createRollbackSnapshot,
      createWorkspaceRollbackSnapshot,
      replaceManagedData,
      replaceDefaultWorkspaceDirectories,
      rewriteManagedWorkspacePaths,
    });

    await expect(service.restoreRemotePackage(settings, 'AionUi_v1_test.zip', 'restore-req')).rejects.toThrow(
      'reopen failed'
    );

    expect(replaceManagedData).toHaveBeenNthCalledWith(1, [], expect.stringContaining('staging'));
    expect(replaceManagedData).toHaveBeenNthCalledWith(2, [], expect.stringContaining('rollback'));
    expect(replaceDefaultWorkspaceDirectories).toHaveBeenNthCalledWith(1, [], expect.stringContaining('staging'));
    expect(replaceDefaultWorkspaceDirectories).toHaveBeenNthCalledWith(2, [], expect.stringContaining('rollback'));
    expect(restoreRecoveryMocks.confirmPendingRestoreRecovery).toHaveBeenCalled();
    expect(restoreRecoveryMocks.markPendingRestoreRecoveryForVerification).not.toHaveBeenCalled();
  });

  it('rejects restore packages that declare a managed entry without its payload', async () => {
    const service = new BackupService();
    backupPathMocks.getCurrentManagedBackupEntries.mockReturnValue([
      {
        key: 'configFile',
        type: 'file',
        sourcePath: '/source/config',
        restorePath: '/restore/config',
        zipPath: 'payload/cache/aionui-config.txt',
      },
    ]);

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        backupSchemaVersion: 1,
        appVersion: '1.8.23',
        dbVersion: CURRENT_DB_VERSION,
        createdAt: '2026-03-07T15:45:30.000Z',
        providerType: 'webdav',
        sourcePlatform: 'win32',
        sourceArch: 'x64',
        sourceHostname: 'OFFICE-PC',
        includedSections: ['database', 'configFile'],
        managedEntryKeys: ['database', 'configFile'],
        defaultWorkspaceFiles: {
          included: false,
          relativeRoots: [],
        },
        sourceSystemDirs: {
          cacheDir: 'cache',
          workDir: 'work',
          dataDir: 'data',
          configDir: 'config',
        },
        fileName: 'AionUi_v1_test.zip',
      })
    );
    zip.file('payload/db/aionui.db', 'sqlite');
    backupServiceMocks.downloadFile.mockResolvedValue(await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(service.restoreRemotePackage(settings, 'AionUi_v1_test.zip')).rejects.toThrow(
      'Backup payload is missing for managed entries: configFile'
    );
    expect(restoreRecoveryMocks.preparePendingRestoreRecovery).not.toHaveBeenCalled();
  });

  it('cancels an in-flight restore task while still downloading', async () => {
    const service = new BackupService();

    backupServiceMocks.downloadFile.mockImplementation(
      (_fileName: string, signal?: AbortSignal) =>
        new Promise<Buffer>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        })
    );

    const taskPromise = service.restoreRemotePackage(settings, 'AionUi_v1_test.zip', 'restore-req');
    await Promise.resolve();

    expect(service.cancelTask('restore-req')).toBe(true);

    await expect(taskPromise).rejects.toMatchObject({ code: 'backup_canceled' });
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'restore',
        phase: 'error',
        errorCode: 'backup_canceled',
        requestId: 'restore-req',
      })
    );
  });

  it('cancels an in-flight backup task and emits the canceled error code', async () => {
    const service = new BackupService();

    backupServiceMocks.uploadFile.mockImplementation(
      (_fileName: string, _content: Buffer, signal?: AbortSignal) =>
        new Promise<void>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        })
    );

    const taskPromise = service.runRemoteBackup(settings, 'AionUi_v1_manual.zip', false, 'req-manual');
    await Promise.resolve();

    expect(service.cancelTask('req-manual')).toBe(true);

    await expect(taskPromise).rejects.toMatchObject({ code: 'backup_canceled' });
    expect(backupServiceMocks.deleteFile).not.toHaveBeenCalled();
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorCode: 'backup_canceled',
        requestId: 'req-manual',
      })
    );
  });

  it('does not delete an existing remote backup when cancellation happens before upload starts', async () => {
    const service = new BackupService();

    backupServiceMocks.checkConnection.mockImplementation(
      (signal?: AbortSignal) =>
        new Promise<boolean>((_, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        })
    );

    const taskPromise = service.runRemoteBackup(settings, 'AionUi_v1_manual.zip', false, 'req-early-cancel');
    await Promise.resolve();

    expect(service.cancelTask('req-early-cancel')).toBe(true);

    await expect(taskPromise).rejects.toMatchObject({ code: 'backup_canceled' });
    expect(backupServiceMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes the just-uploaded remote backup when cancellation happens after upload completes', async () => {
    const service = new BackupService();

    backupServiceMocks.uploadFile.mockImplementation(async () => undefined);
    let notifyCleanupStarted: (() => void) | null = null;
    const cleanupStarted = new Promise<void>((resolve) => {
      notifyCleanupStarted = resolve;
    });
    const cleanupRemoteBackups = vi.fn().mockImplementation(
      (_client: unknown, _maxBackupCount: number, _preservedFileName?: string, signal?: AbortSignal) =>
        new Promise<void>((_, reject) => {
          notifyCleanupStarted?.();
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        })
    );
    Object.assign(service as unknown as Record<string, unknown>, {
      cleanupRemoteBackups,
    });

    const taskPromise = service.runRemoteBackup(settings, 'AionUi_v1_uploaded.zip', false, 'req-post-upload-cancel');
    await cleanupStarted;

    expect(service.cancelTask('req-post-upload-cancel')).toBe(true);

    await expect(taskPromise).rejects.toMatchObject({ code: 'backup_canceled' });
    expect(backupServiceMocks.deleteFile).toHaveBeenCalledWith('AionUi_v1_uploaded.zip');
  });
});
