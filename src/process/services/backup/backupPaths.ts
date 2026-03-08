/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAssistantsDir, getSkillsDir, getSystemDir } from '@/process/initStorage';
import { getConfigPath, getDataPath } from '@process/utils';
import path from 'path';

export interface IManagedBackupEntry {
  key: string;
  type: 'file' | 'directory';
  sourcePath: string;
  restorePath: string;
  zipPath: string;
}

export function getBackupPathContext() {
  const systemDir = getSystemDir();
  const dataDir = getDataPath();
  const configDir = getConfigPath();
  const cacheDir = systemDir.cacheDir;

  return {
    cacheDir,
    workDir: systemDir.workDir,
    dataDir,
    configDir,
    previewHistoryDir: path.join(cacheDir, 'preview-history'),
    conversationHistoryDir: path.join(cacheDir, 'aionui-chat-history'),
  };
}

export function getManagedBackupEntries(dbSnapshotPath: string): IManagedBackupEntry[] {
  const context = getBackupPathContext();

  return [
    {
      key: 'database',
      type: 'file',
      sourcePath: dbSnapshotPath,
      restorePath: path.join(context.dataDir, 'aionui.db'),
      zipPath: 'payload/db/aionui.db',
    },
    {
      key: 'configFile',
      type: 'file',
      sourcePath: path.join(context.cacheDir, 'aionui-config.txt'),
      restorePath: path.join(context.cacheDir, 'aionui-config.txt'),
      zipPath: 'payload/cache/aionui-config.txt',
    },
    {
      key: 'chatFile',
      type: 'file',
      sourcePath: path.join(context.cacheDir, 'aionui-chat.txt'),
      restorePath: path.join(context.cacheDir, 'aionui-chat.txt'),
      zipPath: 'payload/cache/aionui-chat.txt',
    },
    {
      key: 'chatMessageFile',
      type: 'file',
      sourcePath: path.join(context.cacheDir, 'aionui-chat-message.txt'),
      restorePath: path.join(context.cacheDir, 'aionui-chat-message.txt'),
      zipPath: 'payload/cache/aionui-chat-message.txt',
    },
    {
      key: 'chatHistory',
      type: 'directory',
      sourcePath: context.conversationHistoryDir,
      restorePath: context.conversationHistoryDir,
      zipPath: 'payload/cache/aionui-chat-history',
    },
    {
      key: 'assistants',
      type: 'directory',
      sourcePath: getAssistantsDir(),
      restorePath: getAssistantsDir(),
      zipPath: 'payload/cache/assistants',
    },
    {
      key: 'skills',
      type: 'directory',
      sourcePath: getSkillsDir(),
      restorePath: getSkillsDir(),
      zipPath: 'payload/cache/skills',
    },
    {
      key: 'previewHistory',
      type: 'directory',
      sourcePath: context.previewHistoryDir,
      restorePath: context.previewHistoryDir,
      zipPath: 'payload/cache/preview-history',
    },
  ];
}

export function getCurrentManagedBackupEntries(): IManagedBackupEntry[] {
  const context = getBackupPathContext();
  return getManagedBackupEntries(path.join(context.dataDir, 'aionui.db'));
}
