/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backupPathsMocks = vi.hoisted(() => ({
  getSystemDir: vi.fn(() => ({
    cacheDir: '/mock/cache',
    workDir: '/mock/work',
  })),
  getAssistantsDir: vi.fn(() => '/mock/cache/assistants'),
  getSkillsDir: vi.fn(() => '/mock/cache/skills'),
  getDataPath: vi.fn(() => '/mock/data'),
  getConfigPath: vi.fn(() => '/mock/config'),
}));

vi.mock('@/process/initStorage', () => ({
  getSystemDir: backupPathsMocks.getSystemDir,
  getAssistantsDir: backupPathsMocks.getAssistantsDir,
  getSkillsDir: backupPathsMocks.getSkillsDir,
}));

vi.mock('@process/utils', () => ({
  getDataPath: backupPathsMocks.getDataPath,
  getConfigPath: backupPathsMocks.getConfigPath,
}));

describe('backupPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds managed backup entries from the current system paths', async () => {
    const { getManagedBackupEntries } = await import('../../src/process/services/backup/backupPaths');

    const entries = getManagedBackupEntries('/mock/data/aionui.snapshot.db');

    expect(entries.map((entry) => entry.key)).toEqual(['database', 'configFile', 'chatFile', 'chatMessageFile', 'chatHistory', 'assistants', 'skills', 'previewHistory']);
    expect(entries[0]).toMatchObject({
      key: 'database',
      type: 'file',
      sourcePath: '/mock/data/aionui.snapshot.db',
      restorePath: path.join('/mock/data', 'aionui.db'),
      zipPath: 'payload/db/aionui.db',
    });
    expect(entries.find((entry) => entry.key === 'assistants')).toMatchObject({
      restorePath: '/mock/cache/assistants',
      zipPath: 'payload/cache/assistants',
    });
    expect(entries.find((entry) => entry.key === 'skills')).toMatchObject({
      restorePath: '/mock/cache/skills',
      zipPath: 'payload/cache/skills',
    });
  });

  it('filters managed entries by manifest keys', async () => {
    const { filterManagedBackupEntriesByKeys } = await import('../../src/process/services/backup/backupPaths');

    const filteredEntries = filterManagedBackupEntriesByKeys(
      [
        {
          key: 'database',
          type: 'file',
          sourcePath: '/mock/data/aionui.db',
          restorePath: '/mock/data/aionui.db',
          zipPath: 'payload/db/aionui.db',
        },
        {
          key: 'skills',
          type: 'directory',
          sourcePath: '/mock/cache/skills',
          restorePath: '/mock/cache/skills',
          zipPath: 'payload/cache/skills',
        },
      ],
      ['skills']
    );

    expect(filteredEntries).toEqual([
      {
        key: 'skills',
        type: 'directory',
        sourcePath: '/mock/cache/skills',
        restorePath: '/mock/cache/skills',
        zipPath: 'payload/cache/skills',
      },
    ]);
  });
});
