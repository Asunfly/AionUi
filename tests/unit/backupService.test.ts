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
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  dbBackup: vi.fn(),
  getDatabase: vi.fn(),
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

vi.mock('../../src/process/services/backup/backupPaths', () => ({
  getBackupPathContext: vi.fn(() => ({
    cacheDir: path.join(process.cwd(), '.cache-vitest'),
    workDir: path.join(process.cwd(), '.work-vitest'),
    dataDir: path.join(process.cwd(), '.data-vitest'),
  })),
  getCurrentManagedBackupEntries: vi.fn(() => []),
  getManagedBackupEntries: vi.fn(() => []),
}));

vi.mock('../../src/process/services/backup/WebDavClient', () => ({
  CloudWebDavClient: class {
    checkConnection = backupServiceMocks.checkConnection;
    listFiles = backupServiceMocks.listFiles;
    downloadFile = backupServiceMocks.downloadFile;
    uploadFile = backupServiceMocks.uploadFile;
    deleteFile = backupServiceMocks.deleteFile;
  },
}));

import { BackupService } from '../../src/process/services/backup/BackupService';

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
    backupServiceMocks.listFiles.mockResolvedValue([]);
    backupServiceMocks.downloadFile.mockReset();
    backupServiceMocks.uploadFile.mockResolvedValue(undefined);
    backupServiceMocks.deleteFile.mockResolvedValue(undefined);
    backupServiceMocks.dbBackup.mockResolvedValue(undefined);
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

    expect(fileName).toMatch(new RegExp(`^AionUi_v1\\.8\\.23_\\d{8}-\\d{6}_[A-Z0-9]{6}_${process.platform}-${process.arch}_OFFICE-PC_nightly-build\\.zip$`));

    hostnameSpy.mockRestore();
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

    await expect(service.restoreRemotePackage(settings, 'AionUi_v1_test.zip')).rejects.toThrow(`Backup database version 999 is newer than supported version ${CURRENT_DB_VERSION}.`);
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'restore',
        phase: 'error',
        errorCode: 'package_invalid',
      })
    );
  });

  it('restores a valid backup package and returns its manifest for restart decisions', async () => {
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
        relativeRoots: [],
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

    const result = await service.restoreRemotePackage(settings, 'AionUi_v1_test.zip');

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
    expect(backupServiceMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'error',
        errorCode: 'backup_canceled',
        requestId: 'req-manual',
      })
    );
  });
});
