/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IBackupManifest, IBackupTaskEvent, ICloudBackupSettings, TBackupProvider } from '@/common/types/backup';
import { AUTO_BACKUP_INTERVAL_OPTIONS, NUTSTORE_HELP_URL, NUTSTORE_WEBDAV_HOST } from '@/common/types/backup';
import { isCloudBackupConfigured, normalizeRemotePath, withDefaultCloudBackupSettings } from '@/common/utils/backup';
import {
  cancelCloudBackupTask,
  checkCloudBackupConnection,
  getCloudBackupSettings,
  restoreCloudRemotePackage,
  runCloudRemoteBackup,
  saveCloudBackupSettings,
  startCloudBackupClient,
  subscribeCloudBackupTask,
} from '@/renderer/services/cloudBackup';
import { refreshCloudBackupScheduler } from '@/renderer/services/cloudBackupScheduler';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Alert, Button, Input, Message, Select, Switch, Tooltip } from '@arco-design/web-react';
import { Heartbeat, Loading, Up, Down, Info } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CloudBackupRemarkModal from './CloudBackupRemarkModal';
import CloudBackupRestoreModal from './CloudBackupRestoreModal';
import CloudBackupRestoreProgressModal from './CloudBackupRestoreProgressModal';

type CloudBackupSettingsSectionProps = { currentPlatform?: string };

const intervalOptions = AUTO_BACKUP_INTERVAL_OPTIONS.map((value) => ({
  value,
  labelKey: value === 0 ? 'settings.backup.interval.off' : `settings.backup.interval.${value}h`,
}));

const maxBackupCountOptions = [0, 5, 10, 20, 50, 100] as const;

