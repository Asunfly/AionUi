/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';

const DOCKER_ENV_HINTS = ['AIONUI_RUNTIME', 'AIONUI_DOCKER', 'DOCKER', 'CONTAINER'];

export const isDockerRuntime = (): boolean => {
  for (const key of DOCKER_ENV_HINTS) {
    const value = process.env[key];
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'docker', 'container'].includes(normalized)) {
      return true;
    }
  }

  try {
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }
  } catch {
    // Ignore fs errors
  }

  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
    return cgroup.includes('docker') || cgroup.includes('containerd') || cgroup.includes('kubepods');
  } catch {
    // Ignore fs errors
  }

  return false;
};

export const shouldOpenExternal = (): boolean => {
  const disabled = process.env.AIONUI_DISABLE_BROWSER || process.env.AIONUI_HEADLESS;
  if (disabled) {
    const normalized = disabled.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return false;
    }
  }

  if (isDockerRuntime()) {
    return false;
  }

  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return false;
  }

  return true;
};
