/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const webDavMocks = vi.hoisted(() => ({
  customRequest: vi.fn(),
  getDirectoryContents: vi.fn(),
  createDirectory: vi.fn(),
  putFileContents: vi.fn(),
  getFileContents: vi.fn(),
  deleteFile: vi.fn(),
  createClient: vi.fn(),
}));

webDavMocks.createClient.mockImplementation(() => ({
  customRequest: webDavMocks.customRequest,
  getDirectoryContents: webDavMocks.getDirectoryContents,
  createDirectory: webDavMocks.createDirectory,
  putFileContents: webDavMocks.putFileContents,
  getFileContents: webDavMocks.getFileContents,
  deleteFile: webDavMocks.deleteFile,
}));

vi.mock('webdav', () => ({
  createClient: webDavMocks.createClient,
}));

import { CloudWebDavClient } from '../../src/process/services/backup/WebDavClient';

describe('CloudWebDavClient', () => {
  const config = {
    provider: 'webdav' as const,
    host: 'https://example.com/dav',
    username: 'demo',
    password: 'secret',
    remotePath: '/AionUibackup',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    webDavMocks.customRequest.mockResolvedValue({ status: 207 });
    webDavMocks.getDirectoryContents.mockResolvedValue([]);
    webDavMocks.createDirectory.mockResolvedValue(undefined);
    webDavMocks.deleteFile.mockResolvedValue(undefined);
  });

  it('checks the WebDAV endpoint with a root PROPFIND request', async () => {
    const client = new CloudWebDavClient(config);

    await expect(client.checkConnection()).resolves.toBe(true);

    expect(webDavMocks.customRequest).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        method: 'PROPFIND',
        headers: expect.objectContaining({
          Depth: '0',
        }),
      })
    );
  });

  it('maps wrong credentials and invalid endpoints to structured backup errors', async () => {
    const client = new CloudWebDavClient(config);
    webDavMocks.customRequest.mockRejectedValueOnce({ status: 401 });

    await expect(client.checkConnection()).rejects.toMatchObject({ code: 'auth_failed' });

    webDavMocks.customRequest.mockRejectedValueOnce({ status: 405 });
    await expect(client.checkConnection()).rejects.toMatchObject({ code: 'invalid_endpoint' });
  });

  it('rejects invalid WebDAV URLs before probing the server', async () => {
    const client = new CloudWebDavClient({
      ...config,
      host: 'ftp://example.com/dav',
    });

    await expect(client.checkConnection()).rejects.toMatchObject({ code: 'invalid_url' });
  });

  it('tolerates 405 responses when the remote folder cannot be created explicitly', async () => {
    const client = new CloudWebDavClient(config);
    webDavMocks.getDirectoryContents.mockRejectedValueOnce({ status: 404 });
    webDavMocks.createDirectory.mockRejectedValueOnce({ status: 405 });

    await expect(client.ensureDirectory()).resolves.toBeUndefined();
  });

  it('ignores 404 when deleting an already-missing remote backup file', async () => {
    const client = new CloudWebDavClient(config);
    webDavMocks.deleteFile.mockRejectedValueOnce({ status: 404 });

    await expect(client.deleteFile('AionUi_v1.zip')).resolves.toBeUndefined();
  });
});
