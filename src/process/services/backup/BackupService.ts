/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IChatConversationRefer, TChatConversation } from '@/common/storage';
import { CLOUD_BACKUP_SCHEMA_VERSION, MANAGED_CLOUD_BACKUP_FILE_PATTERN, type IBackupConnectionResult, type IBackupManifest, type IBackupTaskEvent, type ICloudBackupSettings, type IRemoteBackupFile, type TBackupTaskKind } from '@/common/types/backup';
import { isCloudBackupConfigured, normalizeCloudBackupConfig } from '@/common/utils/backup';
import { closeDatabase, getDatabase } from '@/process/database/export';
import { CURRENT_DB_VERSION } from '@/process/database/schema';
import { getConfigPath } from '@process/utils';
import BetterSqlite3 from 'better-sqlite3';
import { app } from 'electron';
import JSZip from 'jszip';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import WorkerManage from '@/process/WorkerManage';
import { copyDirectoryRecursively, ensureDirectory } from '@/process/utils';
import type { IManagedBackupEntry } from './backupPaths';
import { getBackupPathContext, getCurrentManagedBackupEntries, getManagedBackupEntries } from './backupPaths';
import { BackupTaskError, getBackupErrorCode, isAbortLikeError } from './BackupTaskError';
import { CloudWebDavClient } from './WebDavClient';
import { collectManagedWorkspaceRelativePaths, getManagedWorkspaceRelativePath, normalizeManagedWorkspaceRelativePath, remapConversationExtraPaths } from './workspaceBackup';

interface IManagedWorkspaceDirectory {
  relativePath: string;
  sourcePath: string;
  restorePath: string;
}

const WORKSPACE_PAYLOAD_PREFIX = 'payload/workspaces';

function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function randomToken(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function sanitizeFileNamePart(value: string, fallback: string, maxLength = 48): string {
  const sanitized = value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, maxLength);

  return sanitized || fallback;
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

async function addDirectoryToZip(zip: JSZip, sourceDir: string, zipDir: string): Promise<void> {
  zip.folder(zipDir);
  const items = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const item of items) {
    const sourcePath = path.join(sourceDir, item.name);
    const childZipPath = `${zipDir}/${item.name}`.replace(/\\/g, '/');
    if (item.isDirectory()) {
      await addDirectoryToZip(zip, sourcePath, childZipPath);
      continue;
    }

    zip.file(childZipPath, await fs.readFile(sourcePath));
  }
}

async function copyEntryToPayload(entry: IManagedBackupEntry, payloadRoot: string): Promise<boolean> {
  const entryExists = await exists(entry.sourcePath);
  if (!entryExists) {
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

function buildWorkspaceZipPath(relativePath: string): string {
  return path.posix.join(WORKSPACE_PAYLOAD_PREFIX, relativePath.replace(/\\/g, '/'));
}

function buildWorkspacePayloadPath(payloadRoot: string, relativePath: string): string {
  return path.join(payloadRoot, 'payload', 'workspaces', ...relativePath.split('/').filter(Boolean));
}

function decodeLegacyStorageJson<T>(rawContent: string): T {
  const decoded = Buffer.from(rawContent, 'base64').toString('utf-8');
  return JSON.parse(decodeURIComponent(decoded)) as T;
}

function encodeLegacyStorageJson(data: unknown): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(data)), 'utf-8').toString('base64');
}

export class BackupService {
  private readonly tempRoot = path.join(app.getPath('temp'), 'aionui', 'cloud-backup');
  private runningTask: TBackupTaskKind | null = null;
  private currentAbortController: AbortController | null = null;
  private currentRequestId: string | null = null;

