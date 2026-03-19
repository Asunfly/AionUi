/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICreateConversationParams } from '@/common/ipcBridge';
import type { TChatConversation, TProviderWithModel, TWorkspaceSource } from '@/common/storage';
import type { PresetAgentType } from '@/types/acpTypes';
import { uuid } from '@/common/utils';
import fs from 'fs/promises';
import path from 'path';
import { getSkillsDir, getSystemDir } from './initStorage';
import { computeOpenClawIdentityHash } from './utils/openclawUtils';

/**
 * Agent 类型到原生 skills 目录的映射（仅列出有专属目录的 CLI）
 * Mapping from agent type to native skills directory (only agents with dedicated dirs)
 *
 * 每个 agent 只 symlink 到一个目录，避免工作空间出现多余的目录
 * Each agent symlinks to exactly one directory to keep workspace clean
 *
 * Gemini CLI:    .gemini/skills/  (native SkillManager discovery)
 * Claude / CBud: .claude/skills/  (native skill discovery)
 * Others:        .agents/skills/  (generic fallback via DEFAULT_SKILLS_DIRS)
 */
const AGENT_SKILLS_DIRS: Record<string, string[]> = {
  gemini: ['.gemini/skills'],
  claude: ['.claude/skills'],
  codebuddy: ['.claude/skills'],
};

const DEFAULT_SKILLS_DIRS = ['.agents/skills'];

/**
 * 为 assistant 设置原生 workspace 结构（skill symlinks）
 * Set up native workspace structure for assistant (skill symlinks only)
 *
 * 将启用的 skills symlink 到 CLI 原生 skills 目录，让各 CLI 自动发现
 * Symlink enabled skills into CLI-native skills directories for auto-discovery
 *
 * 只在 temp workspace（非用户指定）时执行，避免污染用户项目目录
 * Only runs for temp workspaces (not user-specified) to avoid polluting user project dirs
 *
 * 注意：Rules/人格设定通过 system prompt 注入，不写 context file
 * Note: Rules/personality are injected via system prompt, NOT written to context files
 */
export async function setupAssistantWorkspace(
  workspace: string,
  options: {
    agentType?: PresetAgentType | string;
    backend?: string;
    enabledSkills?: string[];
  }
): Promise<void> {
  if (!options.enabledSkills || options.enabledSkills.length === 0) return;

  const key = options.backend || options.agentType || '';
  const skillsDirs = AGENT_SKILLS_DIRS[key] || DEFAULT_SKILLS_DIRS;
  const userSkillsDir = getSkillsDir();

  for (const skillsRelDir of skillsDirs) {
    const targetSkillsDir = path.join(workspace, skillsRelDir);
    await fs.mkdir(targetSkillsDir, { recursive: true });

    for (const skillName of options.enabledSkills) {
      if (skillName === 'cron') continue;

      const sourceSkillDir = path.join(userSkillsDir, skillName);
      const targetSkillDir = path.join(targetSkillsDir, skillName);

      try {
        await fs.stat(sourceSkillDir);
        try {
          await fs.lstat(targetSkillDir);
        } catch {
          await fs.symlink(sourceSkillDir, targetSkillDir, 'dir');
          console.log(`[setupAssistantWorkspace] Symlinked skill: ${skillName} -> ${targetSkillDir}`);
        }
      } catch {
        console.warn(`[setupAssistantWorkspace] Skill directory not found: ${sourceSkillDir}`);
      }
    }
  }
}

/**
 * 创建工作空间目录（不复制文件）
 * Create workspace directory (without copying files)
 *
 * 注意：文件复制统一由 sendMessage 时的 copyFilesToDirectory 处理
 * 避免文件被复制两次（一次在创建会话时，一次在发送消息时）
 * Note: File copying is handled by copyFilesToDirectory in sendMessage
 * This avoids files being copied twice
 */
const buildWorkspaceWidthFiles = async (
  defaultWorkspaceName: string,
  workspace?: string,
  _defaultFiles?: string[],
  providedCustomWorkspace?: boolean
) => {
  const customWorkspace = providedCustomWorkspace !== undefined ? providedCustomWorkspace : !!workspace;
  let workspaceSource: TWorkspaceSource = 'manual';

  if (!workspace) {
    const tempPath = getSystemDir().workDir;
    workspace = path.join(tempPath, defaultWorkspaceName);
    await fs.mkdir(workspace, { recursive: true });
    workspaceSource = 'temporary';
  } else {
    workspace = path.resolve(workspace);
  }

  return { workspace, customWorkspace, workspaceSource };
};

