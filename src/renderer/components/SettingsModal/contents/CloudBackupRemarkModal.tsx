/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBackupTaskEvent, ICloudBackupSettings } from '@/common/types/backup';
import { formatCloudBackupErrorMessage, getSuggestedCloudBackupFileName } from '@/renderer/services/cloudBackup';
import AionSteps from '@/renderer/components/base/AionSteps';
import { Alert, Input, Modal } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CloudBackupRemarkModalProps {
  visible: boolean;
  settings: ICloudBackupSettings;
  taskEvent: IBackupTaskEvent | null;
  onClose: () => void;
  onStart: (fileName: string, requestId: string) => Promise<void>;
  onCancelTask: (requestId: string) => Promise<void>;
}

function formatFileSize(size?: number): string {
  if (!size || size <= 0) {
    return '--';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const BACKUP_STEP_PHASES = ['connecting', 'snapshotting', 'collecting', 'packaging', 'uploading', 'success'] as const;

const CloudBackupRemarkModal: React.FC<CloudBackupRemarkModalProps> = ({ visible, settings, taskEvent, onClose, onStart, onCancelTask }) => {
  const { t } = useTranslation();
  const [fileName, setFileName] = useState('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [loadingSuggestedName, setLoadingSuggestedName] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    []
  );

  const activeEvent = useMemo(() => {
    if (!taskEvent || taskEvent.task !== 'backup' || !activeRequestId) {
      return null;
    }

    return taskEvent.requestId === activeRequestId ? taskEvent : null;
  }, [activeRequestId, taskEvent]);

  const isRunning = Boolean(activeRequestId) && (!activeEvent || (activeEvent.phase !== 'success' && activeEvent.phase !== 'error'));
  const isSuccess = activeEvent?.phase === 'success';
  const phaseIndex = BACKUP_STEP_PHASES.findIndex((phase) => phase === (activeEvent?.phase || 'connecting'));
  const currentStep = phaseIndex < 0 ? 0 : phaseIndex;

  useEffect(() => {
    if (!visible) {
      setFileName('');
      setActiveRequestId(null);
      setInlineError(null);
      setLoadingSuggestedName(false);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }

    if (fileName || activeRequestId) {
      return;
    }

    setLoadingSuggestedName(true);
    void getSuggestedCloudBackupFileName()
      .then((suggested) => setFileName(suggested))
      .catch(() => {
        setFileName('');
      })
      .finally(() => {
        setLoadingSuggestedName(false);
      });
  }, [activeRequestId, fileName, visible]);

  useEffect(() => {
    if (!activeEvent) {
      return;
    }

    if (activeEvent.phase === 'error') {
      setActiveRequestId(null);
      setInlineError(formatCloudBackupErrorMessage(activeEvent.errorCode, activeEvent.message));
    }
  }, [activeEvent]);

  useEffect(() => {
    if (!visible || !isSuccess) {
      return;
    }

    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 2000);

    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isSuccess, onClose, visible]);

  const handleSubmit = () => {
    const requestId = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setInlineError(null);
    setActiveRequestId(requestId);
    void onStart(fileName, requestId).catch((error) => {
      setActiveRequestId(null);
      setInlineError(error instanceof Error ? error.message : t('settings.backup.error.unknown'));
    });
  };

  const handleCancel = () => {
    if (!isRunning || !activeRequestId) {
      onClose();
      return;
    }

    Modal.confirm({
      title: t('settings.backup.cancelConfirmTitle'),
      content: t('settings.backup.cancelConfirmContent'),
      onOk: async () => {
        await onCancelTask(activeRequestId);
        onClose();
      },
    });
  };

  return (
    <Modal
      title={t('settings.backup.remarkModalTitle')}
      visible={visible}
      onCancel={handleCancel}
      onOk={isSuccess ? onClose : handleSubmit}
      okText={isSuccess ? t('common.close') : t('settings.backup.startBackup')}
      okButtonProps={{
        disabled: !fileName.trim() || loadingSuggestedName || isRunning,
      }}
      cancelButtonProps={{
        disabled: false,
      }}
    >
      <div className='space-y-16px'>
        {!isRunning && !isSuccess && (
          <>
            <Alert type='warning' content={t('settings.backup.archiveNotice')} />
            {inlineError && <Alert type='error' content={inlineError} />}
            <div className='space-y-8px'>
              <div className='text-13px text-[var(--color-text-2)]'>{t('settings.backup.fileNameLabel')}</div>
              <Input value={fileName} onChange={setFileName} placeholder={t('settings.backup.fileNamePlaceholder')} disabled={loadingSuggestedName} />
            </div>
          </>
        )}

        {(isRunning || isSuccess) && (
          <div className='space-y-16px'>
            {isSuccess ? (
              <div className='rounded-16px border border-solid border-[var(--color-success-light-3)] bg-[var(--color-success-light-1)] px-16px py-20px text-center'>
                <div className='mx-auto mb-12px flex h-56px w-56px items-center justify-center rounded-full bg-[var(--color-success-light-2)]'>
                  <CheckOne theme='filled' size='28' fill='var(--color-success-6)' />
                </div>
                <div className='text-18px font-600 text-[var(--color-text-1)]'>{t('settings.backup.successTitle')}</div>
                <div className='mt-6px text-13px text-[var(--color-text-3)]'>{t('settings.backup.successDescription')}</div>
                <div className='mt-16px grid grid-cols-[120px_1fr] gap-y-8px text-left text-13px'>
                  <div className='text-[var(--color-text-3)]'>{t('settings.backup.fileNameLabel')}</div>
                  <div className='break-all text-[var(--color-text-1)]'>{activeEvent?.fileName || fileName}</div>
                  <div className='text-[var(--color-text-3)]'>{t('settings.backup.successProvider')}</div>
                  <div className='text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? t('settings.backup.nutstore') : t('settings.backup.webdav')}</div>
                  <div className='text-[var(--color-text-3)]'>{t('settings.backup.remotePath')}</div>
                  <div className='text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? settings.nutstore.remotePath : settings.webdav.remotePath}</div>
                  <div className='text-[var(--color-text-3)]'>{t('settings.backup.includeDefaultWorkspaceFiles')}</div>
                  <div className='text-[var(--color-text-1)]'>{settings.includeDefaultWorkspaceFiles ? t('settings.backup.included') : t('settings.backup.notIncluded')}</div>
                  <div className='text-[var(--color-text-3)]'>{t('settings.backup.successSize')}</div>
                  <div className='text-[var(--color-text-1)]'>{formatFileSize(activeEvent?.fileSize)}</div>
                  <div className='text-[var(--color-text-3)]'>{t('settings.backup.successTime')}</div>
                  <div className='text-[var(--color-text-1)]'>{activeEvent ? formatter.format(new Date(activeEvent.timestamp)) : '--'}</div>
                </div>
              </div>
            ) : (
              <>
                <Alert type='info' content={t('settings.backup.runningNotice')} />
                <div className='space-y-8px'>
                  <div className='text-13px text-[var(--color-text-2)]'>{t('settings.backup.fileNameLabel')}</div>
                  <Input value={fileName} readOnly />
                </div>
                <AionSteps direction='vertical' current={currentStep}>
                  <AionSteps.Step title={t('settings.backup.phase.connecting')} />
                  <AionSteps.Step title={t('settings.backup.phase.snapshotting')} />
                  <AionSteps.Step title={t('settings.backup.phase.collecting')} />
                  <AionSteps.Step title={t('settings.backup.phase.packaging')} />
                  <AionSteps.Step title={t('settings.backup.phase.uploading')} />
                  <AionSteps.Step title={t('settings.backup.phase.success')} />
                </AionSteps>
                <div className='rounded-12px bg-[var(--fill-1)] px-12px py-10px text-13px text-[var(--color-text-2)]'>
                  {t('settings.backup.taskProgress', {
                    defaultValue: '{{task}}: {{phase}}',
                    task: t('settings.backup.taskLabel.backup'),
                    phase: activeEvent ? t(`settings.backup.phase.${activeEvent.phase}` as never) : t('settings.backup.phase.connecting'),
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CloudBackupRemarkModal;