  getSuggestedFileName(remark?: string): string {
    const version = sanitizeFileNamePart(app.getVersion(), '0.0.0', 24);
    const platform = sanitizeFileNamePart(`${process.platform}-${process.arch}`, 'unknown', 24);
    const hostname = sanitizeFileNamePart(os.hostname(), 'unknown', 32);
    const suffix = sanitizeFileNamePart(remark || '', '', 48);
    const base = `AionUi_v${version}_${formatTimestamp()}_${randomToken(6)}_${platform}_${hostname}`;
    return `${suffix ? `${base}_${suffix}` : base}.zip`;
  }

  async checkRemoteConnection(settings: ICloudBackupSettings): Promise<IBackupConnectionResult> {
    this.assertSettings(settings);
    const client = new CloudWebDavClient(normalizeCloudBackupConfig(settings));
    await client.checkConnection();
    return { reachable: true };
  }

  cancelTask(requestId?: string): boolean {
    if (!this.runningTask || !this.currentAbortController) {
      return false;
    }

    if (requestId && this.currentRequestId && requestId !== this.currentRequestId) {
      return false;
    }

    this.currentAbortController.abort();
    return true;
  }

  async runRemoteBackup(settings: ICloudBackupSettings, fileName?: string, automatic = false, requestId?: string): Promise<IRemoteBackupFile> {
    return this.runExclusive('backup', async () => {
      this.assertSettings(settings);
      const client = new CloudWebDavClient(normalizeCloudBackupConfig(settings));
      const tempDir = await this.createTempDir('backup');
      const dbSnapshotPath = path.join(tempDir, 'aionui.db');
      const finalFileName = this.normalizeManagedFileName(fileName);
      const finalRequestId = requestId || `backup-${Date.now()}-${randomToken(4)}`;
      const abortController = new AbortController();
      const { signal } = abortController;

      this.currentAbortController = abortController;
      this.currentRequestId = finalRequestId;

      try {
        this.emitTask({ task: 'backup', phase: 'connecting', automatic, fileName: finalFileName, requestId: finalRequestId, cancellable: true });
        await client.checkConnection(signal);
        this.assertNotCanceled(signal);

        this.emitTask({ task: 'backup', phase: 'snapshotting', automatic, fileName: finalFileName, requestId: finalRequestId, cancellable: true });
        await this.createDatabaseSnapshot(dbSnapshotPath);
        this.assertNotCanceled(signal);

        const entries = getManagedBackupEntries(dbSnapshotPath);
        this.emitTask({ task: 'backup', phase: 'collecting', automatic, fileName: finalFileName, requestId: finalRequestId, cancellable: true });
        const workspaceDirectories = settings.includeDefaultWorkspaceFiles ? await this.collectDefaultWorkspaceDirectories(signal) : [];
        const manifest = await this.buildManifest(settings, finalFileName, entries, workspaceDirectories);
        this.assertNotCanceled(signal);

        this.emitTask({ task: 'backup', phase: 'packaging', automatic, fileName: finalFileName, requestId: finalRequestId, cancellable: true });
        const zipBuffer = await this.buildBackupArchive(entries, workspaceDirectories, manifest, signal);
        this.assertNotCanceled(signal);

        this.emitTask({ task: 'backup', phase: 'uploading', automatic, fileName: finalFileName, requestId: finalRequestId, cancellable: true });
        await client.uploadFile(finalFileName, zipBuffer, signal);
        this.assertNotCanceled(signal);
        await this.cleanupRemoteBackups(client, settings.maxBackupCount, signal);

        const result = {
          fileName: finalFileName,
          size: zipBuffer.byteLength,
          modifiedTime: new Date().toISOString(),
        };
        this.emitTask({ task: 'backup', phase: 'success', automatic, fileName: finalFileName, fileSize: result.size, message: finalFileName, requestId: finalRequestId, cancellable: false });
        return result;
      } catch (error) {
        const normalizedError = this.normalizeTaskError(error);
        if (normalizedError.code === 'backup_canceled') {
          await client.deleteFile(finalFileName).catch((): void => undefined);
        }

        this.emitTask({
          task: 'backup',
          phase: 'error',
          automatic,
          fileName: finalFileName,
          message: normalizedError.message,
          errorCode: normalizedError.code,
          requestId: finalRequestId,
          cancellable: false,
        });
        throw normalizedError;
      } finally {
        this.clearActiveTask(finalRequestId);
        await removeIfExists(tempDir);
      }
    });
  }

