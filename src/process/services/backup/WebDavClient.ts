/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { INormalizedCloudBackupConfig } from '@/common/utils/backup';
import { BackupTaskError } from '@/process/services/backup/BackupTaskError';
import path from 'path';
import type { FileStat, WebDAVClient } from 'webdav';
import { createClient } from 'webdav';

interface IWebDavError {
  status?: number;
  response?: {
    status?: number;
  };
}

export class CloudWebDavClient {
  private readonly client: WebDAVClient;
  private readonly host: string;
  private readonly remotePath: string;

  constructor(config: INormalizedCloudBackupConfig) {
    this.host = config.host;
    this.remotePath = config.remotePath;
    this.client = createClient(config.host, {
      username: config.username,
      password: config.password,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }

  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    this.validateHost();

    try {
      const response = await this.client.customRequest('/', {
        method: 'PROPFIND',
        headers: {
          Depth: '0',
          'Content-Type': 'application/xml',
        },
        data: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
        signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new BackupTaskError('auth_failed');
      }
      if (response.status === 404 || response.status === 405) {
        throw new BackupTaskError('invalid_endpoint');
      }
      if (response.status < 200 || response.status >= 300) {
        throw new BackupTaskError('network_error', `Unexpected WebDAV response status: ${response.status}`);
      }
    } catch (error) {
      throw this.mapError(error, 'connection');
    }

    return true;
  }

  async ensureDirectory(signal?: AbortSignal): Promise<void> {
    try {
      await this.client.getDirectoryContents(this.remotePath, { signal });
      return;
    } catch (error) {
      if (this.isStatus(error, 401, 403)) {
        throw this.mapError(error, 'connection');
      }
      if (!this.isStatus(error, 404, 405)) {
        throw this.mapError(error, 'operation');
      }
    }

    try {
      await this.client.createDirectory(this.remotePath, { recursive: true, signal });
    } catch (error) {
      if (this.isStatus(error, 401, 403)) {
        throw this.mapError(error, 'connection');
      }
      if (!this.isStatus(error, 405, 409)) {
        throw this.mapError(error, 'remote-path');
      }
    }
  }

  async uploadFile(fileName: string, content: Buffer, signal?: AbortSignal): Promise<void> {
    await this.ensureDirectory(signal);
    const remoteFilePath = path.posix.join(this.remotePath, fileName);
    try {
      await this.client.putFileContents(remoteFilePath, content, {
        overwrite: true,
        contentLength: content.byteLength,
        signal,
      });
    } catch (error) {
      throw this.mapError(error, 'operation');
    }
  }

  async downloadFile(fileName: string, signal?: AbortSignal): Promise<Buffer> {
    const remoteFilePath = path.posix.join(this.remotePath, fileName);
    let content: unknown;
    try {
      content = await this.client.getFileContents(remoteFilePath, { format: 'binary', signal });
    } catch (error) {
      throw this.mapError(error, 'operation');
    }

    if (Buffer.isBuffer(content)) {
      return content;
    }
    if (content instanceof ArrayBuffer) {
      return Buffer.from(content);
    }
    if (content && typeof content === 'object' && 'data' in content) {
      const detailedData = (content as { data: unknown }).data;
      if (Buffer.isBuffer(detailedData)) {
        return detailedData;
      }
      if (detailedData instanceof ArrayBuffer) {
        return Buffer.from(detailedData);
      }
      if (typeof detailedData === 'string') {
        return Buffer.from(detailedData);
      }
    }
    if (typeof content === 'string') {
      return Buffer.from(content);
    }

    throw new BackupTaskError('unknown', 'Unexpected WebDAV download payload.');
  }

  async listFiles(signal?: AbortSignal): Promise<FileStat[]> {
    await this.ensureDirectory(signal);
    try {
      return this.client.getDirectoryContents(this.remotePath, { signal });
    } catch (error) {
      throw this.mapError(error, 'remote-path');
    }
  }

  async deleteFile(fileName: string, signal?: AbortSignal): Promise<void> {
    const remoteFilePath = path.posix.join(this.remotePath, fileName);
    try {
      await this.client.deleteFile(remoteFilePath, { signal });
    } catch (error) {
      if (!this.isStatus(error, 404)) {
        throw this.mapError(error, 'operation');
      }
    }
  }

  private validateHost(): void {
    let parsed: URL;
    try {
      parsed = new URL(this.host);
    } catch {
      throw new BackupTaskError('invalid_url');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BackupTaskError('invalid_url');
    }
  }

  private isStatus(error: unknown, ...statuses: number[]): boolean {
    const status = (error as IWebDavError | undefined)?.status ?? (error as IWebDavError | undefined)?.response?.status;
    return typeof status === 'number' && statuses.includes(status);
  }

  private mapError(error: unknown, context: 'connection' | 'operation' | 'remote-path'): BackupTaskError {
    if (error instanceof BackupTaskError) {
      return error;
    }

    const status = (error as IWebDavError | undefined)?.status ?? (error as IWebDavError | undefined)?.response?.status;
    if (status === 401 || status === 403) {
      return new BackupTaskError('auth_failed');
    }
    if (status === 404 || status === 405) {
      return new BackupTaskError(context === 'connection' ? 'invalid_endpoint' : 'remote_path_error');
    }

    const message = (error as { message?: string } | undefined)?.message ?? String(error);
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|fetch failed|socket hang up/i.test(message)) {
      return new BackupTaskError('network_error');
    }

    return new BackupTaskError('unknown', message);
  }
}
