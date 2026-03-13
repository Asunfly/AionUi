/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBackupTaskEvent, ICloudBackupSettings, TBackupTaskPhase } from '@/common/types/backup';
import AionSteps from '@/renderer/components/base/AionSteps';
import { formatCloudBackupErrorMessage, getSuggestedCloudBackupFileName } from '@/renderer/services/cloudBackup';
import { Alert, Input, Modal, Progress } from '@arco-design/web-react';
import { Attention, CheckOne, Loading } from '@icon-park/react';
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

function formatElapsedTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes <= 0) {
    return `${restSeconds}s`;
  }

  return `${minutes}m ${restSeconds}s`;
}

const BACKUP_STEP_PHASES = ['connecting', 'snapshotting', 'collecting', 'packaging', 'uploading', 'success'] as const;
const SUCCESS_AUTO_CLOSE_MS = 10000;
const BACKUP_PHASE_MIN_DISPLAY_MS = 520;
const BACKUP_EARLY_PHASES = new Set<TBackupTaskPhase>(['preparing', 'connecting', 'snapshotting']);

const BACKUP_PHASE_PROGRESS: Record<string, number> = {
  idle: 0,
  preparing: 6,
  connecting: 18,
  snapshotting: 34,
  collecting: 52,
  packaging: 74,
  uploading: 92,
  success: 100,
  error: 100,
};