  async listRemotePackages(settings: ICloudBackupSettings): Promise<IRemoteBackupFile[]> {
    this.assertSettings(settings);
    const client = new CloudWebDavClient(normalizeCloudBackupConfig(settings));
    this.emitTask({ task: 'list', phase: 'listing' });
    try {
      await client.checkConnection();
      const files = await client.listFiles();
      const result = files
        .filter((file) => file.type === 'file' && MANAGED_CLOUD_BACKUP_FILE_PATTERN.test(file.basename))
        .map((file) => ({
          fileName: file.basename,
          modifiedTime: file.lastmod,
          size: file.size,
        }))
        .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
      this.emitTask({ task: 'list', phase: 'success' });
      return result;
    } catch (error) {
      this.emitTask({
        task: 'list',
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async restoreRemotePackage(settings: ICloudBackupSettings, fileName: string, requestId?: string): Promise<{ fileName: string; restartRequired: boolean; manifest: IBackupManifest }> {
    return this.runExclusive('restore', async () => {
      this.assertSettings(settings);
      if (!MANAGED_CLOUD_BACKUP_FILE_PATTERN.test(fileName)) {
        throw new Error('Unsupported backup file.');
      }

      const client = new CloudWebDavClient(normalizeCloudBackupConfig(settings));
      const tempDir = await this.createTempDir('restore');
      const stagingDir = path.join(tempDir, 'staging');
      const rollbackDir = path.join(tempDir, 'rollback');

      try {
        this.emitTask({ task: 'restore', phase: 'downloading', fileName, requestId });
        const archiveBuffer = await client.downloadFile(fileName);

        this.emitTask({ task: 'restore', phase: 'validating', fileName, requestId });
        const manifest = await this.extractAndValidateArchive(archiveBuffer, stagingDir);

        WorkerManage.clear();
        closeDatabase();

        const currentEntries = getCurrentManagedBackupEntries();
        await this.createRollbackSnapshot(currentEntries, rollbackDir);
        await this.createWorkspaceRollbackSnapshot(manifest.defaultWorkspaceFiles.relativeRoots, rollbackDir);

        try {
          this.emitTask({ task: 'restore', phase: 'restoring', fileName, requestId });
          await this.replaceManagedData(currentEntries, stagingDir);
          await this.replaceDefaultWorkspaceDirectories(manifest.defaultWorkspaceFiles.relativeRoots, stagingDir);
          await this.rewriteManagedWorkspacePaths(manifest);
        } catch (restoreError) {
          await this.replaceManagedData(currentEntries, rollbackDir);
          await this.replaceDefaultWorkspaceDirectories(manifest.defaultWorkspaceFiles.relativeRoots, rollbackDir);
          throw restoreError;
        }

        getDatabase();
        this.emitTask({ task: 'restore', phase: 'success', fileName, message: fileName, requestId });
        return { fileName, restartRequired: true, manifest };
      } catch (error) {
        const normalizedError = this.normalizeTaskError(error);
        try {
          getDatabase();
        } catch {
          // Ignore database reopen errors here, the original restore error is more important.
        }
        this.emitTask({
          task: 'restore',
          phase: 'error',
          fileName,
          message: normalizedError.message,
          errorCode: normalizedError.code,
          requestId,
        });
        throw normalizedError;
      } finally {
        await removeIfExists(tempDir);
      }
    });
  }

  private async runExclusive<T>(task: TBackupTaskKind, executor: () => Promise<T>): Promise<T> {
    if (this.runningTask) {
      throw new BackupTaskError('task_conflict', `Another ${this.runningTask} task is already running.`);
    }

    this.runningTask = task;
    try {
      return await executor();
    } finally {
      this.runningTask = null;
    }
  }

  private assertSettings(settings: ICloudBackupSettings): void {
    if (!isCloudBackupConfigured(settings)) {
      throw new Error('Cloud backup configuration is incomplete.');
    }
  }

  private emitTask(event: Omit<IBackupTaskEvent, 'timestamp'>): void {
    ipcBridge.backup.taskStatus.emit({
      timestamp: Date.now(),
      ...event,
    });
  }

  private async createTempDir(prefix: string): Promise<string> {
    const dirPath = path.join(this.tempRoot, `${prefix}-${Date.now()}-${randomToken(4)}`);
    ensureDirectory(dirPath);
    return dirPath;
  }

  private async createDatabaseSnapshot(snapshotPath: string): Promise<void> {
    ensureDirectory(path.dirname(snapshotPath));
    await getDatabase().backup(snapshotPath);
  }

  private normalizeManagedFileName(fileName?: string): string {
    const suggested = this.getSuggestedFileName();
    const trimmed = fileName?.trim();
    if (!trimmed) {
      return suggested;
    }

    const baseName = trimmed.replace(/\.zip$/i, '');
    const sanitized = baseName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '')
      .slice(0, 180);

    if (!sanitized) {
      return suggested;
    }

    if (sanitized.startsWith('AionUi_v')) {
      return `${sanitized}.zip`;
    }

    return `${suggested.replace(/\.zip$/i, '')}_${sanitizeFileNamePart(sanitized, 'backup', 72)}.zip`;
  }

  private async buildManifest(settings: ICloudBackupSettings, fileName: string, entries: IManagedBackupEntry[], workspaceDirectories: IManagedWorkspaceDirectory[]): Promise<IBackupManifest> {
    const context = getBackupPathContext();
    const includedSections = await Promise.all(
      entries.map(async (entry) => ({
        key: entry.key,
        exists: await exists(entry.sourcePath),
      }))
    );

    return {
      backupSchemaVersion: CLOUD_BACKUP_SCHEMA_VERSION,
      appVersion: app.getVersion(),
      dbVersion: CURRENT_DB_VERSION,
      createdAt: new Date().toISOString(),
      providerType: settings.activeProvider,
      sourcePlatform: process.platform,
      sourceArch: process.arch,
      sourceHostname: os.hostname(),
      includedSections: [...includedSections.filter((item) => item.exists).map((item) => item.key), ...(workspaceDirectories.length > 0 ? ['defaultWorkspaceFiles'] : [])],
      defaultWorkspaceFiles: {
        included: settings.includeDefaultWorkspaceFiles,
        relativeRoots: workspaceDirectories.map((item) => item.relativePath),
      },
      sourceSystemDirs: {
        cacheDir: context.cacheDir,
        workDir: context.workDir,
        dataDir: context.dataDir,
        configDir: getConfigPath(),
      },
      fileName,
    };
  }

  private async buildBackupArchive(entries: IManagedBackupEntry[], workspaceDirectories: IManagedWorkspaceDirectory[], manifest: IBackupManifest, signal?: AbortSignal): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    for (const entry of entries) {
      this.assertNotCanceled(signal);
      if (!(await exists(entry.sourcePath))) {
        continue;
      }

      if (entry.type === 'directory') {
        await addDirectoryToZip(zip, entry.sourcePath, entry.zipPath);
      } else {
        zip.file(entry.zipPath, await fs.readFile(entry.sourcePath));
      }
    }

    for (const workspaceDirectory of workspaceDirectories) {
      this.assertNotCanceled(signal);
      if (!(await exists(workspaceDirectory.sourcePath))) {
        continue;
      }

      await addDirectoryToZip(zip, workspaceDirectory.sourcePath, buildWorkspaceZipPath(workspaceDirectory.relativePath));
    }

    this.assertNotCanceled(signal);
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    this.assertNotCanceled(signal);
    return buffer;
  }

  private async cleanupRemoteBackups(client: CloudWebDavClient, maxBackupCount: number, signal?: AbortSignal): Promise<void> {
    if (maxBackupCount <= 0) {
      return;
    }

    const files = await client.listFiles(signal);
    const managedFiles = files.filter((file) => file.type === 'file' && MANAGED_CLOUD_BACKUP_FILE_PATTERN.test(file.basename)).sort((a, b) => new Date(b.lastmod).getTime() - new Date(a.lastmod).getTime());

    const redundantFiles = managedFiles.slice(maxBackupCount);
    for (const file of redundantFiles) {
      this.assertNotCanceled(signal);
      await client.deleteFile(file.basename, signal);
    }
  }

  private async extractAndValidateArchive(archiveBuffer: Buffer, targetDir: string): Promise<IBackupManifest> {
    const zip = await JSZip.loadAsync(archiveBuffer);
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) {
      throw new Error('Backup manifest is missing.');
    }

    const manifest = JSON.parse(await manifestEntry.async('string')) as IBackupManifest;
    const rawRelativeRoots = manifest.defaultWorkspaceFiles?.relativeRoots || [];
    const normalizedRelativeRoots = rawRelativeRoots.map((item) => normalizeManagedWorkspaceRelativePath(item));
    if (manifest.backupSchemaVersion !== CLOUD_BACKUP_SCHEMA_VERSION) {
      throw new Error('Unsupported backup schema version.');
    }
    if (manifest.dbVersion > CURRENT_DB_VERSION) {
      throw new Error(`Backup database version ${manifest.dbVersion} is newer than supported version ${CURRENT_DB_VERSION}.`);
    }
    if (!zip.file('payload/db/aionui.db')) {
      throw new Error('Backup database payload is missing.');
    }
    if (normalizedRelativeRoots.some((item) => !item)) {
      throw new Error('Backup default workspace metadata is invalid.');
    }

    manifest.defaultWorkspaceFiles = {
      included: manifest.defaultWorkspaceFiles?.included === true,
      relativeRoots: normalizedRelativeRoots.filter((item): item is string => Boolean(item)),
    };

    ensureDirectory(targetDir);

    await Promise.all(
      Object.values(zip.files).map(async (entry) => {
        if (entry.dir) {
          return;
        }

        const outputPath = path.join(targetDir, entry.name);
        await ensureParentDir(outputPath);
        await fs.writeFile(outputPath, await entry.async('nodebuffer'));
      })
    );

    return manifest;
  }

  private async createRollbackSnapshot(entries: IManagedBackupEntry[], rollbackDir: string): Promise<void> {
    for (const entry of entries) {
      await copyEntryToPayload(
        {
          ...entry,
          sourcePath: entry.restorePath,
        },
        rollbackDir
      );
    }
  }

  private async createWorkspaceRollbackSnapshot(relativeRoots: string[], rollbackDir: string): Promise<void> {
    if (!relativeRoots.length) {
      return;
    }

    const { workDir } = getBackupPathContext();
    for (const relativeRoot of relativeRoots) {
      const sourcePath = path.join(workDir, ...relativeRoot.split('/').filter(Boolean));
      if (!(await exists(sourcePath))) {
        continue;
      }

      const targetPath = buildWorkspacePayloadPath(rollbackDir, relativeRoot);
      ensureDirectory(path.dirname(targetPath));
      await copyDirectoryRecursively(sourcePath, targetPath);
    }
  }

  private async replaceManagedData(entries: IManagedBackupEntry[], payloadDir: string): Promise<void> {
    for (const entry of entries) {
      await removeIfExists(entry.restorePath);
    }

    for (const entry of entries) {
      await restoreEntryFromPayload(entry, payloadDir);
    }
  }

  private async replaceDefaultWorkspaceDirectories(relativeRoots: string[], payloadDir: string): Promise<void> {
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

  private async collectDefaultWorkspaceDirectories(signal?: AbortSignal): Promise<IManagedWorkspaceDirectory[]> {
    const context = getBackupPathContext();
    const db = getDatabase();
    const conversations = this.getAllConversations(db);
    const sessionResult = db.getChannelSessions();
    const sessionWorkspaces = sessionResult.success ? sessionResult.data || [] : [];
    const relativeRoots = collectManagedWorkspaceRelativePaths(
      [
        ...conversations.map((conversation) => ({
          workspace: conversation.extra?.workspace,
          customWorkspace: conversation.extra?.customWorkspace,
        })),
        ...sessionWorkspaces.map((session) => ({
          workspace: session.workspace,
        })),
      ],
      context.workDir,
      process.platform
    );

    const workspaceDirectories = await Promise.all(
      relativeRoots.map(async (relativePath) => {
        this.assertNotCanceled(signal);
        const sourcePath = path.join(context.workDir, ...relativePath.split('/').filter(Boolean));
        if (!(await exists(sourcePath))) {
          return null;
        }

        return {
          relativePath,
          sourcePath,
          restorePath: sourcePath,
        } satisfies IManagedWorkspaceDirectory;
      })
    );

    return workspaceDirectories.filter((item): item is IManagedWorkspaceDirectory => item !== null);
  }

  private getAllConversations(db: ReturnType<typeof getDatabase>): TChatConversation[] {
    const conversations: TChatConversation[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const result = db.getUserConversations(undefined, page, 1000);
      conversations.push(...result.data);
      hasMore = result.hasMore;
      page += 1;
    }

    return conversations;
  }

  private async rewriteManagedWorkspacePaths(manifest: IBackupManifest): Promise<void> {
    const sourceWorkDir = manifest.sourceSystemDirs.workDir;
    if (!sourceWorkDir) {
      return;
    }

    const context = getBackupPathContext();
    const targetWorkDir = context.workDir;
    const remappedRelativeRoots = new Set<string>();
    const dbPath = path.join(context.dataDir, 'aionui.db');

    if (await exists(dbPath)) {
      const sqlite = new BetterSqlite3(dbPath);
      try {
        const conversationRows = sqlite.prepare('SELECT id, extra FROM conversations').all() as Array<{ id: string; extra: string }>;
        const updateConversation = sqlite.prepare('UPDATE conversations SET extra = ? WHERE id = ?');
        const conversationUpdates: Array<{ id: string; extra: string }> = [];

        for (const row of conversationRows) {
          try {
            const extra = JSON.parse(row.extra) as Record<string, unknown>;
            const relativeRoot = getManagedWorkspaceRelativePath(typeof extra.workspace === 'string' ? extra.workspace : undefined, sourceWorkDir, manifest.sourcePlatform, typeof extra.customWorkspace === 'boolean' ? extra.customWorkspace : undefined);
            if (relativeRoot) {
              remappedRelativeRoots.add(relativeRoot);
            }

            const remapped = remapConversationExtraPaths(extra, sourceWorkDir, targetWorkDir, manifest.sourcePlatform);
            if (remapped.changed) {
              conversationUpdates.push({
                id: row.id,
                extra: JSON.stringify(remapped.value),
              });
            }
          } catch {
            continue;
          }
        }

        if (conversationUpdates.length) {
          const transaction = sqlite.transaction((updates: Array<{ id: string; extra: string }>) => {
            updates.forEach((item) => updateConversation.run(item.extra, item.id));
          });
          transaction(conversationUpdates);
        }

        const sessionTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assistant_sessions'").get() as { name?: string } | undefined;
        if (sessionTable?.name) {
          const sessionRows = sqlite.prepare('SELECT id, workspace FROM assistant_sessions').all() as Array<{ id: string; workspace: string | null }>;
          const updateSession = sqlite.prepare('UPDATE assistant_sessions SET workspace = ? WHERE id = ?');
          const sessionUpdates: Array<{ id: string; workspace: string }> = [];

          for (const row of sessionRows) {
            if (!row.workspace) {
              continue;
            }

            const relativeRoot = getManagedWorkspaceRelativePath(row.workspace, sourceWorkDir, manifest.sourcePlatform);
            if (relativeRoot) {
              remappedRelativeRoots.add(relativeRoot);
            }

            const mappedWorkspace = remapConversationExtraPaths({ workspace: row.workspace }, sourceWorkDir, targetWorkDir, manifest.sourcePlatform).value as { workspace: string };
            if (mappedWorkspace.workspace !== row.workspace) {
              sessionUpdates.push({
                id: row.id,
                workspace: mappedWorkspace.workspace,
              });
            }
          }

          if (sessionUpdates.length) {
            const transaction = sqlite.transaction((updates: Array<{ id: string; workspace: string }>) => {
              updates.forEach((item) => updateSession.run(item.workspace, item.id));
            });
            transaction(sessionUpdates);
          }
        }
      } finally {
        sqlite.close();
      }
    }

    await this.rewriteLegacyConversationWorkspacePaths(manifest, remappedRelativeRoots);

    for (const relativeRoot of remappedRelativeRoots) {
      ensureDirectory(path.join(targetWorkDir, ...relativeRoot.split('/').filter(Boolean)));
    }
  }

  private async rewriteLegacyConversationWorkspacePaths(manifest: IBackupManifest, remappedRelativeRoots: Set<string>): Promise<void> {
    const sourceWorkDir = manifest.sourceSystemDirs.workDir;
    const context = getBackupPathContext();
    const chatFilePath = path.join(context.cacheDir, 'aionui-chat.txt');
    if (!(await exists(chatFilePath))) {
      return;
    }

    const rawContent = (await fs.readFile(chatFilePath, 'utf-8')).trim();
    if (!rawContent) {
      return;
    }

    let parsed: IChatConversationRefer;
    try {
      parsed = decodeLegacyStorageJson<IChatConversationRefer>(rawContent);
    } catch {
      return;
    }

    if (!Array.isArray(parsed['chat.history'])) {
      return;
    }

    let changed = false;
    const history = parsed['chat.history'].map((conversation) => {
      const extra = conversation.extra as Record<string, unknown> | undefined;
      const relativeRoot = getManagedWorkspaceRelativePath(typeof extra?.workspace === 'string' ? extra.workspace : undefined, sourceWorkDir, manifest.sourcePlatform, typeof extra?.customWorkspace === 'boolean' ? extra.customWorkspace : undefined);
      if (relativeRoot) {
        remappedRelativeRoots.add(relativeRoot);
      }

      const remapped = remapConversationExtraPaths(conversation.extra, sourceWorkDir, context.workDir, manifest.sourcePlatform);
      if (!remapped.changed) {
        return conversation;
      }

      changed = true;
      return {
        ...conversation,
        extra: remapped.value,
      };
    });

    if (!changed) {
      return;
    }

    await fs.writeFile(
      chatFilePath,
      encodeLegacyStorageJson({
        ...parsed,
        'chat.history': history,
      }),
      'utf-8'
    );
  }

  private clearActiveTask(requestId: string): void {
    if (this.currentRequestId !== requestId) {
      return;
    }

    this.currentAbortController = null;
    this.currentRequestId = null;
  }

  private assertNotCanceled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new BackupTaskError('backup_canceled');
    }
  }

  private normalizeTaskError(error: unknown): BackupTaskError {
    if (error instanceof BackupTaskError) {
      return error;
    }

    if (isAbortLikeError(error)) {
      return new BackupTaskError('backup_canceled');
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/Unsupported backup file/i.test(message)) {
      return new BackupTaskError('unsupported_file', message);
    }
    if (/manifest|schema version|payload is missing|database version|default workspace metadata is invalid/i.test(message)) {
      return new BackupTaskError('package_invalid', message);
    }

    return new BackupTaskError(getBackupErrorCode(error), message);
  }
}

export const backupService = new BackupService();
