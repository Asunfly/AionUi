/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IBackupTaskEvent, ICloudBackupSettings, TBackupProvider } from '@/common/types/backup';
import { AUTO_BACKUP_INTERVAL_OPTIONS, NUTSTORE_HELP_URL, NUTSTORE_WEBDAV_HOST } from '@/common/types/backup';
import { isCloudBackupConfigured, normalizeRemotePath, withDefaultCloudBackupSettings } from '@/common/utils/backup';
import LanguageSwitcher from '@/renderer/components/LanguageSwitcher';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import CloudBackupRemarkModal from '@/renderer/components/SettingsModal/contents/CloudBackupRemarkModal';
import CloudBackupRestoreModal from '@/renderer/components/SettingsModal/contents/CloudBackupRestoreModal';
import { cancelCloudBackupTask, checkCloudBackupConnection, formatCloudBackupErrorMessage, getCloudBackupSettings, restoreCloudRemotePackage, runCloudRemoteBackup, saveCloudBackupSettings, startCloudBackupClient, subscribeCloudBackupTask } from '@/renderer/services/cloudBackup';
import { refreshCloudBackupScheduler } from '@/renderer/services/cloudBackupScheduler';
import { iconColors } from '@/renderer/theme/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Alert, Button, Form, Input, Message, Modal, Select, Switch, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, CloudStorage, Down, FolderOpen, Heartbeat, Info, LinkCloud, Loading, Lock, Right, Up } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { useSettingsViewMode } from '../settingsViewContext';

const intervalOptions = AUTO_BACKUP_INTERVAL_OPTIONS.map((value) => ({
  value,
  labelKey: value === 0 ? 'settings.backup.interval.off' : `settings.backup.interval.${value}h`,
}));

const maxBackupCountOptions = [0, 5, 10, 20, 50, 100] as const;

const DirInputItem: React.FC<{
  label: string;
  field: string;
}> = ({ label, field }) => {
  const { t } = useTranslation();

  return (
    <Form.Item label={label} field={field}>
      {(_value, form) => {
        const currentValue = form.getFieldValue(field) || '';

        const handlePick = () => {
          ipcBridge.dialog.showOpen
            .invoke({
              defaultPath: currentValue,
              properties: ['openDirectory', 'createDirectory'],
            })
            .then((data) => {
              if (data?.[0]) {
                form.setFieldValue(field, data[0]);
              }
            })
            .catch((error) => {
              console.error('Failed to open directory dialog:', error);
            });
        };

        return (
          <div className='aion-dir-input h-[32px] flex items-center rounded-8px border border-solid border-transparent pl-14px bg-[var(--fill-0)]'>
            <Tooltip content={currentValue || t('settings.dirNotConfigured')} position='top'>
              <div className='flex-1 min-w-0 text-13px text-t-primary truncate'>{currentValue || t('settings.dirNotConfigured')}</div>
            </Tooltip>
            <Button
              type='text'
              style={{ borderLeft: '1px solid var(--color-border-2)', borderRadius: '0 8px 8px 0' }}
              icon={<FolderOpen theme='outline' size='18' fill={iconColors.primary} />}
              onClick={(event) => {
                event.stopPropagation();
                handlePick();
              }}
            />
          </div>
        );
      }}
    </Form.Item>
  );
};

const PreferenceRow: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='text-14px text-2'>{label}</div>
    <div className='flex-1 flex justify-end'>{children}</div>
  </div>
);

const FieldHint: React.FC<{
  content: React.ReactNode;
  ariaLabel: string;
}> = ({ content, ariaLabel }) => (
  <Tooltip content={content} position='top'>
    <button type='button' aria-label={ariaLabel} className='inline-flex h-20px w-20px flex-shrink-0 items-center justify-center self-center rounded-full border border-solid border-[var(--color-border-2)] bg-[var(--fill-0)] p-0 leading-none text-[var(--color-text-3)] transition-colors hover:border-[var(--color-primary-light-4)] hover:text-[var(--color-primary-6)]'>
      <Info theme='outline' size='14' fill='currentColor' />
    </button>
  </Tooltip>
);

