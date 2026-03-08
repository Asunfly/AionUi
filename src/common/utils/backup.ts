/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_CLOUD_BACKUP_REMOTE_PATH, NUTSTORE_WEBDAV_HOST, type ICloudBackupSettings, type INutstoreBackupConfig, type IWebDavBackupConfig, type TBackupProvider } from '@/common/types/backup';

export interface INormalizedCloudBackupConfig {
  provider: TBackupProvider;
  host: string;
  username: string;
  password: string;
  remotePath: string;
}

export function getDefaultCloudBackupSettings(): ICloudBackupSettings {
  return {
    activeProvider: 'webdav',
    webdav: {
      host: '',
      username: '',
      password: '',
      remotePath: DEFAULT_CLOUD_BACKUP_REMOTE_PATH,
    },
    nutstore: {
      username: '',
      password: '',
      remotePath: DEFAULT_CLOUD_BACKUP_REMOTE_PATH,
    },
    includeDefaultWorkspaceFiles: false,
    autoBackupEnabled: false,
    autoBackupIntervalHours: 24,
    maxBackupCount: 10,
    lastBackupStatus: 'idle',
  };
}

export function withDefaultCloudBackupSettings(settings?: Partial<ICloudBackupSettings> | null): ICloudBackupSettings {
  const defaults = getDefaultCloudBackupSettings();
  return {
    ...defaults,
    ...settings,
    webdav: {
      ...defaults.webdav,
      ...(settings?.webdav || {}),
    },
    nutstore: {
      ...defaults.nutstore,
      ...(settings?.nutstore || {}),
    },
  };
}

export function normalizeRemotePath(remotePath?: string): string {
  const trimmed = remotePath?.trim();
  if (!trimmed) {
    return DEFAULT_CLOUD_BACKUP_REMOTE_PATH;
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function getActiveProviderConfig(settings: ICloudBackupSettings): IWebDavBackupConfig | INutstoreBackupConfig {
  return settings.activeProvider === 'nutstore' ? settings.nutstore : settings.webdav;
}

export function isCloudBackupConfigured(settings: ICloudBackupSettings): boolean {
  const config = getActiveProviderConfig(settings);
  if (settings.activeProvider === 'nutstore') {
    return Boolean(config.username?.trim() && config.password?.trim());
  }

  const webdavConfig = config as IWebDavBackupConfig;
  return Boolean(webdavConfig.host?.trim() && webdavConfig.username?.trim() && webdavConfig.password?.trim());
}

export function normalizeCloudBackupConfig(settings: ICloudBackupSettings): INormalizedCloudBackupConfig {
  if (settings.activeProvider === 'nutstore') {
    return {
      provider: 'nutstore',
      host: NUTSTORE_WEBDAV_HOST,
      username: settings.nutstore.username.trim(),
      password: settings.nutstore.password.trim(),
      remotePath: normalizeRemotePath(settings.nutstore.remotePath),
    };
  }

  return {
    provider: 'webdav',
    host: settings.webdav.host.trim(),
    username: settings.webdav.username.trim(),
    password: settings.webdav.password.trim(),
    remotePath: normalizeRemotePath(settings.webdav.remotePath),
  };
}
