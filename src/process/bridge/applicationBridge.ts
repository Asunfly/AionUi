/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, session } from 'electron';
import path from 'path';
import { ipcBridge } from '../../common';
import { getSystemDir, ProcessEnv } from '../initStorage';
import { copyDirectoryRecursively, getTempPath } from '../utils';
import WorkerManage from '../WorkerManage';
import { getZoomFactor, setZoomFactor } from '../utils/zoom';
import { getCdpStatus, updateCdpConfig } from '../../utils/configureChromium';
import fs from 'fs/promises';

async function clearRuntimeState(): Promise<void> {
  WorkerManage.clear();

  const defaultSession = session.defaultSession;
  if (defaultSession) {
    await defaultSession.clearStorageData({
      storages: ['cachestorage', 'serviceworkers', 'shadercache', 'indexdb', 'localstorage', 'filesystem', 'websql'],
    });
    await defaultSession.clearCache();
  }

  await fs.rm(getTempPath(), { recursive: true, force: true }).catch((): void => undefined);
  await fs.rm(path.join(getSystemDir().cacheDir, 'temp'), { recursive: true, force: true }).catch((): void => undefined);
}

export function initApplicationBridge(): void {
  ipcBridge.application.restart.provider(async (options) => {
    if (options?.clearRuntimeState) {
      await clearRuntimeState();
    } else {
      WorkerManage.clear();
    }

    app.relaunch();
    app.exit(0);
    return Promise.resolve();
  });

  ipcBridge.application.updateSystemInfo.provider(async ({ cacheDir, workDir }) => {
    try {
      const oldDir = getSystemDir();
      if (oldDir.cacheDir !== cacheDir) {
        await copyDirectoryRecursively(oldDir.cacheDir, cacheDir);
      }
      await ProcessEnv.set('aionui.dir', { cacheDir, workDir });
      return { success: true };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.systemInfo.provider(() => {
    return Promise.resolve(getSystemDir());
  });

  ipcBridge.application.getPath.provider(({ name }) => {
    return Promise.resolve(app.getPath(name));
  });

  ipcBridge.application.openDevTools.provider(() => {
    // This will be handled by the main window when needed
    return Promise.resolve(false);
  });

  ipcBridge.application.getZoomFactor.provider(() => Promise.resolve(getZoomFactor()));

  ipcBridge.application.setZoomFactor.provider(({ factor }) => {
    return Promise.resolve(setZoomFactor(factor));
  });

  // CDP status and configuration
  ipcBridge.application.getCdpStatus.provider(async () => {
    try {
      const status = getCdpStatus();
      // If port is set, CDP is considered enabled (verification is optional)
      return { success: true, data: status };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });

  ipcBridge.application.updateCdpConfig.provider(async (config) => {
    try {
      const updatedConfig = updateCdpConfig(config);
      return { success: true, data: updatedConfig };
    } catch (e) {
      return { success: false, msg: e.message || e.toString() };
    }
  });
}
