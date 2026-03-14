/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IBackupTaskEvent, ICloudBackupSettings } from '../../src/common/types/backup';
import CloudBackupRemarkModal from '../../src/renderer/components/SettingsModal/contents/CloudBackupRemarkModal';
import CloudBackupRestoreModal from '../../src/renderer/components/SettingsModal/contents/CloudBackupRestoreModal';
import CloudBackupRestoreProgressModal from '../../src/renderer/components/SettingsModal/contents/CloudBackupRestoreProgressModal';

const modalMocks = vi.hoisted(() => ({
  getSuggestedCloudBackupFileName: vi.fn(),
  listCloudRemotePackages: vi.fn(),
  formatCloudBackupErrorMessage: vi.fn((_: unknown, fallback?: string) => fallback || 'translated-error'),
  messageError: vi.fn(),
  modalConfirm: vi.fn((options?: { onOk?: () => Promise<void> | void }) => options?.onOk?.()),
}));

vi.mock('../../src/renderer/services/cloudBackup', () => ({
  getSuggestedCloudBackupFileName: modalMocks.getSuggestedCloudBackupFileName,
  listCloudRemotePackages: modalMocks.listCloudRemotePackages,
  formatCloudBackupErrorMessage: modalMocks.formatCloudBackupErrorMessage,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Modal: Object.assign(actual.Modal, {
      confirm: modalMocks.modalConfirm,
    }),
    Message: {
      error: modalMocks.messageError,
      info: vi.fn(),
      success: vi.fn(),
    },
  };
});

