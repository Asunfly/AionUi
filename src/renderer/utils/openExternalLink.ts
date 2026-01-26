/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isElectronDesktop } from './platform';

export const openExternalLink = async (url: string): Promise<void> => {
  if (!url) return;

  if (!isElectronDesktop()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  await ipcBridge.shell.openExternal.invoke(url);
};
