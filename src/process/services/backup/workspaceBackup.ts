/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';

type TWorkspacePlatform = 'win32' | 'darwin' | 'linux' | string;

export interface IWorkspacePathSource {
  workspace?: string | null;
  customWorkspace?: boolean;
}

export function normalizeManagedWorkspaceRelativePath(value: string): string | null {
  const segments = toPortablePath(value).split('/').filter(Boolean);

  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }

  return segments.join('/');
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function trimTrailingPortableSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/g, '') : value;
}

function usesWindowsPath(rootPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(rootPath) || rootPath.startsWith('\\\\') || rootPath.includes('\\');
}

function normalizeForComparison(value: string, platform: TWorkspacePlatform): string {
  const normalized = trimTrailingPortableSlash(toPortablePath(value));
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function getManagedWorkspaceRelativePath(workspace: string | null | undefined, workDir: string, platform: TWorkspacePlatform = process.platform, customWorkspace?: boolean): string | null {
  if (!workspace || !workDir || customWorkspace === true) {
    return null;
  }

  const workspacePortable = trimTrailingPortableSlash(toPortablePath(workspace));
  const workDirPortable = trimTrailingPortableSlash(toPortablePath(workDir));
  const workspaceComparable = normalizeForComparison(workspacePortable, platform);
  const workDirComparable = normalizeForComparison(workDirPortable, platform);

  if (workspaceComparable === workDirComparable) {
    return null;
  }

  const prefix = `${workDirComparable}/`;
  if (!workspaceComparable.startsWith(prefix)) {
    return null;
  }

  const relativePath = workspacePortable.slice(workDirPortable.length + 1).replace(/^\/+/g, '');
  return relativePath ? normalizeManagedWorkspaceRelativePath(relativePath) : null;
}

export function collectManagedWorkspaceRelativePaths(items: IWorkspacePathSource[], workDir: string, platform: TWorkspacePlatform = process.platform): string[] {
  const relativeRoots = new Set<string>();

  items.forEach((item) => {
    const relativePath = getManagedWorkspaceRelativePath(item.workspace, workDir, platform, item.customWorkspace);
    if (relativePath) {
      relativeRoots.add(relativePath);
    }
  });

  return Array.from(relativeRoots).sort((left, right) => left.localeCompare(right));
}

export function mapManagedWorkspacePath(workspace: string | null | undefined, sourceWorkDir: string, targetWorkDir: string, sourcePlatform: TWorkspacePlatform = process.platform, customWorkspace?: boolean): string | null | undefined {
  if (!workspace) {
    return workspace;
  }

  const relativePath = getManagedWorkspaceRelativePath(workspace, sourceWorkDir, sourcePlatform, customWorkspace);
  if (relativePath === null) {
    return workspace;
  }

  const joiner = usesWindowsPath(targetWorkDir) ? path.win32 : path.posix;
  return joiner.join(targetWorkDir, ...relativePath.split('/'));
}

export function remapConversationExtraPaths<T>(extra: T, sourceWorkDir: string, targetWorkDir: string, sourcePlatform: TWorkspacePlatform = process.platform): { changed: boolean; value: T } {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    return { changed: false, value: extra };
  }

  const record = extra as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...record };

  if (typeof record.workspace === 'string') {
    const mappedWorkspace = mapManagedWorkspacePath(record.workspace, sourceWorkDir, targetWorkDir, sourcePlatform, typeof record.customWorkspace === 'boolean' ? record.customWorkspace : undefined);
    if (mappedWorkspace && mappedWorkspace !== record.workspace) {
      next.workspace = mappedWorkspace;
      changed = true;
    }
  }

  const runtimeValidation = record.runtimeValidation;
  if (runtimeValidation && typeof runtimeValidation === 'object' && !Array.isArray(runtimeValidation)) {
    const runtimeValidationRecord = runtimeValidation as Record<string, unknown>;
    if (typeof runtimeValidationRecord.expectedWorkspace === 'string') {
      const mappedExpectedWorkspace = mapManagedWorkspacePath(runtimeValidationRecord.expectedWorkspace, sourceWorkDir, targetWorkDir, sourcePlatform);
      if (mappedExpectedWorkspace && mappedExpectedWorkspace !== runtimeValidationRecord.expectedWorkspace) {
        next.runtimeValidation = {
          ...runtimeValidationRecord,
          expectedWorkspace: mappedExpectedWorkspace,
        };
        changed = true;
      }
    }
  }

  return {
    changed,
    value: (changed ? next : extra) as T,
  };
}
