/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IBackupTaskEvent, ICloudBackupSettings } from '@/common/types/backup';
import { AUTO_BACKUP_INTERVAL_OPTIONS, NUTSTORE_HELP_URL, NUTSTORE_WEBDAV_HOST } from '@/common/types/backup';
import { withDefaultCloudBackupSettings } from '@/common/utils/backup';
import LanguageSwitcher from '@/renderer/components/LanguageSwitcher';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import CloudBackupRemarkModal from '@/renderer/components/SettingsModal/contents/CloudBackupRemarkModal';
import CloudBackupRestoreModal from '@/renderer/components/SettingsModal/contents/CloudBackupRestoreModal';
import { cancelCloudBackupTask, checkCloudBackupConnection, formatCloudBackupErrorMessage, getCloudBackupSettings, restoreCloudRemotePackage, runCloudRemoteBackup, saveCloudBackupSettings, startCloudBackupClient, subscribeCloudBackupTask } from '@/renderer/services/cloudBackup';
import { refreshCloudBackupScheduler } from '@/renderer/services/cloudBackupScheduler';
import { iconColors } from '@/renderer/theme/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Alert, Button, Form, Input, InputNumber, Message, Modal, Select, Switch, Tooltip } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { useSettingsViewMode } from '../settingsViewContext';

const intervalOptions = AUTO_BACKUP_INTERVAL_OPTIONS.map((value) => ({
  value,
  labelKey: value === 0 ? 'settings.backup.interval.off' : `settings.backup.interval.${value}h`,
}));

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