describe('cloud backup modals', () => {
  const settings: ICloudBackupSettings = {
    activeProvider: 'webdav',
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
    autoBackupIntervalHours: 24,
    maxBackupCount: 5,
    lastBackupStatus: 'idle',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefills the filename input and starts a manual backup with a request id', async () => {
    modalMocks.getSuggestedCloudBackupFileName.mockResolvedValue('AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip');

    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<CloudBackupRemarkModal visible settings={settings} taskEvent={null} onClose={() => undefined} onStart={onStart} onCancelTask={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('settings.backup.fileNamePlaceholder');
    fireEvent.change(input, { target: { value: 'custom-backup.zip' } });

    fireEvent.click(screen.getByRole('button', { name: 'settings.backup.startBackup' }));
    expect(onStart).toHaveBeenCalledWith('custom-backup.zip', expect.any(String));
  });

  it('shows running steps, supports cancel, and auto-closes after success', async () => {
    modalMocks.getSuggestedCloudBackupFileName.mockResolvedValue('AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip');

    const onClose = vi.fn();
    const onStart = vi.fn().mockResolvedValue(undefined);
    const onCancelTask = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<CloudBackupRemarkModal visible settings={settings} taskEvent={null} onClose={onClose} onStart={onStart} onCancelTask={onCancelTask} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'settings.backup.startBackup' }));
    const requestId = onStart.mock.calls[0][1] as string;

    rerender(
      <CloudBackupRemarkModal
        visible
        settings={settings}
        taskEvent={
          {
            task: 'backup',
            phase: 'uploading',
            timestamp: Date.now(),
            requestId,
            fileName: 'AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip',
          } satisfies IBackupTaskEvent
        }
        onClose={onClose}
        onStart={onStart}
        onCancelTask={onCancelTask}
      />
    );

    expect(screen.getByText('preparing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /cancel|取消/i }));
    expect(modalMocks.modalConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onCancelTask).toHaveBeenCalledWith(requestId);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    vi.useFakeTimers();
    rerender(
      <CloudBackupRemarkModal
        visible
        settings={settings}
        taskEvent={
          {
            task: 'backup',
            phase: 'success',
            timestamp: Date.now(),
            requestId,
            fileName: 'AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip',
            fileSize: 2048,
          } satisfies IBackupTaskEvent
        }
        onClose={onClose}
        onStart={onStart}
        onCancelTask={onCancelTask}
      />
    );

    expect(screen.getByText('settings.backup.successTitle')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('AionUi_v1.8.23_20260308-101010_ABC123_win32-x64_HOST.zip')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('loads the remote backup list, supports refresh, and confirms the selected backup', async () => {
    const onConfirm = vi.fn();
    modalMocks.listCloudRemotePackages.mockResolvedValue([
      {
        fileName: 'AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip',
        modifiedTime: '2026-03-07T15:45:30.000Z',
        size: 2048,
      },
      {
        fileName: 'AionUi_v1.8.23_20260306-154530_DEF456_win32-x64_HOST_B.zip',
        modifiedTime: '2026-03-06T15:45:30.000Z',
        size: 1024,
      },
    ]);

    render(<CloudBackupRestoreModal visible settings={settings} onCancel={() => undefined} onConfirm={onConfirm} />);

    await waitFor(() => {
      expect(screen.getByText('AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => {
      expect(modalMocks.listCloudRemotePackages).toHaveBeenCalledTimes(2);
    });

    const secondOption = screen.getByText('AionUi_v1.8.23_20260306-154530_DEF456_win32-x64_HOST_B.zip').closest('button');
    expect(secondOption).not.toBeNull();
    fireEvent.click(secondOption!);

    const confirmButton = document.querySelector('.arco-btn-primary');
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);
    expect(onConfirm).toHaveBeenCalledWith('AionUi_v1.8.23_20260306-154530_DEF456_win32-x64_HOST_B.zip');
  });

  it('paginates remote backups in pages of 20 items', async () => {
    const onConfirm = vi.fn();
    modalMocks.listCloudRemotePackages.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        fileName: `AionUi_v1.8.23_202603${String(index + 1).padStart(2, '0')}-101010_TEST_${index}.zip`,
        modifiedTime: `2026-03-${String(Math.min(index + 1, 28)).padStart(2, '0')}T10:10:10.000Z`,
        size: 1024 + index,
      }))
    );

    render(<CloudBackupRestoreModal visible settings={settings} onCancel={() => undefined} onConfirm={onConfirm} />);

    await waitFor(() => {
      expect(screen.getByText('AionUi_v1.8.23_20260301-101010_TEST_0.zip')).toBeInTheDocument();
    });

    expect(screen.queryByText('AionUi_v1.8.23_20260321-101010_TEST_20.zip')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('第 2 页'));

    await waitFor(() => {
      expect(screen.getByText('AionUi_v1.8.23_20260321-101010_TEST_20.zip')).toBeInTheDocument();
    });
  });

  it('shows restore progress, surfaces inline errors, and exposes restart action after success', async () => {
    const onRestart = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const { rerender } = render(<CloudBackupRestoreProgressModal visible fileName='AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip' requestId='restore-req' taskEvent={null} currentPlatform='win32' onClose={onClose} onRestart={onRestart} />);

    expect(screen.getByText('preparing')).toBeInTheDocument();

    rerender(
      <CloudBackupRestoreProgressModal
        visible
        fileName='AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip'
        requestId='restore-req'
        taskEvent={
          {
            task: 'restore',
            phase: 'restoring',
            timestamp: Date.now(),
            requestId: 'restore-req',
            fileName: 'AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip',
          } satisfies IBackupTaskEvent
        }
        currentPlatform='win32'
        onClose={onClose}
        onRestart={onRestart}
      />
    );

    expect(screen.getByText('restoring')).toBeInTheDocument();

    rerender(
      <CloudBackupRestoreProgressModal
        visible
        fileName='AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip'
        requestId='restore-req'
        taskEvent={
          {
            task: 'restore',
            phase: 'error',
            timestamp: Date.now(),
            requestId: 'restore-req',
            errorCode: 'package_invalid',
            message: 'package-invalid',
          } satisfies IBackupTaskEvent
        }
        currentPlatform='win32'
        onClose={onClose}
        onRestart={onRestart}
      />
    );

    expect(screen.getByText('settings.backup.restoreErrorTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    rerender(
      <CloudBackupRestoreProgressModal
        visible
        fileName='AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip'
        requestId='restore-req'
        taskEvent={
          {
            task: 'restore',
            phase: 'success',
            timestamp: Date.now(),
            requestId: 'restore-req',
            fileName: 'AionUi_v1.8.23_20260307-154530_ABC123_win32-x64_HOST_A.zip',
          } satisfies IBackupTaskEvent
        }
        manifest={{
          backupSchemaVersion: 1,
          appVersion: '1.8.23',
          dbVersion: 1,
          createdAt: '2026-03-07T15:45:30.000Z',
          providerType: 'webdav',
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
        }}
        currentPlatform='win32'
        onClose={onClose}
        onRestart={onRestart}
      />
    );

    expect(screen.getByText('settings.backup.restoreSuccessTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.crossPlatformRestoreDescription')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.restartNow' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
