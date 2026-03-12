/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSystemDir } from '@/process/initStorage';
import { shell } from 'electron';
import fs from 'fs/promises';
import path from 'path';

function buildTrashTargetPath(sourcePath: string): string {
  const trashRoot = path.join(getSystemDir().cacheDir, '.trash');
  const parsed = path.parse(sourcePath);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = parsed.ext ? `${parsed.name}-${suffix}${parsed.ext}` : `${parsed.base}-${suffix}`;
  return path.join(trashRoot, fileName);
}

async function movePathToAppTrash(sourcePath: string): Promise<void> {
  const targetPath = buildTrashTargetPath(sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const stats = await fs.lstat(sourcePath);
  if (stats.isDirectory()) {
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
    await fs.rm(sourcePath, { recursive: true, force: true });
    return;
  }

  await fs.copyFile(sourcePath, targetPath);
  await fs.unlink(sourcePath);
}

export async function movePathToTrash(sourcePath: string): Promise<void> {
  if (typeof shell.trashItem === 'function') {
    try {
      await shell.trashItem(sourcePath);
      return;
    } catch (error) {
      console.warn('[TrashService] Failed to move path to system trash, falling back to app trash:', error);
    }
  }

  await movePathToAppTrash(sourcePath);
}
