/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IBackupManifest, IBackupTaskEvent } from '@/common/types/backup';
import AionSteps from '@/renderer/components/base/AionSteps';
import { formatCloudBackupErrorMessage } from '@/renderer/services/cloudBackup';
import { Alert, Button, Modal, Progress } from '@arco-design/web-react';
import { Attention, CheckOne, Loading } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CloudBackupRestoreProgressModalProps {
  visible: boolean;
  fileName: string;
  requestId: string | null;
  taskEvent: IBackupTaskEvent | null;
  restartRequired?: boolean;
  manifest?: IBackupManifest;
  currentPlatform?: string;
  errorMessage?: string | null;
  restarting?: boolean;
  onClose: () => void;
  onRestart: () => Promise<void>;
}

const RESTORE_STEP_PHASES = ['downloading', 'validating', 'restoring', 'success'] as const;
const RESTORE_SUCCESS_RESTART_MS = 10000;

const RESTORE_PHASE_PROGRESS: Record<string, number> = {
  idle: 0,
  preparing: 6,
  downloading: 30,
  validating: 58,
  restoring: 84,
  success: 100,
  error: 100,
};

const CloudBackupRestoreProgressModal: React.FC<CloudBackupRestoreProgressModalProps> = ({ visible, fileName, requestId, taskEvent, restartRequired = false, manifest, currentPlatform, errorMessage, restarting = false, onClose, onRestart }) => {
  const { t } = useTranslation();
  const [displayProgress, setDisplayProgress] = useState(0);
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeEvent = useMemo(() => {
    if (!taskEvent || taskEvent.task !== 'restore' || !requestId) {
      return null;
    }

    return taskEvent.requestId === requestId ? taskEvent : null;
  }, [requestId, taskEvent]);

  const effectivePhase = activeEvent?.phase || (requestId ? 'preparing' : 'idle');
  const currentPhaseLabel = t(`settings.backup.phase.${effectivePhase}` as never, { defaultValue: effectivePhase });
  const phaseIndex = RESTORE_STEP_PHASES.findIndex((phase) => phase === (activeEvent?.phase || 'downloading'));
  const currentStep = phaseIndex < 0 ? 0 : phaseIndex;
  const resolvedError = errorMessage || (activeEvent?.phase === 'error' ? formatCloudBackupErrorMessage(activeEvent.errorCode, activeEvent.message) : null);
  const isError = Boolean(resolvedError);
  const isSuccess = activeEvent?.phase === 'success';
  const restartPending = (isSuccess || restartRequired) && !isError;
  const shouldShowCrossPlatformWarning = Boolean(manifest?.sourcePlatform && currentPlatform && manifest.sourcePlatform !== currentPlatform);

  useEffect(() => {
    if (!visible) {
      setDisplayProgress(0);
      setRestartCountdown(null);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    setDisplayProgress(RESTORE_PHASE_PROGRESS[effectivePhase] ?? 0);
  }, [effectivePhase, visible]);

  useEffect(() => {
    if (!visible || !restartPending) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setRestartCountdown(null);
      return;
    }

    setRestartCountdown(Math.floor(RESTORE_SUCCESS_RESTART_MS / 1000));
    closeTimerRef.current = setTimeout(() => {
      void onRestart();
    }, RESTORE_SUCCESS_RESTART_MS);

    countdownIntervalRef.current = setInterval(() => {
      setRestartCountdown((previous) => {
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
  }, [onRestart, restartPending, visible]);

  const handleRestartNow = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setRestartCountdown(0);
    void onRestart();
  };

  return (
    <Modal className='aionui-modal' title={t('settings.backup.restoreProgressTitle')} visible={visible} focusLock={false} autoFocus={false} maskClosable={isError} closable={isError} escToExit={isError} onCancel={isError ? onClose : undefined} footer={null} style={{ width: 680, maxWidth: 'calc(100vw - 32px)' }}>
      <div className='space-y-16px'>
        <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-12px py-10px'>
          <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.fileNameLabel')}</div>
          <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{fileName}</div>
        </div>

        {!isError && !restartPending && (
          <>
            <div className='rounded-16px border border-solid border-[var(--color-primary-light-4)] bg-[var(--color-primary-light-1)] px-16px py-16px'>
              <div className='flex items-center gap-8px text-[var(--color-primary-6)]'>
                <Loading theme='outline' size='16' className='animate-spin' />
                <span className='text-15px font-600 text-[var(--color-text-1)]'>{currentPhaseLabel}</span>
              </div>
              <div className='mt-8px text-13px text-[var(--color-text-2)]'>
                {t('settings.backup.taskProgress', {
                  defaultValue: '{{task}}: {{phase}}',
                  task: t('settings.backup.taskLabel.restore'),
                  phase: currentPhaseLabel,
                })}
              </div>
              <div className='mt-12px'>
                <Progress percent={displayProgress} showText={false} strokeWidth={6} />
              </div>
            </div>

            <AionSteps current={currentStep} size='small' className='overflow-x-auto'>
              <AionSteps.Step title={t('settings.backup.restoreStep.downloading')} />
              <AionSteps.Step title={t('settings.backup.restoreStep.validating')} />
              <AionSteps.Step title={t('settings.backup.restoreStep.restoring')} />
              <AionSteps.Step title={t('settings.backup.restoreStep.completed')} />
            </AionSteps>
          </>
        )}

        {isError && (
          <>
            <div className='rounded-16px border border-solid border-[var(--color-warning-light-4)] bg-[var(--color-warning-light-1)] px-16px py-16px'>
              <div className='flex items-start gap-10px'>
                <Attention theme='filled' size='18' fill='var(--color-warning-6)' />
                <div className='min-w-0 flex-1'>
                  <div className='text-15px font-600 text-[var(--color-text-1)]'>{t('settings.backup.restoreErrorTitle')}</div>
                  <div className='mt-6px text-13px leading-5 text-[var(--color-text-2)]'>{resolvedError}</div>
                </div>
              </div>
            </div>
            <div className='flex justify-end'>
              <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
          </>
        )}

        {restartPending && (
          <>
            <div className='rounded-16px border border-solid border-[var(--color-success-light-3)] bg-[var(--color-success-light-1)] px-16px py-16px'>
              <div className='flex items-start gap-10px'>
                <CheckOne theme='filled' size='20' fill='var(--color-success-6)' />
                <div className='min-w-0 flex-1'>
                  <div className='text-16px font-600 text-[var(--color-text-1)]'>{t('settings.backup.restoreSuccessTitle')}</div>
                  <div className='mt-6px text-13px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.restoreRestartCountdown', { count: restartCountdown ?? 0 })}</div>
                </div>
              </div>
            </div>

            {shouldShowCrossPlatformWarning && (
              <Alert
                type='warning'
                content={t('settings.backup.crossPlatformRestoreDescription', {
                  sourcePlatform: manifest?.sourcePlatform,
                  currentPlatform,
                })}
              />
            )}

            <div className='flex justify-end'>
              <Button type='primary' loading={restarting} onClick={handleRestartNow}>
                {t('settings.restartNow')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default CloudBackupRestoreProgressModal;
