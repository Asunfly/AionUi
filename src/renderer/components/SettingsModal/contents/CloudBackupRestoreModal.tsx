/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICloudBackupSettings, IRemoteBackupFile } from '@/common/types/backup';
import { formatCloudBackupErrorMessage, listCloudRemotePackages } from '@/renderer/services/cloudBackup';
import { Button, Empty, Message, Modal, Pagination, Spin } from '@arco-design/web-react';
import { Attention, Loading, Refresh } from '@icon-park/react';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CloudBackupRestoreModalProps {
  visible: boolean;
  settings: ICloudBackupSettings;
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (fileName: string) => void;
}

function formatFileSize(size: number): string {
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

const CloudBackupRestoreModal: React.FC<CloudBackupRestoreModalProps> = ({ visible, settings, confirmLoading = false, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const pageSize = 20;
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<IRemoteBackupFile[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const previousVisibleRef = useRef(false);

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    []
  );

  const loadFiles = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const remoteFiles = await listCloudRemotePackages(settings);
      setFiles(remoteFiles);
      setCurrentPage(1);
      setSelectedFileName((current) => (remoteFiles.some((file) => file.fileName === current) ? current : remoteFiles[0]?.fileName || ''));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      setFiles([]);
      setCurrentPage(1);
      setSelectedFileName('');
      setLoadError(errorMessage);
      Message.error(formatCloudBackupErrorMessage(undefined, errorMessage));
    } finally {
      setHasLoadedOnce(true);
      setLoading(false);
    }
  };

  useLayoutEffect(() => {
    if (!visible) {
      setHasLoadedOnce(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    void loadFiles();
  }, [visible, settings]);

  useEffect(() => {
    previousVisibleRef.current = visible;
  }, [visible]);

  const visibleFiles = files.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const providerLabel = settings.activeProvider === 'nutstore' ? t('settings.backup.nutstore') : t('settings.backup.webdav');
  const remotePath = settings.activeProvider === 'nutstore' ? settings.nutstore.remotePath : settings.webdav.remotePath;
  const openingNow = visible && !previousVisibleRef.current;
  const effectiveLoading = loading || openingNow || !hasLoadedOnce;

  return (
    <Modal className='aionui-modal' title={t('settings.backup.restoreModalTitle')} visible={visible} focusLock={false} autoFocus={false} style={{ width: 760, maxWidth: 'calc(100vw - 32px)' }} onCancel={onCancel} onOk={() => selectedFileName && onConfirm(selectedFileName)} okText={t('settings.backup.restore')} cancelText={t('common.close')} okButtonProps={{ disabled: !selectedFileName, loading: confirmLoading }} footer={null}>
      <div className='flex h-[680px] max-h-[calc(100vh-120px)] flex-col gap-12px'>
        <div className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-14px py-14px'>
          <div className='flex flex-wrap items-start justify-between gap-12px'>
            <div className='min-w-0 flex-1'>
              <div className='text-14px font-600 text-[var(--color-text-1)]'>{t('settings.backup.restoreSourceTitle')}</div>
              <div className='mt-4px text-12px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.restoreSourceDescription')}</div>
            </div>
            <Button className='backup-restore-refresh-btn' type='outline' size='small' icon={<span className='i-icon'>{loading ? <Loading theme='outline' size='14' className='animate-spin' /> : <Refresh theme='outline' size='14' />}</span>} disabled={loading} onClick={() => void loadFiles()}>
              {t('common.refresh')}
            </Button>
          </div>

          <div className='mt-12px grid gap-10px md:grid-cols-2'>
            <div className='rounded-12px bg-[var(--fill-0)] px-12px py-10px'>
              <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.successProvider')}</div>
              <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{providerLabel}</div>
            </div>
            <div className='rounded-12px bg-[var(--fill-0)] px-12px py-10px'>
              <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.remotePath')}</div>
              <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{remotePath}</div>
            </div>
          </div>
        </div>

        {files.length > 0 && !loadError && (
          <div className='flex items-center justify-between gap-12px px-2px'>
            <div className='text-13px text-[var(--color-text-3)]'>{t('settings.backup.restoreFileCount', { count: files.length })}</div>
          </div>
        )}

        <div className='min-h-0 flex-1'>
          <Spin loading={effectiveLoading && files.length > 0} className='backup-restore-spin flex h-full w-full'>
            {effectiveLoading && files.length === 0 ? (
              <div className='flex h-full min-h-0 w-full flex-col overflow-hidden rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)]'>
                <div className='m-12px flex flex-1 flex-col items-center justify-center rounded-16px border border-dashed border-[var(--color-border-2)] bg-[var(--fill-0)] py-32px'>
                  <Loading theme='outline' size='22' className='animate-spin text-[var(--color-primary-6)]' />
                  <div className='mt-12px text-13px text-[var(--color-text-3)]'>{t('common.loading')}</div>
                </div>
              </div>
            ) : loadError ? (
              <div className='flex h-full min-h-0 w-full flex-col overflow-hidden rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)]'>
                <div className='m-12px flex flex-1 items-center justify-center rounded-16px border border-solid border-[var(--color-warning-light-4)] bg-[var(--color-warning-light-1)] px-24px py-32px'>
                  <div className='mx-auto w-full max-w-[460px] text-center'>
                    <span className='inline-flex h-40px w-40px items-center justify-center rounded-full bg-[rgba(255,255,255,0.82)] text-[var(--color-warning-6)]'>
                      <Attention theme='filled' size='18' fill='currentColor' />
                    </span>
                    <div className='mt-12px text-15px font-600 text-[var(--color-text-1)]'>{t('settings.backup.connectionFailed')}</div>
                    <div className='mt-8px text-13px leading-6 text-[var(--color-text-2)]'>{loadError}</div>
                    <div className='mt-6px text-12px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.restoreSourceDescription')}</div>
                  </div>
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className='flex h-full w-full flex-col justify-center rounded-16px border border-dashed border-[var(--color-border-2)] bg-[var(--fill-1)] py-32px'>
                <Empty description={t('settings.backup.emptyRemoteList')} />
                <div className='mt-10px text-center text-12px text-[var(--color-text-3)]'>{t('settings.backup.emptyRemoteListHint')}</div>
              </div>
            ) : (
              <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)]'>
                <div className='min-h-0 flex-1 px-12px pb-8px pt-12px'>
                  <div className='h-full space-y-10px overflow-y-auto pr-4px'>
                    {visibleFiles.map((file, index) => {
                      const selected = selectedFileName === file.fileName;
                      const absoluteIndex = (currentPage - 1) * pageSize + index;
                      const isLatest = absoluteIndex === 0;
                      return (
                        <button key={file.fileName} type='button' className={`w-full rounded-16px border border-solid p-12px text-left transition-all ${selected ? 'border-[var(--color-primary-light-4)] bg-[var(--color-primary-light-1)] shadow-[0_6px_18px_rgba(64,128,255,0.12)]' : 'border-[var(--color-border-2)] bg-[var(--fill-0)] hover:border-[var(--color-primary-light-4)] hover:bg-[var(--fill-2)]'}`} onClick={() => setSelectedFileName(file.fileName)}>
                          <div className='flex items-start justify-between gap-12px'>
                            <div className='min-w-0 flex-1'>
                              <div className='flex flex-wrap items-center gap-8px'>
                                <div className='truncate text-14px font-600 text-[var(--color-text-1)]'>{file.fileName}</div>
                                {isLatest && <span className='rounded-full bg-[var(--color-success-light-1)] px-8px py-2px text-11px font-600 text-[var(--color-success-6)]'>{t('settings.backup.latestBackup')}</span>}
                              </div>
                              <div className='mt-8px flex flex-wrap gap-8px text-12px text-[var(--color-text-3)]'>
                                <span className='rounded-full bg-[var(--fill-1)] px-8px py-2px'>{formatter.format(new Date(file.modifiedTime))}</span>
                                <span className='rounded-full bg-[var(--fill-1)] px-8px py-2px'>{formatFileSize(file.size)}</span>
                              </div>
                            </div>
                            <span className={`mt-2px inline-flex h-10px w-10px rounded-full transition-colors ${selected ? 'bg-[var(--color-primary-6)]' : 'bg-[var(--color-fill-3)]'}`} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {files.length > pageSize && (
                  <div className='mx-14px flex items-center justify-end border-t border-solid border-[var(--color-border-2)] py-12px'>
                    <Pagination current={currentPage} pageSize={pageSize} total={files.length} size='small' hideOnSinglePage sizeCanChange={false} onChange={(pageNumber) => setCurrentPage(pageNumber)} />
                  </div>
                )}
              </div>
            )}
          </Spin>
        </div>

        <div className='flex flex-col gap-10px px-2px pt-2px md:flex-row md:items-center md:justify-between'>
          <div className='max-w-[460px] text-12px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.restoreHint')}</div>
          <div className='flex items-center justify-end gap-8px'>
            <Button onClick={onCancel}>{t('common.close')}</Button>
            <Button type='primary' disabled={!selectedFileName} loading={confirmLoading} onClick={() => selectedFileName && onConfirm(selectedFileName)}>
              {t('settings.backup.restore')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CloudBackupRestoreModal;