const CloudBackupRemarkModal: React.FC<CloudBackupRemarkModalProps> = ({ visible, settings, taskEvent, onClose, onStart, onCancelTask }) => {
  const { t } = useTranslation();
  const [fileName, setFileName] = useState('');
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [loadingSuggestedName, setLoadingSuggestedName] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [displayPhase, setDisplayPhase] = useState<TBackupTaskPhase>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [autoCloseCountdown, setAutoCloseCountdown] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseShownAtRef = useRef<number>(0);

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
  const effectivePhase = activeEvent?.phase || (activeRequestId ? 'preparing' : 'idle');
  const visibleStepPhase = displayPhase === 'preparing' ? 'connecting' : displayPhase;
  const phaseIndex = BACKUP_STEP_PHASES.findIndex((phase) => phase === visibleStepPhase);
  const currentStep = phaseIndex < 0 ? 1 : phaseIndex + 1;
  const currentPhaseLabel = t(`settings.backup.phase.${displayPhase}` as never, { defaultValue: displayPhase });

  useEffect(() => {
    if (!visible) {
      setFileName('');
      setActiveRequestId(null);
      setInlineError(null);
      setLoadingSuggestedName(false);
      setDisplayProgress(0);
      setDisplayPhase('idle');
      setElapsedSeconds(0);
      setAutoCloseCountdown(null);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
      phaseShownAtRef.current = 0;
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
    if (!visible) {
      return;
    }

    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }

    if (displayPhase === effectivePhase) {
      return;
    }

    const commitPhase = () => {
      setDisplayPhase(effectivePhase);
      phaseShownAtRef.current = Date.now();
    };

    if (displayPhase === 'idle' || effectivePhase === 'success' || effectivePhase === 'error') {
      commitPhase();
      return;
    }

    const elapsed = Date.now() - phaseShownAtRef.current;
    const minDisplayMs = BACKUP_EARLY_PHASES.has(displayPhase) ? 760 : BACKUP_PHASE_MIN_DISPLAY_MS;

    if (elapsed >= minDisplayMs) {
      commitPhase();
      return;
    }

    phaseTimerRef.current = setTimeout(commitPhase, minDisplayMs - elapsed);

    return () => {
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
    };
  }, [displayPhase, effectivePhase, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setDisplayProgress(BACKUP_PHASE_PROGRESS[displayPhase] ?? 0);
  }, [displayPhase, visible]);

  useEffect(() => {
    if (!visible || !isRunning) {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      return;
    }

    setElapsedSeconds(0);
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);

    return () => {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
    };
  }, [isRunning, visible]);

  useEffect(() => {
    if (!visible || !isSuccess) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setAutoCloseCountdown(null);
      return;
    }

    setAutoCloseCountdown(Math.floor(SUCCESS_AUTO_CLOSE_MS / 1000));
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, SUCCESS_AUTO_CLOSE_MS);

    countdownIntervalRef.current = setInterval(() => {
      setAutoCloseCountdown((previous) => {
        if (previous === null || previous <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 0;
        }

        return previous - 1;
      });
    }, 1000);

    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isSuccess, onClose, visible]);

  const handleSubmit = () => {
    const requestId = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setInlineError(null);
    setActiveRequestId(requestId);
    setDisplayPhase('preparing');
    setDisplayProgress(BACKUP_PHASE_PROGRESS.preparing);
    phaseShownAtRef.current = Date.now();
    setElapsedSeconds(0);
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
      className: 'backup-cancel-confirm',
      icon: null,
      title: (
        <div className='flex items-center gap-10px'>
          <span className='inline-flex h-28px w-28px items-center justify-center rounded-full bg-[var(--color-warning-light-1)] text-[var(--color-warning-6)]'>
            <Attention theme='filled' size='16' fill='currentColor' />
          </span>
          <span>{t('settings.backup.cancelConfirmTitle')}</span>
        </div>
      ),
      content: (
        <div className='space-y-8px'>
          <div className='text-14px leading-6 text-[var(--color-text-1)]'>{t('settings.backup.cancelConfirmContent')}</div>
          <div className='text-12px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.runningNotice')}</div>
        </div>
      ),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'warning' },
      onOk: async () => {
        await onCancelTask(activeRequestId);
        onClose();
      },
    });
  };

  return (
    <Modal
      className='aionui-modal'
      title={t('settings.backup.remarkModalTitle')}
      visible={visible}
      focusLock={false}
      autoFocus={false}
      maskClosable={!isRunning}
      escToExit={!isRunning}
      onCancel={handleCancel}
      onOk={isSuccess ? onClose : handleSubmit}
      okText={isSuccess ? t('common.close') : t('settings.backup.startBackup')}
      style={{ width: 680, maxWidth: 'calc(100vw - 32px)' }}
      okButtonProps={{
        disabled: !fileName.trim() || loadingSuggestedName || isRunning,
      }}
    >
      <div className='space-y-16px'>
        {!isSuccess && (
          <div className='space-y-8px'>
            <div className='text-13px text-[var(--color-text-2)]'>{t('settings.backup.fileNameLabel')}</div>
            <Input value={fileName} onChange={setFileName} placeholder={t('settings.backup.fileNamePlaceholder')} disabled={loadingSuggestedName || isRunning} spellCheck={false} />
          </div>
        )}

        {!isRunning && !isSuccess && (
          <>
            <Alert type='warning' content={t('settings.backup.archiveNotice')} />
            {inlineError && <Alert type='error' content={inlineError} />}
            <div className='grid gap-10px md:grid-cols-2'>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.successProvider')}</div>
                <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? t('settings.backup.nutstore') : t('settings.backup.webdav')}</div>
              </div>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.remotePath')}</div>
                <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? settings.nutstore.remotePath : settings.webdav.remotePath}</div>
              </div>
            </div>
          </>
        )}

        {isRunning && (
          <div className='space-y-16px'>
            <div className='rounded-16px border border-solid border-[var(--color-primary-light-4)] bg-[var(--color-primary-light-1)] px-16px py-16px'>
              <div className='flex flex-col gap-14px'>
                <div className='flex flex-wrap items-start justify-between gap-12px'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-8px text-[var(--color-primary-6)]'>
                      <Loading theme='outline' size='16' className='animate-spin' />
                      <span className='text-15px font-600 text-[var(--color-text-1)]'>{currentPhaseLabel}</span>
                    </div>
                    <div className='mt-8px text-13px text-[var(--color-text-2)]'>
                      {t('settings.backup.taskProgress', {
                        defaultValue: '{{task}}: {{phase}}',
                        task: t('settings.backup.taskLabel.backup'),
                        phase: currentPhaseLabel,
                      })}
                    </div>
                  </div>
                  <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.elapsedTime', { time: formatElapsedTime(elapsedSeconds) })}</div>
                </div>
                <Progress percent={displayProgress} showText={false} strokeWidth={6} />
              </div>
            </div>

            <AionSteps current={currentStep} size='small' className='overflow-x-auto'>
              <AionSteps.Step title={t('settings.backup.step.connecting')} />
              <AionSteps.Step title={t('settings.backup.step.snapshotting')} />
              <AionSteps.Step title={t('settings.backup.step.collecting')} />
              <AionSteps.Step title={t('settings.backup.step.packaging')} />
              <AionSteps.Step title={t('settings.backup.step.uploading')} />
              <AionSteps.Step title={t('settings.backup.step.success')} />
            </AionSteps>

            <Alert type='info' content={t('settings.backup.runningNotice')} />
          </div>
        )}

        {isSuccess && (
          <div className='space-y-16px'>
            <div className='rounded-16px border border-solid border-[var(--color-success-light-3)] bg-[var(--color-success-light-1)] px-16px py-18px'>
              <div className='flex items-start gap-10px'>
                <CheckOne theme='filled' size='20' fill='var(--color-success-6)' />
                <div className='min-w-0 flex-1'>
                  <div className='text-17px font-600 text-[var(--color-text-1)]'>{t('settings.backup.successTitle')}</div>
                  <div className='mt-6px text-13px text-[var(--color-text-3)]'>
                    {t('settings.backup.successDescription', {
                      count: autoCloseCountdown ?? 0,
                      defaultValue: 'This backup package has been uploaded successfully. Closing in {{count}}s.',
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className='grid gap-10px md:grid-cols-2'>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.fileNameLabel')}</div>
                <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{activeEvent?.fileName || fileName}</div>
              </div>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.successProvider')}</div>
                <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? t('settings.backup.nutstore') : t('settings.backup.webdav')}</div>
              </div>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.remotePath')}</div>
                <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? settings.nutstore.remotePath : settings.webdav.remotePath}</div>
              </div>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.successTime')}</div>
                <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{activeEvent ? formatter.format(new Date(activeEvent.timestamp)) : '--'}</div>
              </div>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.includeDefaultWorkspaceFiles')}</div>
                <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{settings.includeDefaultWorkspaceFiles ? t('settings.backup.included') : t('settings.backup.notIncluded')}</div>
              </div>
              <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
                <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.successSize')}</div>
                <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{formatFileSize(activeEvent?.fileSize)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CloudBackupRemarkModal;