const createTaskRequestId = () => `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const CloudBackupSettingsSection: React.FC<CloudBackupSettingsSectionProps> = ({ currentPlatform }) => {
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();
  const [settings, setSettings] = useState<ICloudBackupSettings | null>(null);
  const [taskEvent, setTaskEvent] = useState<IBackupTaskEvent | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [remarkVisible, setRemarkVisible] = useState(false);
  const [restoreVisible, setRestoreVisible] = useState(false);
  const [progressVisible, setProgressVisible] = useState(false);
  const [restoreRequest, setRestoreRequest] = useState<{ fileName: string; requestId: string } | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ restartRequired: boolean; manifest?: IBackupManifest } | null>(
    null
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    startCloudBackupClient();
    void getCloudBackupSettings().then(setSettings);
    return subscribeCloudBackupTask((event) => setTaskEvent(event));
  }, [isDesktop]);

  const updateSettings = useCallback(
    (updater: (current: ICloudBackupSettings) => ICloudBackupSettings) => {
      setSettings((previous) => {
        const next = updater(withDefaultCloudBackupSettings(previous));
        void saveCloudBackupSettings(next)
          .then(() => refreshCloudBackupScheduler())
          .catch((error) => Message.error(error instanceof Error ? error.message : t('common.saveFailed')));
        return next;
      });
    },
    [t]
  );

  const activeProvider = settings?.activeProvider || 'webdav';
  const providerConfig = activeProvider === 'nutstore' ? settings?.nutstore : settings?.webdav;
  const ready = settings
    ? activeProvider === 'nutstore'
      ? Boolean(settings.nutstore.username.trim() && settings.nutstore.password.trim())
      : Boolean(settings.webdav.host.trim() && settings.webdav.username.trim() && settings.webdav.password.trim())
    : false;
  const configured = settings ? isCloudBackupConfigured(settings) : false;
  const providerPath = settings ? normalizeRemotePath(providerConfig?.remotePath) : '--';
  const lastSuccessText = settings?.lastBackupSuccessAt
    ? new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(new Date(settings.lastBackupSuccessAt))
        .replace(',', '')
    : t('settings.backup.never');
  const statusText = taskEvent?.message || settings?.lastBackupMessage || t('settings.backup.statusIdle');

  const runRestore = useCallback(
    (fileName: string) => {
      if (!settings) return;
      const requestId = createTaskRequestId();
      setRestoreVisible(false);
      setRestoreError(null);
      setRestoreResult(null);
      setRestoreRequest({ fileName, requestId });
      setProgressVisible(true);
      void restoreCloudRemotePackage(settings, fileName, { requestId })
        .then(setRestoreResult)
        .catch((error) => setRestoreError(error instanceof Error ? error.message : t('settings.backup.error.unknown')));
    },
    [settings, t]
  );

  const connectionAction = ready ? (
    <Tooltip content={t('settings.backup.testConnection')} position='top'>
      <span
        role='button'
        tabIndex={0}
        aria-label={t('settings.backup.testConnection')}
        data-testid='backup-test-connection-action'
        className='inline-flex items-center justify-center text-[var(--color-text-3)]'
        onClick={() => {
          if (!settings) return;
          setTesting(true);
          void checkCloudBackupConnection(settings)
            .then(() => Message.success(t('settings.backup.connectionSuccess')))
            .catch((error) =>
              Message.error(error instanceof Error ? error.message : t('settings.backup.connectionFailed'))
            )
            .finally(() => setTesting(false));
        }}
      >
        {testing ? (
          <Loading theme='outline' size='16' className='animate-spin' fill='currentColor' />
        ) : (
          <Heartbeat theme='outline' size='16' fill='currentColor' />
        )}
      </span>
    </Tooltip>
  ) : null;

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-16px'>
      {isDesktop && settings && (
        <>
          <CloudBackupRemarkModal
            visible={remarkVisible}
            settings={settings}
            taskEvent={taskEvent}
            onClose={() => setRemarkVisible(false)}
            onStart={async (fileName, requestId) => {
              await runCloudRemoteBackup(settings, { fileName, requestId });
            }}
            onCancelTask={async (requestId) => {
              await cancelCloudBackupTask(requestId);
            }}
          />
          <CloudBackupRestoreModal
            visible={restoreVisible}
            settings={settings}
            onCancel={() => setRestoreVisible(false)}
            onConfirm={runRestore}
          />
          <CloudBackupRestoreProgressModal
            visible={progressVisible}
            fileName={restoreRequest?.fileName || ''}
            requestId={restoreRequest?.requestId || null}
            taskEvent={taskEvent}
            restartRequired={restoreResult?.restartRequired}
            manifest={restoreResult?.manifest}
            currentPlatform={currentPlatform}
            errorMessage={restoreError}
            restarting={restarting}
            canceling={canceling}
            onClose={() => setProgressVisible(false)}
            onRestart={async () => {
              setRestarting(true);
              try {
                await ipcBridge.application.restart.invoke({ clearRuntimeState: true });
              } finally {
                setRestarting(false);
              }
            }}
            onCancelTask={async (requestId) => {
              setCanceling(true);
              await cancelCloudBackupTask(requestId);
              setCanceling(false);
            }}
          />
        </>
      )}

      <div className='flex items-center justify-between gap-12px'>
        <div className='min-w-0'>
          <div className='text-15px font-500 text-[var(--color-text-1)]'>{t('settings.backup.title')}</div>
          <div className='mt-4px text-13px text-[var(--color-text-3)]'>{t('settings.backup.description')}</div>
        </div>
        <Button
          data-testid='backup-panel-toggle'
          type='text'
          icon={expanded ? <Up theme='outline' size='14' /> : <Down theme='outline' size='14' />}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('settings.backup.collapseConfig') : t('settings.backup.expandConfig')}
        </Button>
      </div>

      {expanded ? (
        !isDesktop || !settings ? (
          <Alert type='info' content={t('settings.backup.desktopOnly')} />
        ) : (
          <div className='grid gap-14px xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]'>
            <div className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] p-16px space-y-14px'>
              <div className='text-14px font-600 text-[var(--color-text-1)]'>
                {t('settings.backup.connectionSection')}
              </div>
              <div data-testid='backup-provider-field'>
                <Select
                  data-testid='backup-provider-select'
                  value={activeProvider}
                  onChange={(value) =>
                    updateSettings((current) => ({ ...current, activeProvider: value as TBackupProvider }))
                  }
                >
                  <Select.Option value='webdav'>{t('settings.backup.webdav')}</Select.Option>
                  <Select.Option value='nutstore'>{t('settings.backup.nutstore')}</Select.Option>
                </Select>
              </div>
              <div data-testid='backup-link-field'>
                <Input
                  value={activeProvider === 'nutstore' ? NUTSTORE_WEBDAV_HOST : settings.webdav.host}
                  readOnly={activeProvider === 'nutstore'}
                  suffix={connectionAction}
                  onChange={(value) =>
                    updateSettings((current) => ({ ...current, webdav: { ...current.webdav, host: value } }))
                  }
                />
              </div>
              <div data-testid='backup-account-field'>
                <Input
                  value={activeProvider === 'nutstore' ? settings.nutstore.username : settings.webdav.username}
                  onChange={(value) =>
                    updateSettings((current) =>
                      activeProvider === 'nutstore'
                        ? { ...current, nutstore: { ...current.nutstore, username: value } }
                        : { ...current, webdav: { ...current.webdav, username: value } }
                    )
                  }
                />
              </div>
              <div data-testid='backup-password-field'>
                <div className='flex items-center gap-6px mb-6px'>
                  <span>
                    {activeProvider === 'nutstore'
                      ? t('settings.backup.nutstoreAppPassword')
                      : t('settings.backup.passwordOnly')}
                  </span>
                  {activeProvider === 'nutstore' ? (
                    <button
                      type='button'
                      aria-label=''
                      className='border-none bg-transparent p-0 text-[var(--color-text-3)]'
                      onClick={() => void ipcBridge.shell.openExternal.invoke(NUTSTORE_HELP_URL)}
                    >
                      <Info theme='outline' size='14' fill='currentColor' />
                    </button>
                  ) : null}
                </div>
                <Input.Password
                  value={activeProvider === 'nutstore' ? settings.nutstore.password : settings.webdav.password}
                  placeholder={
                    activeProvider === 'nutstore' ? t('settings.backup.nutstoreAppPasswordPlaceholder') : undefined
                  }
                  onChange={(value) =>
                    updateSettings((current) =>
                      activeProvider === 'nutstore'
                        ? { ...current, nutstore: { ...current.nutstore, password: value } }
                        : { ...current, webdav: { ...current.webdav, password: value } }
                    )
                  }
                />
              </div>
              <div data-testid='backup-remote-path-field'>
                <Input
                  value={providerConfig?.remotePath || ''}
                  onChange={(value) =>
                    updateSettings((current) =>
                      activeProvider === 'nutstore'
                        ? { ...current, nutstore: { ...current.nutstore, remotePath: value } }
                        : { ...current, webdav: { ...current.webdav, remotePath: value } }
                    )
                  }
                  placeholder='/AionUibackup'
                />
              </div>
              <div className='rounded-14px border border-solid border-[var(--color-border-2)] bg-[var(--fill-0)] px-12px py-12px'>
                <div className='text-13px font-500 text-[var(--color-text-1)]'>
                  {ready ? t('settings.backup.connectionReadyBadge') : t('settings.backup.connectionIncompleteBadge')}
                </div>
                <div className='mt-6px text-12px leading-5 text-[var(--color-text-3)]'>
                  {ready ? t('settings.backup.actionSectionDescription') : t('settings.backup.configureActionHint')}
                </div>
                <div className='mt-12px grid gap-10px sm:grid-cols-2'>
                  <Button
                    data-testid='backup-manual-action'
                    type='primary'
                    disabled={!configured}
                    onClick={() => setRemarkVisible(true)}
                  >
                    {t('settings.backup.manualBackup')}
                  </Button>
                  <Button
                    data-testid='backup-restore-action'
                    status='warning'
                    disabled={!configured}
                    onClick={() => setRestoreVisible(true)}
                  >
                    {t('settings.backup.restore')}
                  </Button>
                </div>
              </div>
            </div>

            <div className='flex flex-col gap-14px'>
              <div className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] p-16px space-y-14px'>
                <div className='text-14px font-600 text-[var(--color-text-1)]'>
                  {t('settings.backup.policySection')}
                </div>
                <Switch
                  checked={settings.autoBackupEnabled}
                  onChange={(checked) => updateSettings((current) => ({ ...current, autoBackupEnabled: checked }))}
                />
                <Select
                  value={settings.autoBackupIntervalHours}
                  disabled={!settings.autoBackupEnabled}
                  onChange={(value) => updateSettings((current) => ({ ...current, autoBackupIntervalHours: value }))}
                >
                  {intervalOptions.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                      {t(option.labelKey as never)}
                    </Select.Option>
                  ))}
                </Select>
                <Select
                  value={settings.maxBackupCount}
                  onChange={(value) => updateSettings((current) => ({ ...current, maxBackupCount: Number(value) }))}
                >
                  {maxBackupCountOptions.map((option) => (
                    <Select.Option key={option} value={option}>
                      {option === 0 ? t('settings.backup.retentionUnlimited') : option}
                    </Select.Option>
                  ))}
                </Select>
                <Switch
                  checked={settings.includeDefaultWorkspaceFiles}
                  onChange={(checked) =>
                    updateSettings((current) => ({ ...current, includeDefaultWorkspaceFiles: checked }))
                  }
                />
              </div>

              <div className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] p-16px space-y-10px'>
                <div className='text-13px font-500 text-[var(--color-text-1)]'>
                  {t('settings.backup.lastBackupPanelTitle')}
                </div>
                <div className='text-13px text-[var(--color-text-2)]'>{statusText}</div>
                <div className='text-12px text-[var(--color-text-3)]'>
                  {t('settings.backup.lastSuccessTime')}: {lastSuccessText}
                </div>
                <div className='text-12px text-[var(--color-text-3)]'>
                  {t('settings.backup.remotePath')}: {providerPath}
                </div>
              </div>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
};

export default CloudBackupSettingsSection;
