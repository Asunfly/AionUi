/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const CLOUD_BACKUP_SCHEMA_VERSION = 1;
export const DEFAULT_CLOUD_BACKUP_REMOTE_PATH = '/AionUibackup';
export const NUTSTORE_WEBDAV_HOST = 'https://dav.jianguoyun.com/dav';
export const NUTSTORE_HELP_URL = 'https://github.com/iOfficeAI/AionUi/blob/main/docs/jianguoyun-backup-guide.md';
export const MANAGED_CLOUD_BACKUP_FILE_PREFIX = 'AionUi_v';
export const MANAGED_CLOUD_BACKUP_FILE_PATTERN = /^AionUi_v.+\.zip$/i;
export const AUTO_BACKUP_INTERVAL_OPTIONS = [0, 1, 6, 12, 24] as const;

export type TBackupProvider = 'webdav' | 'nutstore';
export type TBackupTaskKind = 'backup' | 'restore' | 'list';
export type TBackupTaskPhase = 'idle' | 'preparing' | 'connecting' | 'snapshotting' | 'collecting' | 'packaging' | 'uploading' | 'listing' | 'downloading' | 'validating' | 'restoring' | 'success' | 'error';
export type TAutoBackupIntervalHours = (typeof AUTO_BACKUP_INTERVAL_OPTIONS)[number];
export type TBackupErrorCode = 'invalid_url' | 'auth_failed' | 'invalid_endpoint' | 'network_error' | 'remote_path_error' | 'backup_canceled' | 'task_conflict' | 'unsupported_file' | 'package_invalid' | 'unknown';

export interface IWebDavBackupConfig {
  host: string;
  username: string;
  password: string;
  remotePath?: string;
}

export interface INutstoreBackupConfig {
  username: string;
  password: string;
  remotePath?: string;
}

export interface ICloudBackupSettings {
  activeProvider: TBackupProvider;
  webdav: IWebDavBackupConfig;
  nutstore: INutstoreBackupConfig;
  includeDefaultWorkspaceFiles: boolean;
  autoBackupEnabled: boolean;
  autoBackupIntervalHours: TAutoBackupIntervalHours;
  maxBackupCount: number;
  lastBackupStatus?: 'idle' | 'running' | 'success' | 'error';
  lastBackupSuccessAt?: number;
  lastBackupMessage?: string;
}

export interface IRemoteBackupFile {
  fileName: string;
  size: number;
  modifiedTime: string;
}

export interface IBackupConnectionResult {
  reachable: boolean;
}

export interface IBackupManifest {
  backupSchemaVersion: number;
  appVersion: string;
  dbVersion: number;
  createdAt: string;
  providerType: TBackupProvider;
  sourcePlatform: string;
  sourceArch: string;
  sourceHostname: string;
  includedSections: string[];
  /** Fixed managed entry keys actually packaged in this backup. */
  managedEntryKeys?: string[];
  defaultWorkspaceFiles: {
    included: boolean;
    relativeRoots: string[];
  };
  sourceSystemDirs: {
    cacheDir: string;
    workDir: string;
    dataDir: string;
    configDir: string;
  };
  fileName: string;
}

export interface IBackupTaskEvent {
  task: TBackupTaskKind;
  phase: TBackupTaskPhase;
  timestamp: number;
  requestId?: string;
  fileName?: string;
  fileSize?: number;
  message?: string;
  errorCode?: TBackupErrorCode;
  automatic?: boolean;
  cancellable?: boolean;
}