const BackupField: React.FC<{
  label: string;
  hint?: React.ReactNode;
  alignStart?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, alignStart = false, children }) => (
  <div className={`grid gap-12px md:grid-cols-[168px_1fr] ${alignStart ? 'items-start' : 'items-center'}`}>
    <div className='flex items-start gap-6px'>
      <div className='pt-2px text-13px text-[var(--color-text-2)]'>{label}</div>
      {hint ? <FieldHint content={hint} ariaLabel={label} /> : null}
    </div>
    <div>{children}</div>
  </div>
);

const BackupSectionCard: React.FC<{
  title: string;
  description?: React.ReactNode;
  headerSlot?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, headerSlot, children }) => (
  <div className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-14px py-14px md:px-16px'>
    <div className='flex items-start justify-between gap-12px'>
      <div>
        <div className='text-14px font-600 text-[var(--color-text-1)]'>{title}</div>
        {description && <div className='mt-4px text-12px leading-5 text-[var(--color-text-3)]'>{description}</div>}
      </div>
      {headerSlot ? <div className='flex-shrink-0'>{headerSlot}</div> : null}
    </div>
    <div className='mt-14px space-y-14px'>{children}</div>
  </div>
);

function renderBackupProviderIcon(provider: TBackupProvider, size = 18): React.ReactNode {
  if (provider === 'nutstore') {
    return <CloudStorage theme='outline' size={size} fill='currentColor' />;
  }

  return <LinkCloud theme='outline' size={size} fill='currentColor' />;
}

function getStatusTone(status: NonNullable<ICloudBackupSettings['lastBackupStatus']> | 'running'): {
  iconClass: string;
  cardClass: string;
} {
  switch (status) {
    case 'success':
      return {
        iconClass: 'bg-[var(--color-success-light-2)] text-[var(--color-success-6)]',
        cardClass: 'border-[var(--color-success-light-3)] bg-[var(--color-success-light-1)]',
      };
    case 'error':
      return {
        iconClass: 'bg-[var(--color-danger-light-2)] text-[var(--color-danger-6)]',
        cardClass: 'border-[var(--color-danger-light-3)] bg-[var(--color-danger-light-1)]',
      };
    case 'running':
      return {
        iconClass: 'bg-[var(--color-primary-light-2)] text-[var(--color-primary-6)]',
        cardClass: 'border-[var(--color-primary-light-4)] bg-[var(--color-primary-light-1)]',
      };
    default:
      return {
        iconClass: 'bg-[var(--fill-0)] text-[var(--color-text-3)]',
        cardClass: 'border-[var(--color-border-2)] bg-[var(--fill-1)]',
      };
  }
}

function renderBackupStatusIcon(status: NonNullable<ICloudBackupSettings['lastBackupStatus']> | 'running'): React.ReactNode {
  switch (status) {
    case 'success':
      return <CheckOne theme='filled' size='14' fill='currentColor' />;
    case 'error':
      return <CloseOne theme='filled' size='14' fill='currentColor' />;
    case 'running':
      return <Loading theme='outline' size='14' className='animate-spin' fill='currentColor' />;
    default:
      return <Info theme='outline' size='14' fill='currentColor' />;
  }
}

function formatBackupTaskText(t: ReturnType<typeof useTranslation>['t'], event: IBackupTaskEvent | null, settings: ICloudBackupSettings | null): string {
  if (event && event.task !== 'list' && event.phase !== 'success' && event.phase !== 'error') {
    return t('settings.backup.taskProgress', {
      defaultValue: '{{task}}: {{phase}}',
      task: t(`settings.backup.taskLabel.${event.task}` as never, { defaultValue: event.task }),
      phase: t(`settings.backup.phase.${event.phase}` as never, { defaultValue: event.phase }),
    });
  }

  if (!settings?.lastBackupStatus || settings.lastBackupStatus === 'idle') {
    return t('settings.backup.statusIdle');
  }

  if (settings.lastBackupMessage) {
    return settings.lastBackupMessage;
  }

  return t(`settings.backup.status.${settings.lastBackupStatus}` as never, {
    defaultValue: settings.lastBackupStatus,
  });
}

const SystemModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [modal, modalContextHolder] = Modal.useModal();
  const [error, setError] = useState<string | null>(null);
  const [backupSettings, setBackupSettings] = useState<ICloudBackupSettings | null>(null);
  const [backupTaskEvent, setBackupTaskEvent] = useState<IBackupTaskEvent | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestStatus, setConnectionTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionTestMessage, setConnectionTestMessage] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [remarkModalVisible, setRemarkModalVisible] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [backupPanelExpanded, setBackupPanelExpanded] = useState(false);
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const initializingRef = useRef(true);
  const isDesktop = isElectronDesktop();
  const compactDateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    []
  );

  const [closeToTray, setCloseToTray] = useState(false);

  useEffect(() => {
    ipcBridge.systemSettings.getCloseToTray
      .invoke()
      .then((enabled) => setCloseToTray(enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    startCloudBackupClient();
    void getCloudBackupSettings().then((settings) => {
      setBackupSettings(settings);
    });

    return subscribeCloudBackupTask((event) => {
      setBackupTaskEvent(event);
      if (!event || event.task === 'list') {
        return;
      }

      setBackupSettings((previous) => {
        if (!previous) {
          return previous;
        }

        if (event.phase === 'success') {
          return {
            ...previous,
            lastBackupStatus: 'success',
            lastBackupSuccessAt: event.timestamp,
            lastBackupMessage: event.fileName || previous.lastBackupMessage,
          };
        }

        if (event.phase === 'error') {
          return {
            ...previous,
            lastBackupStatus: event.errorCode === 'backup_canceled' ? 'idle' : 'error',
            lastBackupMessage: formatCloudBackupErrorMessage(event.errorCode, event.message) || previous.lastBackupMessage,
          };
        }

        return {
          ...previous,
          lastBackupStatus: 'running',
          lastBackupMessage: `${event.task}:${event.phase}`,
        };
      });
    });
  }, [isDesktop]);

  const handleCloseToTrayChange = useCallback((checked: boolean) => {
    setCloseToTray(checked);
    ipcBridge.systemSettings.setCloseToTray.invoke({ enabled: checked }).catch(() => {
      setCloseToTray(!checked);
    });
  }, []);

  const { data: systemInfo } = useSWR('system.dir.info', () => ipcBridge.application.systemInfo.invoke());

  useEffect(() => {
    if (systemInfo) {
      initializingRef.current = true;
      form.setFieldsValue({ cacheDir: systemInfo.cacheDir, workDir: systemInfo.workDir });
      requestAnimationFrame(() => {
        initializingRef.current = false;
      });
    }
  }, [systemInfo, form]);

  const preferenceItems = [
    { key: 'language', label: t('settings.language'), component: <LanguageSwitcher /> },
    { key: 'closeToTray', label: t('settings.closeToTray'), component: <Switch checked={closeToTray} onChange={handleCloseToTrayChange} /> },
  ];

  const saveDirConfigValidate = (_values: { cacheDir: string; workDir: string }): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      modal.confirm({
        title: t('settings.updateConfirm'),
        content: t('settings.restartConfirm'),
        onOk: resolve,
        onCancel: reject,
      });
    });
  };

  const savingRef = useRef(false);

  const handleValuesChange = useCallback(
    async (_changedValue: unknown, allValues: Record<string, string>) => {
      if (initializingRef.current || savingRef.current || !systemInfo) return;
      const { cacheDir, workDir } = allValues;
      const needsRestart = cacheDir !== systemInfo.cacheDir || workDir !== systemInfo.workDir;
      if (!needsRestart) return;

      savingRef.current = true;
      setError(null);
      try {
        await saveDirConfigValidate({ cacheDir, workDir });
        const result = await ipcBridge.application.updateSystemInfo.invoke({ cacheDir, workDir });
        if (result.success) {
          await ipcBridge.application.restart.invoke();
        } else {
          setError(result.msg || 'Failed to update system info');
          form.setFieldValue('cacheDir', systemInfo.cacheDir);
          form.setFieldValue('workDir', systemInfo.workDir);
        }
      } catch (caughtError: unknown) {
        form.setFieldValue('cacheDir', systemInfo.cacheDir);
        form.setFieldValue('workDir', systemInfo.workDir);
        if (caughtError) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      } finally {
        savingRef.current = false;
      }
    },
    [systemInfo, form, saveDirConfigValidate]
  );

  const updateBackupSettings = useCallback(
    (updater: (current: ICloudBackupSettings) => ICloudBackupSettings) => {
      setBackupSettings((previous) => {
        const next = updater(withDefaultCloudBackupSettings(previous));
        void saveCloudBackupSettings(next)
          .then(() => refreshCloudBackupScheduler())
          .catch((saveError) => {
            Message.error(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
          });
        return next;
      });
    },
    [t]
  );

  const handleTestConnection = useCallback(async () => {
    if (!backupSettings) {
      return;
    }

    setTestingConnection(true);
    setConnectionTestStatus('idle');
    setConnectionTestMessage('');
    try {
      await checkCloudBackupConnection(backupSettings);
      setConnectionTestStatus('success');
      setConnectionTestMessage(t('settings.backup.connectionSuccess'));
    } catch (connectionError) {
      setConnectionTestStatus('error');
      setConnectionTestMessage(connectionError instanceof Error ? connectionError.message : t('settings.backup.connectionFailed'));
    } finally {
      setTestingConnection(false);
    }
  }, [backupSettings, t]);

  const handleManualBackupConfirm = useCallback(
    async (fileName: string, requestId: string) => {
      if (!backupSettings) {
        return;
      }

      await runCloudRemoteBackup(backupSettings, { fileName, requestId });
    },
    [backupSettings]
  );

  const handleManualBackupCancel = useCallback(async (requestId: string) => {
    await cancelCloudBackupTask(requestId);
  }, []);

  const handleRestoreConfirm = useCallback(
    async (fileName: string) => {
      if (!backupSettings) {
        return;
      }

      modal.confirm({
        title: t('settings.backup.restoreConfirmTitle'),
        content: t('settings.backup.restoreConfirmContent', { fileName }),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          setRestoreLoading(true);
          try {
            const result = await restoreCloudRemotePackage(backupSettings, fileName);
            setRestoreModalVisible(false);
            if (result.restartRequired) {
              if (result.manifest?.sourcePlatform && systemInfo?.platform && result.manifest.sourcePlatform !== systemInfo.platform) {
                modal.info({
                  title: t('settings.backup.crossPlatformRestoreTitle' as never),
                  content: t('settings.backup.crossPlatformRestoreDescription' as never, {
                    sourcePlatform: result.manifest.sourcePlatform,
                    currentPlatform: systemInfo.platform,
                  }),
                  onOk: async () => {
                    await ipcBridge.application.restart.invoke();
                  },
                });
                return;
              }

              await ipcBridge.application.restart.invoke();
            }
          } finally {
            setRestoreLoading(false);
          }
        },
      });
    },
    [backupSettings, modal, t]
  );

  const activeProvider = backupSettings?.activeProvider || 'webdav';
  const activeProviderLabel = t(activeProvider === 'nutstore' ? 'settings.backup.nutstore' : 'settings.backup.webdav');
  const connectionCoreReady = backupSettings ? (activeProvider === 'nutstore' ? Boolean(backupSettings.nutstore.username.trim() && backupSettings.nutstore.password.trim()) : Boolean(backupSettings.webdav.host.trim() && backupSettings.webdav.username.trim() && backupSettings.webdav.password.trim())) : false;
  const currentStatusText = formatBackupTaskText(t, backupTaskEvent, backupSettings);
  const backupConfigured = backupSettings ? isCloudBackupConfigured(backupSettings) : false;
  const currentProviderPath = backupSettings ? normalizeRemotePath(activeProvider === 'nutstore' ? backupSettings.nutstore.remotePath : backupSettings.webdav.remotePath) : '--';
  const effectiveStatus = backupTaskEvent && backupTaskEvent.task !== 'list' && backupTaskEvent.phase !== 'success' && backupTaskEvent.phase !== 'error' ? 'running' : backupSettings?.lastBackupStatus || 'idle';
  const statusTone = getStatusTone(effectiveStatus);
  const lastBackupTime = backupSettings?.lastBackupSuccessAt ? compactDateTimeFormatter.format(new Date(backupSettings.lastBackupSuccessAt)).replace(',', '') : t('settings.backup.never');
  const providerDescription = t(activeProvider === 'nutstore' ? 'settings.backup.providerNutstoreDescription' : 'settings.backup.providerWebdavDescription');

  useEffect(() => {
    setConnectionTestStatus('idle');
    setConnectionTestMessage('');
  }, [activeProvider, backupSettings?.webdav.host, backupSettings?.webdav.username, backupSettings?.webdav.password, backupSettings?.nutstore.username, backupSettings?.nutstore.password]);

  const connectionTestTooltip = testingConnection ? t('settings.backup.phase.connecting') : connectionTestMessage;
  const connectionTestButtonClass = testingConnection ? 'text-[var(--color-primary-6)] hover:bg-[var(--color-primary-light-1)]' : connectionTestStatus === 'success' ? 'text-[var(--color-success-6)] hover:bg-[var(--color-success-light-1)]' : connectionTestStatus === 'error' ? 'text-[var(--color-danger-6)] hover:bg-[var(--color-danger-light-1)]' : 'text-[var(--color-text-3)] hover:bg-[var(--fill-1)] hover:text-[var(--color-primary-6)]';
  const connectionStatusBannerClass = testingConnection ? 'border-[var(--color-primary-light-4)] bg-[rgba(64,128,255,0.08)] text-[var(--color-primary-6)]' : connectionTestStatus === 'success' ? 'border-[var(--color-success-light-3)] bg-[var(--color-success-light-1)] text-[var(--color-success-6)]' : 'border-[var(--color-danger-light-3)] bg-[var(--color-danger-light-1)] text-[var(--color-danger-6)]';
  const connectionStatusBannerIcon = testingConnection ? <Loading theme='outline' size='14' className='animate-spin' fill='currentColor' /> : connectionTestStatus === 'success' ? <CheckOne theme='filled' size='14' fill='currentColor' /> : <CloseOne theme='filled' size='14' fill='currentColor' />;
  const connectionTestAction = connectionCoreReady ? (
    <Tooltip content={connectionTestTooltip} position='top' disabled={!connectionTestTooltip}>
      <button type='button' aria-label={t('settings.backup.testConnection')} className={`mr-[-4px] inline-flex h-28px w-28px items-center justify-center rounded-8px border-none bg-transparent p-0 transition-colors ${connectionTestButtonClass}`} onMouseDown={(event) => event.preventDefault()} onClick={() => void handleTestConnection()}>
        {testingConnection ? <Loading theme='outline' size='16' className='animate-spin' fill='currentColor' /> : <Heartbeat theme='outline' size='16' fill='currentColor' />}
      </button>
    </Tooltip>
  ) : null;

  return (
    <div className='flex flex-col h-full w-full'>
      {modalContextHolder}
      {isDesktop && backupSettings && (
        <>
          <CloudBackupRemarkModal visible={remarkModalVisible} settings={backupSettings} taskEvent={backupTaskEvent} onClose={() => setRemarkModalVisible(false)} onStart={handleManualBackupConfirm} onCancelTask={handleManualBackupCancel} />
          <CloudBackupRestoreModal visible={restoreModalVisible} settings={backupSettings} confirmLoading={restoreLoading} onCancel={() => setRestoreModalVisible(false)} onConfirm={handleRestoreConfirm} />
        </>
      )}

      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px'>
            <div className='w-full flex flex-col divide-y divide-border-2'>
              {preferenceItems.map((item) => (
                <PreferenceRow key={item.key} label={item.label}>
                  {item.component}
                </PreferenceRow>
              ))}
            </div>
            <Form form={form} layout='vertical' className='space-y-16px' onValuesChange={handleValuesChange}>
              <DirInputItem label={t('settings.cacheDir')} field='cacheDir' />
              <DirInputItem label={t('settings.workDir')} field='workDir' />
              {error && <Alert className='mt-16px' type='error' content={typeof error === 'string' ? error : JSON.stringify(error)} />}
            </Form>
          </div>

          <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-16px'>
            <div className='flex items-center justify-between gap-12px'>
              <div className='flex min-w-0 items-start gap-10px'>
                <span className='mt-1px inline-flex h-30px w-30px flex-shrink-0 items-center justify-center rounded-10px bg-[var(--fill-0)] text-[var(--color-primary-6)]'>
                  <CloudStorage theme='outline' size='16' fill='currentColor' />
                </span>
                <div className='min-w-0'>
                  <div className='text-15px font-600 text-[var(--color-text-1)]'>{t('settings.backup.title')}</div>
                  <div className='mt-4px text-13px text-[var(--color-text-3)]'>{t('settings.backup.description')}</div>
                </div>
              </div>
              <Button type='text' className='!rounded-10px !px-10px !text-[var(--color-text-2)] hover:!bg-[var(--fill-0)]' icon={backupPanelExpanded ? <Up theme='outline' size='14' fill='currentColor' /> : <Down theme='outline' size='14' fill='currentColor' />} onClick={() => setBackupPanelExpanded((previous) => !previous)}>
                {backupPanelExpanded ? t('settings.backup.collapseConfig') : t('settings.backup.expandConfig')}
              </Button>
            </div>

            {backupPanelExpanded ? (
              !isDesktop || !backupSettings ? (
                <Alert type='info' content={t('settings.backup.desktopOnly')} />
              ) : (
                <div className='grid gap-14px xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]'>
                  <div className='space-y-14px'>
                    <BackupSectionCard title={t('settings.backup.connectionSection')} description={t('settings.backup.connectionSectionDescription')}>
                      <BackupField label={t('settings.backup.provider')}>
                        <div className='space-y-8px'>
                          <Select value={activeProvider} onChange={(value) => updateBackupSettings((current) => ({ ...current, activeProvider: value as TBackupProvider }))}>
                            <Select.Option value='webdav'>{t('settings.backup.webdav')}</Select.Option>
                            <Select.Option value='nutstore'>{t('settings.backup.nutstore')}</Select.Option>
                          </Select>
                          <div className='text-12px leading-5 text-[var(--color-text-3)]'>{providerDescription}</div>
                        </div>
                      </BackupField>

                      {activeProvider === 'nutstore' && (
                        <div className='rounded-14px border border-solid border-[var(--color-primary-light-4)] bg-[rgba(64,128,255,0.08)] px-12px py-12px'>
                          <div className='flex flex-col gap-10px md:flex-row md:items-center md:justify-between'>
                            <div className='flex min-w-0 items-center gap-8px text-13px font-600 text-[var(--color-text-1)]'>
                              <Lock theme='outline' size='14' fill='currentColor' />
                              <span>{t('settings.backup.nutstorePasswordNotice')}</span>
                            </div>
                            <button type='button' className='inline-flex items-center gap-4px self-start whitespace-nowrap border-none bg-transparent p-0 text-12px font-600 text-[var(--color-primary-6)] transition-opacity hover:opacity-80' onClick={() => void ipcBridge.shell.openExternal.invoke(NUTSTORE_HELP_URL)}>
                              {t('settings.backup.nutstoreHelpAction')}
                              <Right theme='outline' size='12' fill='currentColor' />
                            </button>
                          </div>
                        </div>
                      )}

                      {activeProvider === 'webdav' ? (
                        <>
                          <BackupField label={t('settings.backup.link')}>
                            <Input value={backupSettings.webdav.host} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, host: value } }))} placeholder='https://example.com/dav' suffix={connectionTestAction} />
                          </BackupField>
                          <BackupField label={t('settings.backup.account')}>
                            <Input value={backupSettings.webdav.username} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, username: value } }))} />
                          </BackupField>
                          <BackupField label={t('settings.backup.password')}>
                            <Input.Password value={backupSettings.webdav.password} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, password: value } }))} />
                          </BackupField>
                          <BackupField label={t('settings.backup.remotePath')} hint={t('settings.backup.remotePathHint')}>
                            <Input value={backupSettings.webdav.remotePath} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, remotePath: value } }))} placeholder='/AionUibackup' />
                          </BackupField>
                        </>
                      ) : (
                        <>
                          <BackupField label={t('settings.backup.link')}>
                            <Input value={NUTSTORE_WEBDAV_HOST} readOnly className='opacity-75' suffix={connectionTestAction} />
                          </BackupField>
                          <BackupField label={t('settings.backup.account')}>
                            <Input value={backupSettings.nutstore.username} onChange={(value) => updateBackupSettings((current) => ({ ...current, nutstore: { ...current.nutstore, username: value } }))} />
                          </BackupField>
                          <BackupField label={t('settings.backup.password')} hint={t('settings.backup.nutstorePasswordNotice')}>
                            <Input.Password value={backupSettings.nutstore.password} onChange={(value) => updateBackupSettings((current) => ({ ...current, nutstore: { ...current.nutstore, password: value } }))} />
                          </BackupField>
                          <BackupField label={t('settings.backup.remotePath')} hint={t('settings.backup.remotePathHint')}>
                            <Input value={backupSettings.nutstore.remotePath} onChange={(value) => updateBackupSettings((current) => ({ ...current, nutstore: { ...current.nutstore, remotePath: value } }))} placeholder='/AionUibackup' />
                          </BackupField>
                        </>
                      )}

                      {(testingConnection || connectionTestStatus !== 'idle') && (
                        <div className={`rounded-14px border border-solid px-12px py-12px ${connectionStatusBannerClass}`}>
                          <div className='flex items-center gap-8px'>
                            {connectionStatusBannerIcon}
                            <span className='text-13px font-600'>{connectionTestTooltip}</span>
                          </div>
                        </div>
                      )}

                      <div className='rounded-14px border border-solid border-[var(--color-border-2)] bg-[var(--fill-0)] px-12px py-12px'>
                        <div className='flex flex-wrap items-center gap-8px'>
                          <span className={`inline-flex items-center gap-6px rounded-full px-10px py-4px text-12px font-600 ${connectionCoreReady ? 'bg-[var(--color-primary-light-1)] text-[var(--color-primary-6)]' : 'bg-[var(--fill-2)] text-[var(--color-text-3)]'}`}>
                            {connectionCoreReady ? <CheckOne theme='outline' size='12' fill='currentColor' /> : <Info theme='outline' size='12' fill='currentColor' />}
                            {connectionCoreReady ? t('settings.backup.connectionReadyBadge') : t('settings.backup.connectionIncompleteBadge')}
                          </span>
                          <span className='inline-flex items-center gap-6px rounded-full bg-[var(--fill-1)] px-10px py-4px text-12px font-600 text-[var(--color-text-2)]'>
                            {renderBackupProviderIcon(activeProvider, 14)}
                            {activeProviderLabel}
                          </span>
                        </div>
                        <div className='mt-8px text-12px leading-5 text-[var(--color-text-3)]'>{connectionCoreReady ? t('settings.backup.connectionReadyHint', { provider: activeProviderLabel }) : t('settings.backup.fillConnectionFieldsHint')}</div>

                        <div className='mt-12px grid gap-10px sm:grid-cols-2'>
                          <Button type='primary' disabled={!backupConfigured} onClick={() => setRemarkModalVisible(true)}>
                            {t('settings.backup.manualBackup')}
                          </Button>
                          <Button status='warning' disabled={!backupConfigured} onClick={() => setRestoreModalVisible(true)}>
                            {t('settings.backup.restore')}
                          </Button>
                        </div>

                        <div className='mt-10px text-12px leading-5 text-[var(--color-text-3)]'>{backupConfigured ? t('settings.backup.actionSectionDescription') : t('settings.backup.configureActionHint')}</div>
                      </div>
                    </BackupSectionCard>
                  </div>

                  <div className='space-y-14px'>
                    <BackupSectionCard title={t('settings.backup.policySection')} description={t('settings.backup.policySectionDescription')}>
                      <BackupField label={t('settings.backup.autoBackupEnabled')}>
                        <Switch checked={backupSettings.autoBackupEnabled} onChange={(checked) => updateBackupSettings((current) => ({ ...current, autoBackupEnabled: checked }))} />
                      </BackupField>
                      <BackupField label={t('settings.backup.autoBackupInterval')} hint={t('settings.backup.autoBackupIntervalDescription')}>
                        <Select value={backupSettings.autoBackupIntervalHours} disabled={!backupSettings.autoBackupEnabled} onChange={(value) => updateBackupSettings((current) => ({ ...current, autoBackupIntervalHours: value }))}>
                          {intervalOptions.map((option) => (
                            <Select.Option key={option.value} value={option.value}>
                              {t(option.labelKey as never)}
                            </Select.Option>
                          ))}
                        </Select>
                      </BackupField>
                      <BackupField label={t('settings.backup.maxBackupCount')} hint={t('settings.backup.maxBackupCountDescription')}>
                        <Select value={backupSettings.maxBackupCount} onChange={(value) => updateBackupSettings((current) => ({ ...current, maxBackupCount: Number(value) }))}>
                          {maxBackupCountOptions.map((option) => (
                            <Select.Option key={option} value={option}>
                              {option === 0 ? t('settings.backup.retentionUnlimited') : option}
                            </Select.Option>
                          ))}
                        </Select>
                      </BackupField>
                      <BackupField label={t('settings.backup.includeDefaultWorkspaceFiles')} hint={t('settings.backup.defaultWorkspaceNotice')} alignStart>
                        <Switch checked={backupSettings.includeDefaultWorkspaceFiles} onChange={(checked) => updateBackupSettings((current) => ({ ...current, includeDefaultWorkspaceFiles: checked }))} />
                      </BackupField>
                    </BackupSectionCard>

                    <div className={`rounded-16px border border-solid px-14px py-14px md:px-16px ${statusTone.cardClass}`}>
                      <div className='flex flex-col gap-12px md:flex-row md:items-start md:justify-between'>
                        <div className='min-w-0'>
                          <div className='flex flex-wrap items-center gap-10px'>
                            <span className={`inline-flex h-28px w-28px items-center justify-center rounded-full ${statusTone.iconClass}`}>{renderBackupStatusIcon(effectiveStatus)}</span>
                            <div className='text-14px font-600 text-[var(--color-text-1)]'>{t('settings.backup.lastBackupPanelTitle')}</div>
                            <span className='inline-flex items-center gap-6px rounded-full bg-[rgba(255,255,255,0.45)] px-10px py-4px text-12px font-600 text-[var(--color-text-2)]'>
                              {renderBackupProviderIcon(activeProvider, 14)}
                              {activeProviderLabel}
                            </span>
                          </div>
                          <div className='mt-10px break-all text-13px leading-5 text-[var(--color-text-2)]'>{currentStatusText}</div>
                        </div>
                        <div className='rounded-12px bg-[rgba(255,255,255,0.45)] px-12px py-10px'>
                          <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.lastSuccessTime')}</div>
                          <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{lastBackupTime}</div>
                        </div>
                      </div>

                      <div className='mt-12px rounded-12px bg-[rgba(255,255,255,0.45)] px-12px py-10px'>
                        <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.remotePath')}</div>
                        <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{currentProviderPath}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default SystemModalContent;
