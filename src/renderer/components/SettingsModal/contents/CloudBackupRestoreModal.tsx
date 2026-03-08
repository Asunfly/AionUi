/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICloudBackupSettings, IRemoteBackupFile } from '@/common/types/backup';
import { listCloudRemotePackages } from '@/renderer/services/cloudBackup';
import { Button, Empty, Message, Modal, Spin } from '@arco-design/web-react';
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
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<IRemoteBackupFile[]>([]);
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
      setSelectedFileName((current) => (remoteFiles.some((file) => file.fileName === current) ? current : remoteFiles[0]?.fileName || ''));
    } catch (error) {
      setFiles([]);
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

  return (
    <Modal title={t('settings.backup.restoreModalTitle')} visible={visible} onCancel={onCancel} onOk={() => selectedFileName && onConfirm(selectedFileName)} okButtonProps={{ disabled: !selectedFileName, loading: confirmLoading }}>
      <div className='min-h-280px'>
        <div className='mb-12px flex justify-end'>
          <Button type='text' onClick={() => void loadFiles()}>
            {t('common.refresh')}
          </Button>
        </div>
        <Spin loading={loading} className='w-full'>
          {files.length === 0 ? (
            <Empty description={t('settings.backup.emptyRemoteList')} />
          ) : (
            <div className='space-y-10px'>
              {files.map((file) => {
                const selected = selectedFileName === file.fileName;
                return (
                  <button key={file.fileName} type='button' className={`w-full text-left p-12px rounded-12px border border-solid transition-colors ${selected ? 'border-[var(--color-primary-light-4)] bg-[var(--color-primary-light-1)]' : 'border-[var(--color-border-2)] bg-[var(--fill-1)]'}`} onClick={() => setSelectedFileName(file.fileName)}>
                    <div className='text-14px font-600 text-[var(--color-text-1)] break-all'>{file.fileName}</div>
                    <div className='mt-6px text-12px text-[var(--color-text-3)]'>
                      {formatter.format(new Date(file.modifiedTime))} | {formatFileSize(file.size)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Spin>
      </div>
    </Modal>
  );
};

export default CloudBackupRestoreModal;
