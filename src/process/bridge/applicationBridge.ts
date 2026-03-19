/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { app, session } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { IWorkerTaskManager } from '@process/task/IWorkerTaskManager';
import { ipcBridge } from '../../common';
import { getSystemDir, ProcessEnv } from '../initStorage';
import { copyDirectoryRecursively, getTempPath } from '../utils';
import { getZoomFactor, setZoomFactor } from '../utils/zoom';
import { getCdpStatus, updateCdpConfig } from '../../utils/configureChromium';

let mainWindowRef: BrowserWindow | null = null;

export function setApplicationMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
}

async function clearRuntimeState(workerTaskManager: IWorkerTaskManager): Promise<void> {
  workerTaskManager.clear();

  const defaultSession = session.defaultSession;
  if (defaultSession) {
    await defaultSession.clearStorageData({
      storages: ['cachestorage', 'serviceworkers', 'shadercache', 'indexdb', 'localstorage', 'filesystem', 'websql'],
    });
    await defaultSession.clearCache();
  }

  await fs.rm(getTempPath(), { recursive: true, force: true }).catch((): void => undefined);
  await fs
    .rm(path.join(getSystemDir().cacheDir, 'temp'), { recursive: true, force: true })
    .catch((): void => undefined);
}

export function initApplicationBridge(workerTaskManager: IWorkerTaskManager): void {
  ipcBridge.application.restart.provider(async (options) => {
    if (options?.clearRuntimeState) {
      await clearRuntimeState(workerTaskManager);
    } else {
      workerTaskManager.clear();
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

  ipcBridge.application.isDevToolsOpened.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      return Promise.resolve(mainWindowRef.webContents.isDevToolsOpened());
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.openDevTools.provider(() => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      const win = mainWindowRef;
      const wasOpen = win.webContents.isDevToolsOpened();

      if (wasOpen) {
        win.webContents.closeDevTools();
        return Promise.resolve(false);
      } else {
        return new Promise((resolve) => {
          const onOpened = () => {
            win.webContents.off('devtools-opened', onOpened);
            resolve(true);
          };

          win.webContents.once('devtools-opened', onOpened);
          win.webContents.openDevTools();

          setTimeout(() => {
            win.webContents.off('devtools-opened', onOpened);
            if (win.isDestroyed()) {
              resolve(false);
              return;
            }
            resolve(win.webContents.isDevToolsOpened());
          }, 500);
        });
      }
    }
    return Promise.resolve(false);
  });

  ipcBridge.application.getZoomFactor.provider(() => Promise.resolve(getZoomFactor()));

  ipcBridge.application.setZoomFactor.provider(({ factor }) => {
    return Promise.resolve(setZoomFactor(factor));
  });

  ipcBridge.application.getCdpStatus.provider(async () => {
    try {
      const status = getCdpStatus();
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
