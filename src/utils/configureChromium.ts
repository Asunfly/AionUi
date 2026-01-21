/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import { app } from 'electron';

// Configure Chromium command-line flags for WebUI and CLI modes
// 为 WebUI 和 CLI 模式配置 Chromium 命令行参数

const isWebUI = process.argv.some((arg) => arg === '--webui');
const isResetPassword = process.argv.includes('--resetpass');

const disableSandboxByEnv = process.env.AIONUI_DISABLE_SANDBOX === '1' || process.env.AIONUI_DISABLE_SANDBOX === 'true';
const isDocker = fs.existsSync('/.dockerenv');
const shouldDisableSandbox = disableSandboxByEnv || isDocker;

// Only configure flags for WebUI and --resetpass modes
// 仅为 WebUI 和重置密码模式配置参数
if (isWebUI || isResetPassword) {
  // For Linux without DISPLAY, enable headless mode
  // 对于无显示服务器的 Linux，启用 headless 模式
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    app.commandLine.appendSwitch('headless');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // For root user or container environment, disable sandbox to prevent crash
  // 对于 root 用户或容器环境，禁用沙箱以防止崩溃
  if ((typeof process.getuid === 'function' && process.getuid() === 0) || shouldDisableSandbox) {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
  }
}
