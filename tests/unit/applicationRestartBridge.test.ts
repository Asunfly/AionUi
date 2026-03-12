/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

const restartBridgeMocks = vi.hoisted(() => {
  let restartHandler: ((options?: { clearRuntimeState?: boolean }) => Promise<void>) | null = null;

  return {
    setRestartHandler(handler: (options?: { clearRuntimeState?: boolean }) => Promise<void>) {
      restartHandler = handler;
    },
    resetRestartHandler() {
      restartHandler = null;
    },
    getRestartHandler() {
      return restartHandler;
    },
    relaunch: vi.fn(),
    exit: vi.fn(),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    removeTemp: vi.fn().mockResolvedValue(undefined),
    workerClear: vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      restart: {
        provider: vi.fn((handler: (options?: { clearRuntimeState?: boolean }) => Promise<void>) => restartBridgeMocks.setRestartHandler(handler)),
      },
      openDevTools: { provider: vi.fn() },
      systemInfo: { provider: vi.fn() },
      getPath: { provider: vi.fn() },
      updateSystemInfo: { provider: vi.fn() },
      getZoomFactor: { provider: vi.fn() },
      setZoomFactor: { provider: vi.fn() },
      getCdpStatus: { provider: vi.fn() },
      updateCdpConfig: { provider: vi.fn() },
    },
  },
}));

vi.mock('electron', () => ({
  app: {
    relaunch: restartBridgeMocks.relaunch,
    exit: restartBridgeMocks.exit,
  },
  session: {
    defaultSession: {
      clearStorageData: restartBridgeMocks.clearStorageData,
      clearCache: restartBridgeMocks.clearCache,
    },
  },
}));

vi.mock('@/process/initStorage', () => ({
  getSystemDir: vi.fn(() => ({
    cacheDir: '/mock/cache',
    workDir: '/mock/work',
    platform: 'win32',
    arch: 'x64',
  })),
  ProcessEnv: {
    set: vi.fn(),
  },
}));

vi.mock('@/process/utils', () => ({
  copyDirectoryRecursively: vi.fn(),
  getTempPath: vi.fn(() => '/mock/temp/aionui'),
}));

vi.mock('@/process/WorkerManage', () => ({
  default: {
    clear: restartBridgeMocks.workerClear,
  },
}));

vi.mock('@/process/utils/zoom', () => ({
  getZoomFactor: vi.fn(() => 1),
  setZoomFactor: vi.fn(() => 1),
}));

vi.mock('../../src/utils/configureChromium', () => ({
  getCdpStatus: vi.fn(() => ({ enabled: false, port: null, startupEnabled: false, instances: [], isDevMode: true })),
  updateCdpConfig: vi.fn(() => ({ enabled: false })),
  verifyCdpReady: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    rm: restartBridgeMocks.removeTemp,
  },
}));

describe('applicationBridge restart cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restartBridgeMocks.resetRestartHandler();
  });

  it('clears runtime state before relaunch when requested', async () => {
    const { initApplicationBridge } = await import('../../src/process/bridge/applicationBridge');

    initApplicationBridge();
    const restartHandler = restartBridgeMocks.getRestartHandler();
    expect(restartHandler).not.toBeNull();

    await restartHandler?.({ clearRuntimeState: true });

    expect(restartBridgeMocks.workerClear).toHaveBeenCalledTimes(1);
    expect(restartBridgeMocks.clearStorageData).toHaveBeenCalledWith({
      storages: ['cachestorage', 'serviceworkers', 'shadercache', 'indexdb', 'localstorage', 'filesystem', 'websql'],
    });
    expect(restartBridgeMocks.clearCache).toHaveBeenCalledTimes(1);
    expect(restartBridgeMocks.removeTemp).toHaveBeenCalledWith('/mock/temp/aionui', { recursive: true, force: true });
    expect(restartBridgeMocks.removeTemp).toHaveBeenCalledWith(path.join('/mock/cache', 'temp'), { recursive: true, force: true });
    expect(restartBridgeMocks.relaunch).toHaveBeenCalledTimes(1);
    expect(restartBridgeMocks.exit).toHaveBeenCalledWith(0);
  });
});
