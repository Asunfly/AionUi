/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICloudBackupSettings, IRemoteBackupFile } from '@/common/types/backup';
import { listCloudRemotePackages } from '@/renderer/services/cloudBackup';
import { Button, Empty, Message, Modal, Pagination, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
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
    try {
      const remoteFiles = await listCloudRemotePackages(settings);
      setFiles(remoteFiles);
      setCurrentPage(1);
      setSelectedFileName((current) => (remoteFiles.some((file) => file.fileName === current) ? current : remoteFiles[0]?.fileName || ''));
    } catch (error) {
      setFiles([]);
      setCurrentPage(1);
      setSelectedFileName('');
      Message.error(error instanceof Error ? error.message : t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) {
      return;
    }

    void loadFiles();
  }, [visible, settings]);

  const visibleFiles = files.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Modal
      className='aionui-modal'
      title={t('settings.backup.restoreModalTitle')}
      visible={visible}
      focusLock={false}
      autoFocus={false}
      style={{ width: 760, maxWidth: 'calc(100vw - 32px)' }}
      onCancel={onCancel}
      onOk={() => selectedFileName && onConfirm(selectedFileName)}
      okText={t('settings.backup.restore')}
      cancelText={t('common.close')}
      okButtonProps={{ disabled: !selectedFileName, loading: confirmLoading }}
      footer={(cancelButton, okButton) => (
        <div className='flex flex-col gap-12px border-t border-solid border-[var(--color-border-2)] pt-14px md:flex-row md:items-center md:justify-between'>
          <div className='text-12px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.restoreHint')}</div>
          <div className='flex items-center justify-end gap-8px'>
            {cancelButton}
            {okButton}
          </div>
        </div>
      )}
    >
      <div className='flex h-[560px] max-h-[calc(100vh-180px)] flex-col gap-14px'>
        <div className='rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] px-14px py-14px'>
          <div className='flex flex-wrap items-center justify-between gap-12px'>
            <div>
              <div className='text-14px font-600 text-[var(--color-text-1)]'>{t('settings.backup.restoreSourceTitle')}</div>
              <div className='mt-4px text-12px leading-5 text-[var(--color-text-3)]'>{t('settings.backup.restoreSourceDescription')}</div>
            </div>
            <Button type='text' icon={<Refresh theme='outline' size='16' />} loading={loading} onClick={() => void loadFiles()}>
              {t('common.refresh')}
            </Button>
          </div>

          <div className='mt-12px grid gap-10px md:grid-cols-2'>
            <div className='rounded-12px bg-[var(--fill-0)] px-12px py-10px'>
              <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.successProvider')}</div>
              <div className='mt-4px text-13px font-600 text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? t('settings.backup.nutstore') : t('settings.backup.webdav')}</div>
            </div>
            <div className='rounded-12px bg-[var(--fill-0)] px-12px py-10px'>
              <div className='text-12px text-[var(--color-text-3)]'>{t('settings.backup.remotePath')}</div>
              <div className='mt-4px break-all text-13px font-600 text-[var(--color-text-1)]'>{settings.activeProvider === 'nutstore' ? settings.nutstore.remotePath : settings.webdav.remotePath}</div>
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between gap-12px'>
          <div className='text-13px text-[var(--color-text-3)]'>{files.length > 0 ? t('settings.backup.restoreFileCount', { count: files.length }) : t('settings.backup.emptyRemoteList')}</div>
        </div>

        <div className='min-h-0 flex-1'>
          <Spin loading={loading} className='flex h-full w-full'>
            {files.length === 0 ? (
              <div className='flex h-full flex-col justify-center rounded-16px border border-dashed border-[var(--color-border-2)] bg-[var(--fill-1)] py-32px'>
                <Empty description={t('settings.backup.emptyRemoteList')} />
                <div className='mt-10px text-center text-12px text-[var(--color-text-3)]'>{t('settings.backup.emptyRemoteListHint')}</div>
              </div>
            ) : (
              <div className='flex h-full flex-col rounded-16px border border-solid border-[var(--color-border-2)] bg-[var(--fill-1)] p-12px'>
                <div className='min-h-0 flex-1'>
                  <div className='h-full space-y-10px overflow-y-auto pr-6px'>
                    {visibleFiles.map((file, index) => {
                      const selected = selectedFileName === file.fileName;
                      const absoluteIndex = (currentPage - 1) * pageSize + index;
                      const isLatest = absoluteIndex === 0;
                      return (
                        <button key={file.fileName} type='button' className={`w-full rounded-16px border border-solid p-14px text-left transition-all ${selected ? 'border-[var(--color-primary-light-4)] bg-[var(--color-primary-light-1)] shadow-[0_6px_18px_rgba(64,128,255,0.12)]' : 'border-[var(--color-border-2)] bg-[var(--fill-0)] hover:border-[var(--color-primary-light-4)] hover:bg-[var(--fill-2)]'}`} onClick={() => setSelectedFileName(file.fileName)}>
                          <div className='flex items-start justify-between gap-12px'>
                            <div className='min-w-0 flex-1'>
                              <div className='flex flex-wrap items-center gap-8px'>
                                <div className='truncate text-14px font-600 text-[var(--color-text-1)]'>{file.fileName}</div>
                                {isLatest && <span className='rounded-full bg-[var(--color-success-light-1)] px-8px py-2px text-11px font-600 text-[var(--color-success-6)]'>{t('settings.backup.latestBackup')}</span>}
                              </div>
                              <div className='mt-10px flex flex-wrap gap-8px text-12px text-[var(--color-text-3)]'>
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

                <div className='mt-12px flex justify-end'>
                  <Pagination current={currentPage} pageSize={pageSize} total={files.length} size='small' hideOnSinglePage sizeCanChange={false} onChange={(pageNumber) => setCurrentPage(pageNumber)} />
                </div>
              </div>
            )}
          </Spin>
        </div>
      </div>
    </Modal>
  );
};

export default CloudBackupRestoreModal;
