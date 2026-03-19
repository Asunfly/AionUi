/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NUTSTORE_HELP_URL, NUTSTORE_WEBDAV_HOST, type ICloudBackupSettings } from '../../src/common/types/backup';

const systemMocks = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
  systemInfo: vi.fn().mockResolvedValue({
    cacheDir: 'C:/cache',
    workDir: 'C:/work',
    platform: 'win32',
    arch: 'x64',
  }),
  getCloseToTray: vi.fn().mockResolvedValue(false),
  getNotificationEnabled: vi.fn().mockResolvedValue(true),
  getCronNotificationEnabled: vi.fn().mockResolvedValue(false),
  setCloseToTray: vi.fn().mockResolvedValue(undefined),
  setNotificationEnabled: vi.fn().mockResolvedValue(undefined),
  setCronNotificationEnabled: vi.fn().mockResolvedValue(undefined),
  isDevToolsOpened: vi.fn().mockResolvedValue(false),
  openDevTools: vi.fn().mockResolvedValue(false),
  getCdpStatus: vi
    .fn()
    .mockResolvedValue({ data: { enabled: false, startupEnabled: false, port: null, isDevMode: false } }),
  updateCdpConfig: vi.fn().mockResolvedValue({ success: true }),
  devToolsStateChangedOn: vi.fn(() => vi.fn()),
  languageChangedOn: vi.fn(() => vi.fn()),
  dialogOpen: vi.fn(),
}));

const cloudBackupMocks = vi.hoisted(() => ({
  getCloudBackupSettings: vi.fn(),
  startCloudBackupClient: vi.fn(),
  subscribeCloudBackupTask: vi.fn((): (() => void) => () => undefined),
  saveCloudBackupSettings: vi.fn().mockResolvedValue(undefined),
  checkCloudBackupConnection: vi.fn().mockResolvedValue(undefined),
  runCloudRemoteBackup: vi.fn(),
  restoreCloudRemotePackage: vi.fn(),
  cancelCloudBackupTask: vi.fn(),
  formatCloudBackupErrorMessage: vi.fn((_: unknown, fallback?: string) => fallback || 'error'),
}));

const nutstoreSettings: ICloudBackupSettings = {
  activeProvider: 'nutstore',
  webdav: {
    host: '',
    username: '',
    password: '',
    remotePath: '/AionUibackup',
  },
  nutstore: {
    username: 'nut-user',
    password: 'app-pass',
    remotePath: '/AionUibackup',
  },
  includeDefaultWorkspaceFiles: false,
  autoBackupEnabled: false,
  autoBackupIntervalHours: 24,
  maxBackupCount: 10,
  lastBackupStatus: 'idle',
};

cloudBackupMocks.getCloudBackupSettings.mockResolvedValue(nutstoreSettings);

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      systemInfo: {
        invoke: systemMocks.systemInfo,
      },
      updateSystemInfo: {
        invoke: vi.fn(),
      },
      restart: {
        invoke: vi.fn(),
      },
      isDevToolsOpened: {
        invoke: systemMocks.isDevToolsOpened,
      },
      openDevTools: {
        invoke: systemMocks.openDevTools,
      },
      getCdpStatus: {
        invoke: systemMocks.getCdpStatus,
      },
      updateCdpConfig: {
        invoke: systemMocks.updateCdpConfig,
      },
      devToolsStateChanged: {
        on: systemMocks.devToolsStateChangedOn,
      },
    },
    systemSettings: {
      getCloseToTray: {
        invoke: systemMocks.getCloseToTray,
      },
      getNotificationEnabled: {
        invoke: systemMocks.getNotificationEnabled,
      },
      getCronNotificationEnabled: {
        invoke: systemMocks.getCronNotificationEnabled,
      },
      setCloseToTray: {
        invoke: systemMocks.setCloseToTray,
      },
      setNotificationEnabled: {
        invoke: systemMocks.setNotificationEnabled,
      },
      setCronNotificationEnabled: {
        invoke: systemMocks.setCronNotificationEnabled,
      },
      languageChanged: {
        on: systemMocks.languageChangedOn,
      },
    },
    dialog: {
      showOpen: {
        invoke: systemMocks.dialogOpen,
      },
    },
    shell: {
      openExternal: {
        invoke: systemMocks.openExternal,
      },
    },
  },
}));

