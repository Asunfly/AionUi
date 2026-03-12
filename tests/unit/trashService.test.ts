/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const trashMocks = vi.hoisted(() => ({
  trashItem: vi.fn(),
  mkdir: vi.fn(),
  lstat: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
  copyFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: {
    trashItem: trashMocks.trashItem,
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: trashMocks.mkdir,
    lstat: trashMocks.lstat,
    cp: trashMocks.cp,
    rm: trashMocks.rm,
    copyFile: trashMocks.copyFile,
    unlink: trashMocks.unlink,
  },
}));

vi.mock('@/process/initStorage', () => ({
  getSystemDir: () => ({
    cacheDir: '/tmp/aionui-cache',
  }),
}));

describe('movePathToTrash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the system trash when available', async () => {
    trashMocks.trashItem.mockResolvedValue(undefined);
    const { movePathToTrash } = await import('../../src/process/services/system/TrashService');

    await movePathToTrash('/tmp/aionui-work/demo.txt');

    expect(trashMocks.trashItem).toHaveBeenCalledWith('/tmp/aionui-work/demo.txt');
    expect(trashMocks.copyFile).not.toHaveBeenCalled();
  });

  it('falls back to app trash when system trash fails', async () => {
    trashMocks.trashItem.mockRejectedValue(new Error('trash unavailable'));
    trashMocks.lstat.mockResolvedValue({
      isDirectory: () => false,
    });
    const { movePathToTrash } = await import('../../src/process/services/system/TrashService');

    await movePathToTrash('/tmp/aionui-work/demo.txt');

    expect(trashMocks.copyFile).toHaveBeenCalledTimes(1);
    expect(trashMocks.unlink).toHaveBeenCalledWith('/tmp/aionui-work/demo.txt');
  });
});
