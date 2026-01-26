/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { shell } from 'electron';
import { ipcBridge } from '../../common';
import { shouldOpenExternal } from '@/utils/runtime';

export function initShellBridge(): void {
  ipcBridge.shell.openFile.provider(async (path) => {
    await shell.openPath(path);
  });

  ipcBridge.shell.showItemInFolder.provider((path) => {
    shell.showItemInFolder(path);
    return Promise.resolve();
  });

  ipcBridge.shell.openExternal.provider((url) => {
    if (!shouldOpenExternal()) {
      console.warn('[shellBridge] External link opening is disabled in this runtime.');
      return Promise.resolve();
    }
    return shell.openExternal(url);
  });
}
