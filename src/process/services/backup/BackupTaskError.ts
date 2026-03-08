/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TBackupErrorCode } from '@/common/types/backup';

export class BackupTaskError extends Error {
  constructor(
    public readonly code: TBackupErrorCode,
    message?: string
  ) {
    super(message || code);
    this.name = 'BackupTaskError';
  }
}

export function getBackupErrorCode(error: unknown): TBackupErrorCode {
  if (error instanceof BackupTaskError) {
    return error.code;
  }

  return 'unknown';
}

export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof BackupTaskError) {
    return error.code === 'backup_canceled';
  }

  const name = (error as { name?: string } | undefined)?.name;
  const message = (error as { message?: string } | undefined)?.message;
  return name === 'AbortError' || Boolean(message && /abort|cancell?ed/i.test(message));
}