vi.mock('../../src/renderer/services/cloudBackup', () => ({
  getCloudBackupSettings: cloudBackupMocks.getCloudBackupSettings,
  startCloudBackupClient: cloudBackupMocks.startCloudBackupClient,
  subscribeCloudBackupTask: cloudBackupMocks.subscribeCloudBackupTask,
  saveCloudBackupSettings: cloudBackupMocks.saveCloudBackupSettings,
  checkCloudBackupConnection: cloudBackupMocks.checkCloudBackupConnection,
  runCloudRemoteBackup: cloudBackupMocks.runCloudRemoteBackup,
  restoreCloudRemotePackage: cloudBackupMocks.restoreCloudRemotePackage,
  cancelCloudBackupTask: cloudBackupMocks.cancelCloudBackupTask,
  formatCloudBackupErrorMessage: cloudBackupMocks.formatCloudBackupErrorMessage,
}));

vi.mock('../../src/renderer/services/cloudBackupScheduler', () => ({
  refreshCloudBackupScheduler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('../../src/renderer/components/settings/LanguageSwitcher', () => ({
  default: () => <div>LanguageSwitcher</div>,
}));

vi.mock('../../src/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../src/renderer/components/settings/SettingsModal/contents/CloudBackupRemarkModal', () => ({
  default: (): React.ReactElement | null => null,
}));

vi.mock('../../src/renderer/components/settings/SettingsModal/contents/CloudBackupRestoreModal', () => ({
  default: (): React.ReactElement | null => null,
}));

vi.mock('../../src/renderer/components/settings/SettingsModal/contents/CloudBackupRestoreProgressModal', () => ({
  default: (): React.ReactElement | null => null,
}));

vi.mock('../../src/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: {
      cacheDir: 'C:/cache',
      workDir: 'C:/work',
      platform: 'win32',
      arch: 'x64',
    },
  }),
}));

import SystemModalContent from '../../src/renderer/components/settings/SettingsModal/contents/SystemModalContent';

describe('SystemModalContent nutstore backup section', () => {
  it('keeps the entire backup panel collapsed by default, then shows the fixed Nutstore URL and current backup sections after expanding', async () => {
    render(<SystemModalContent />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'settings.backup.expandConfig' })).toBeInTheDocument();
    });

    expect(screen.queryByDisplayValue(NUTSTORE_WEBDAV_HOST)).not.toBeInTheDocument();
    expect(screen.queryByText('settings.backup.scopeSummary')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settings.backup.expandConfig' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue(NUTSTORE_WEBDAV_HOST)).toBeInTheDocument();
    });

    const urlInput = screen.getByDisplayValue(NUTSTORE_WEBDAV_HOST) as HTMLInputElement;
    expect(urlInput.readOnly).toBe(true);
    expect(screen.getByText('settings.backup.connectionSection')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.policySection')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.connectionReadyBadge')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.actionSectionDescription')).toBeInTheDocument();
    expect(screen.queryByText('settings.backup.nutstoreWebdavNotice')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.backup.connectionSectionDescription')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.backup.policySectionDescription')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.backup.testConnection' })).toBeInTheDocument();

    const nutstorePasswordField = screen.getByText('settings.backup.nutstoreAppPassword').closest('.grid');
    const helpButton = nutstorePasswordField?.querySelector('button[aria-label=""]');
    expect(helpButton).not.toBeNull();

    fireEvent.click(helpButton as HTMLButtonElement);
    expect(systemMocks.openExternal).toHaveBeenCalledWith(NUTSTORE_HELP_URL);
  });

  it('enables testing and backup actions only after the required fields are present', async () => {
    cloudBackupMocks.getCloudBackupSettings.mockResolvedValueOnce({
      ...nutstoreSettings,
      nutstore: {
        ...nutstoreSettings.nutstore,
        username: '',
        password: '',
      },
    });

    render(<SystemModalContent />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'settings.backup.expandConfig' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'settings.backup.expandConfig' }));

    expect(screen.queryByRole('button', { name: 'settings.backup.testConnection' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'settings.backup.manualBackup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'settings.backup.restore' })).toBeDisabled();
  });
});
