/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
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
    const filePath = path.join('/tmp', 'work', 'demo.txt');
    const workspacePath = path.dirname(filePath);

    fsBridgeMocks.lstat.mockResolvedValue({
      isDirectory: () => false,
    });
    fsBridgeMocks.movePathToTrash.mockResolvedValue(undefined);

    const handler = bridgeHandlers.removeEntry;
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({ path: filePath });

    expect(fsBridgeMocks.movePathToTrash).toHaveBeenCalledWith(filePath);
    expect(fsBridgeMocks.emit).toHaveBeenCalledWith({
      filePath,
      content: '',
      workspace: workspacePath,
      relativePath: 'demo.txt',
      operation: 'delete',
    });
    expect(result).toEqual({ success: true });
  });

  it('moves directories to trash without emitting file delete events', async () => {
    const dirPath = path.join('/tmp', 'work', 'demo-dir');

    fsBridgeMocks.lstat.mockResolvedValue({
      isDirectory: () => true,
    });
    fsBridgeMocks.movePathToTrash.mockResolvedValue(undefined);

    const handler = bridgeHandlers.removeEntry;
    expect(handler).toBeTypeOf('function');

    const result = await handler?.({ path: dirPath });

    expect(fsBridgeMocks.movePathToTrash).toHaveBeenCalledWith(dirPath);
    expect(fsBridgeMocks.emit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});
