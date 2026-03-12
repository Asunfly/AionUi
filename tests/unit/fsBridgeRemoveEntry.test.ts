/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeHandlers: Record<string, ((payload: any) => Promise<any>) | undefined> = {};

const fsBridgeMocks = vi.hoisted(() => ({
  lstat: vi.fn(),
  emit: vi.fn(),
  movePathToTrash: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    lstat: fsBridgeMocks.lstat,
  },
}));

vi.mock('@/process/services/system/TrashService', () => ({
  movePathToTrash: fsBridgeMocks.movePathToTrash,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/mock/app'),
  },
}));

vi.mock('@/common', () => {
  const createProvider = (name: string) => ({
    provider: vi.fn((handler: (payload: any) => Promise<any>) => {
      bridgeHandlers[name] = handler;
    }),
  });

  return {
    ipcBridge: {
      fs: new Proxy(
        {},
        {
          get: (_target, prop) => createProvider(String(prop)),
        }
      ),
      fileStream: {
        contentUpdate: {
          emit: fsBridgeMocks.emit,
        },
      },
    },
  };
});

vi.mock('@/process/initStorage', () => ({
  getSystemDir: vi.fn(() => ({
    cacheDir: '/mock/cache',
    workDir: '/mock/work',
  })),
  getAssistantsDir: vi.fn(() => '/mock/assistants'),
}));

vi.mock('@/process/utils', () => ({
  readDirectoryRecursive: vi.fn(),
}));

describe('fsBridge removeEntry', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(bridgeHandlers).forEach((key) => {
      delete bridgeHandlers[key];
    });
    vi.resetModules();
    const { initFsBridge } = await import('@/process/bridge/fsBridge');
    initFsBridge();
  });

  it('moves files to trash and emits a delete stream event', async () => {
    fsBridgeMocks.lstat.mockResolvedValue({
      isDirectory: () => false,
    });
    fsBridgeMocks.movePathToTrash.mockResolvedValue(undefined);

    const handler = bridgeHandlers.removeEntry;
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({ path: '/tmp/work/demo.txt' });

    expect(fsBridgeMocks.movePathToTrash).toHaveBeenCalledWith('/tmp/work/demo.txt');
    expect(fsBridgeMocks.emit).toHaveBeenCalledWith({
      filePath: '/tmp/work/demo.txt',
      content: '',
      workspace: '/tmp/work',
      relativePath: 'demo.txt',
      operation: 'delete',
    });
    expect(result).toEqual({ success: true });
  });

  it('moves directories to trash without emitting file delete events', async () => {
    fsBridgeMocks.lstat.mockResolvedValue({
      isDirectory: () => true,
    });
    fsBridgeMocks.movePathToTrash.mockResolvedValue(undefined);

    const handler = bridgeHandlers.removeEntry;
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({ path: '/tmp/work/demo-dir' });

    expect(fsBridgeMocks.movePathToTrash).toHaveBeenCalledWith('/tmp/work/demo-dir');
    expect(fsBridgeMocks.emit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});