const BackupField: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className='grid grid-cols-[160px_1fr] items-center gap-12px'>
    <div className='text-13px text-[var(--color-text-2)]'>{label}</div>
    <div>{children}</div>
  </div>
);

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
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [remarkModalVisible, setRemarkModalVisible] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const initializingRef = useRef(true);
  const isDesktop = isElectronDesktop();
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
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
    try {
      await checkCloudBackupConnection(backupSettings);
      Message.success(t('settings.backup.connectionSuccess'));
    } catch (connectionError) {
      Message.error(connectionError instanceof Error ? connectionError.message : t('settings.backup.connectionFailed'));
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
  const currentStatusText = formatBackupTaskText(t, backupTaskEvent, backupSettings);

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
              <div>
                <div className='text-15px font-600 text-[var(--color-text-1)]'>{t('settings.backup.title')}</div>
                <div className='mt-4px text-13px text-[var(--color-text-3)]'>{t('settings.backup.description')}</div>
              </div>
            </div>

            {!isDesktop || !backupSettings ? (
              <Alert type='info' content={t('settings.backup.desktopOnly')} />
            ) : (
              <div className='space-y-14px'>
                <BackupField label={t('settings.backup.provider')}>
                  <Select value={backupSettings.activeProvider} onChange={(value) => updateBackupSettings((current) => ({ ...current, activeProvider: value }))}>
                    <Select.Option value='webdav'>{t('settings.backup.webdav')}</Select.Option>
                    <Select.Option value='nutstore'>{t('settings.backup.nutstore')}</Select.Option>
                  </Select>
                </BackupField>

                {activeProvider === 'webdav' ? (
                  <>
                    <BackupField label={t('settings.backup.host')}>
                      <Input value={backupSettings.webdav.host} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, host: value } }))} placeholder='https://example.com/dav' />
                    </BackupField>
                    <BackupField label={t('settings.backup.username')}>
                      <Input value={backupSettings.webdav.username} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, username: value } }))} />
                    </BackupField>
                    <BackupField label={t('settings.backup.password')}>
                      <Input.Password value={backupSettings.webdav.password} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, password: value } }))} />
                    </BackupField>
                    <BackupField label={t('settings.backup.remotePath')}>
                      <Input value={backupSettings.webdav.remotePath} onChange={(value) => updateBackupSettings((current) => ({ ...current, webdav: { ...current.webdav, remotePath: value } }))} placeholder='/AionUibackup' />
                    </BackupField>
                  </>
                ) : (
                  <>
                    <BackupField label={t('settings.backup.nutstoreUrl')}>
                      <Input value={NUTSTORE_WEBDAV_HOST} readOnly />
                    </BackupField>
                    <BackupField label={t('settings.backup.username')}>
                      <Input value={backupSettings.nutstore.username} onChange={(value) => updateBackupSettings((current) => ({ ...current, nutstore: { ...current.nutstore, username: value } }))} />
                    </BackupField>
                    <BackupField label={t('settings.backup.password')}>
                      <Input.Password value={backupSettings.nutstore.password} onChange={(value) => updateBackupSettings((current) => ({ ...current, nutstore: { ...current.nutstore, password: value } }))} />
                    </BackupField>
                    <BackupField label={t('settings.backup.remotePath')}>
                      <Input value={backupSettings.nutstore.remotePath} onChange={(value) => updateBackupSettings((current) => ({ ...current, nutstore: { ...current.nutstore, remotePath: value } }))} placeholder='/AionUibackup' />
                    </BackupField>
                    <Alert
                      type='info'
                      content={
                        <div className='space-y-6px'>
                          <div>{t('settings.backup.nutstorePasswordNotice')}</div>
                          <div>{t('settings.backup.nutstoreWebdavNotice')}</div>
                          <button type='button' className='cursor-pointer border-none bg-transparent p-0 text-left text-[var(--color-primary-6)] hover:underline' onClick={() => void ipcBridge.shell.openExternal.invoke(NUTSTORE_HELP_URL)}>
                            {t('settings.backup.nutstoreHelpAction')}
                          </button>
                        </div>
                      }
                    />
                  </>
                )}

                <BackupField label={t('settings.backup.includeDefaultWorkspaceFiles')}>
                  <Switch checked={backupSettings.includeDefaultWorkspaceFiles} onChange={(checked) => updateBackupSettings((current) => ({ ...current, includeDefaultWorkspaceFiles: checked }))} />
                </BackupField>
                <Alert type='info' content={t('settings.backup.defaultWorkspaceNotice')} />
                <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                  <div className='text-13px font-600 text-[var(--color-text-1)]'>{t('settings.backup.scopeIncludedTitle')}</div>
                  <div className='mt-6px text-12px leading-5 text-[var(--color-text-2)]'>{t('settings.backup.scopeIncludedText')}</div>
                  <div className='mt-12px text-13px font-600 text-[var(--color-text-1)]'>{t('settings.backup.scopeExcludedTitle')}</div>
                  <div className='mt-6px text-12px leading-5 text-[var(--color-text-2)]'>{t('settings.backup.scopeExcludedText')}</div>
                </div>

                <div className='flex flex-wrap gap-8px pt-4px'>
                  <Button loading={testingConnection} onClick={() => void handleTestConnection()}>
                    {t('settings.backup.testConnection')}
                  </Button>
                  <Button type='primary' onClick={() => setRemarkModalVisible(true)}>
                    {t('settings.backup.manualBackup')}
                  </Button>
                  <Button status='warning' onClick={() => setRestoreModalVisible(true)}>
                    {t('settings.backup.restore')}
                  </Button>
                </div>

                <div className='grid gap-12px pt-6px border-t border-solid border-[var(--color-border-2)]'>
                  <BackupField label={t('settings.backup.autoBackupEnabled')}>
                    <Switch checked={backupSettings.autoBackupEnabled} onChange={(checked) => updateBackupSettings((current) => ({ ...current, autoBackupEnabled: checked }))} />
                  </BackupField>
                  <BackupField label={t('settings.backup.autoBackupInterval')}>
                    <Select value={backupSettings.autoBackupIntervalHours} disabled={!backupSettings.autoBackupEnabled} onChange={(value) => updateBackupSettings((current) => ({ ...current, autoBackupIntervalHours: value }))}>
                      {intervalOptions.map((option) => (
                        <Select.Option key={option.value} value={option.value}>
                          {t(option.labelKey as never)}
                        </Select.Option>
                      ))}
                    </Select>
                  </BackupField>
                  <BackupField label={t('settings.backup.maxBackupCount')}>
                    <InputNumber min={1} max={99} value={backupSettings.maxBackupCount} onChange={(value) => updateBackupSettings((current) => ({ ...current, maxBackupCount: Number(value || 1) }))} />
                  </BackupField>
                  <BackupField label={t('settings.backup.lastStatus')}>
                    <div className='text-13px text-[var(--color-text-2)]'>{currentStatusText}</div>
                  </BackupField>
                  <BackupField label={t('settings.backup.lastSuccessTime')}>
                    <div className='text-13px text-[var(--color-text-2)]'>{backupSettings.lastBackupSuccessAt ? formatter.format(new Date(backupSettings.lastBackupSuccessAt)) : t('settings.backup.never')}</div>
                  </BackupField>
                </div>
              </div>
            )}
          </div>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default SystemModalContent;