export const createGeminiAgent = async (
  model: TProviderWithModel,
  workspace?: string,
  defaultFiles?: string[],
  webSearchEngine?: 'google' | 'default',
  customWorkspace?: boolean,
  contextFileName?: string,
  presetRules?: string,
  enabledSkills?: string[],
  presetAssistantId?: string,
  sessionMode?: string,
  isHealthCheck?: boolean
): Promise<TChatConversation> => {
  const {
    workspace: newWorkspace,
    customWorkspace: finalCustomWorkspace,
    workspaceSource,
  } = await buildWorkspaceWidthFiles(`gemini-temp-${Date.now()}`, workspace, defaultFiles, customWorkspace);

  if (!finalCustomWorkspace) {
    await setupAssistantWorkspace(newWorkspace, {
      agentType: 'gemini',
      enabledSkills,
    });
  }

  return {
    type: 'gemini',
    model,
    extra: {
      workspace: newWorkspace,
      customWorkspace: finalCustomWorkspace,
      workspaceSource,
      webSearchEngine,
      contextFileName,
      presetRules,
      contextContent: presetRules,
      enabledSkills,
      presetAssistantId,
      sessionMode,
      isHealthCheck,
    },
    desc: finalCustomWorkspace ? newWorkspace : '',
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: newWorkspace,
    id: uuid(),
  };
};

export const createAcpAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  const { workspace, customWorkspace, workspaceSource } = await buildWorkspaceWidthFiles(
    `${extra.backend}-temp-${Date.now()}`,
    extra.workspace,
    extra.defaultFiles,
    extra.customWorkspace
  );

  if (!customWorkspace) {
    await setupAssistantWorkspace(workspace, {
      backend: extra.backend,
      enabledSkills: extra.enabledSkills,
    });
  }

  return {
    type: 'acp',
    extra: {
      workspace,
      customWorkspace,
      workspaceSource,
      backend: extra.backend,
      cliPath: extra.cliPath,
      agentName: extra.agentName,
      customAgentId: extra.customAgentId,
      presetContext: extra.presetContext,
      enabledSkills: extra.enabledSkills,
      presetAssistantId: extra.presetAssistantId,
      sessionMode: extra.sessionMode,
      currentModelId: extra.currentModelId,
      isHealthCheck: extra.isHealthCheck,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};

/** @deprecated Legacy Codex creation. New Codex conversations use ACP protocol via createAcpAgent. */
export const createCodexAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  const { workspace, customWorkspace, workspaceSource } = await buildWorkspaceWidthFiles(
    `codex-temp-${Date.now()}`,
    extra.workspace,
    extra.defaultFiles,
    extra.customWorkspace
  );

  if (!customWorkspace) {
    await setupAssistantWorkspace(workspace, {
      agentType: 'codex',
      enabledSkills: extra.enabledSkills,
    });
  }

  return {
    type: 'codex',
    extra: {
      workspace,
      customWorkspace,
      workspaceSource,
      cliPath: extra.cliPath,
      sandboxMode: 'workspace-write',
      presetContext: extra.presetContext,
      enabledSkills: extra.enabledSkills,
      presetAssistantId: extra.presetAssistantId,
      sessionMode: extra.sessionMode,
      codexModel: extra.codexModel,
      isHealthCheck: extra.isHealthCheck,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};

export const createNanobotAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  const { workspace, customWorkspace, workspaceSource } = await buildWorkspaceWidthFiles(
    `nanobot-temp-${Date.now()}`,
    extra.workspace,
    extra.defaultFiles,
    extra.customWorkspace
  );

  if (!customWorkspace) {
    await setupAssistantWorkspace(workspace, {
      agentType: 'nanobot',
      enabledSkills: extra.enabledSkills,
    });
  }

  return {
    type: 'nanobot',
    extra: {
      workspace,
      customWorkspace,
      workspaceSource,
      enabledSkills: extra.enabledSkills,
      presetAssistantId: extra.presetAssistantId,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};

export const createOpenClawAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  const { workspace, customWorkspace, workspaceSource } = await buildWorkspaceWidthFiles(
    `openclaw-temp-${Date.now()}`,
    extra.workspace,
    extra.defaultFiles,
    extra.customWorkspace
  );

  if (!customWorkspace) {
    await setupAssistantWorkspace(workspace, {
      enabledSkills: extra.enabledSkills,
    });
  }

  const expectedIdentityHash = await computeOpenClawIdentityHash(workspace);
  return {
    type: 'openclaw-gateway',
    extra: {
      workspace,
      backend: extra.backend,
      agentName: extra.agentName,
      customWorkspace,
      workspaceSource,
      gateway: {
        cliPath: extra.cliPath,
      },
      runtimeValidation: {
        expectedWorkspace: workspace,
        expectedBackend: extra.backend,
        expectedAgentName: extra.agentName,
        expectedCliPath: extra.cliPath,
        expectedIdentityHash,
        switchedAt: extra.runtimeValidation?.switchedAt ?? Date.now(),
      },
      enabledSkills: extra.enabledSkills,
      presetAssistantId: extra.presetAssistantId,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};
