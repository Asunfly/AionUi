/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation, TWorkspaceSource } from '@/common/storage';
import { emitter } from '@/renderer/utils/emitter';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/focus';
import { Message, Modal } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { useConversationTabs } from '../../context/ConversationTabsContext';
import { isConversationPinned } from '../utils/groupingHelpers';

type UseConversationActionsParams = {
  batchMode: boolean;
  conversations: TChatConversation[];
  onSessionClick?: () => void;
  onBatchModeChange?: (value: boolean) => void;
  selectedConversationIds: Set<string>;
  setSelectedConversationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelectedConversation: (conversation: TChatConversation) => void;
  markAsRead: (conversationId: string) => void;
};

export const useConversationActions = ({ batchMode, conversations, onSessionClick, onBatchModeChange, selectedConversationIds, setSelectedConversationIds, toggleSelectedConversation, markAsRead }: UseConversationActionsParams) => {
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameModalName, setRenameModalName] = useState<string>('');
  const [renameModalId, setRenameModalId] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [dropdownVisibleId, setDropdownVisibleId] = useState<string | null>(null);
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openTab, closeAllTabs, activeTab, updateTabName } = useConversationTabs();

  // Close dropdown when entering batch mode
  useEffect(() => {
    if (batchMode) {
      setDropdownVisibleId(null);
    }
  }, [batchMode]);

  const handleConversationClick = useCallback(
    (conversation: TChatConversation) => {
      setDropdownVisibleId(null);
      if (batchMode) {
        toggleSelectedConversation(conversation);
        return;
      }
      blockMobileInputFocus();
      blurActiveElement();

      const customWorkspace = conversation.extra?.customWorkspace;
      const newWorkspace = conversation.extra?.workspace;

      markAsRead(conversation.id);

      if (!customWorkspace) {
        closeAllTabs();
        void navigate(`/conversation/${conversation.id}`);
        if (onSessionClick) {
          onSessionClick();
        }
        return;
      }

      const currentWorkspace = activeTab?.workspace;
      if (!currentWorkspace || currentWorkspace !== newWorkspace) {
        closeAllTabs();
      }

      openTab(conversation);
      void navigate(`/conversation/${conversation.id}`);
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [batchMode, toggleSelectedConversation, markAsRead, closeAllTabs, navigate, onSessionClick, activeTab, openTab]
  );

  const removeConversation = useCallback(
    async (conversationId: string) => {
      const success = await ipcBridge.conversation.remove.invoke({ id: conversationId });
      if (!success) {
        return false;
      }

      emitter.emit('conversation.deleted', conversationId);
      if (id === conversationId) {
        void navigate('/');
      }
      return true;
    },
    [id, navigate]
  );

  const getDeleteWorkspaceMode = useCallback((conversation: TChatConversation): TWorkspaceSource | null => {
    const extra = conversation.extra as
      | {
          workspace?: string;
          customWorkspace?: boolean;
          workspaceSource?: TWorkspaceSource;
        }
      | undefined;
    if (!extra?.workspace) {
      return null;
    }

    if (!extra.customWorkspace) {
      return 'temporary';
    }

    return extra.workspaceSource === 'migrated' ? 'migrated' : 'manual';
  }, []);

  const buildDeleteReminderContent = useCallback(
    (workspaceMode: TWorkspaceSource | null) => {
      if (!workspaceMode) {
        return (
          <div data-testid='conversation-delete-dialog-content' className='text-14px leading-6 text-[var(--color-text-2)]'>
            {t('conversation.history.deleteConfirm')}
          </div>
        );
      }

      const reminderMeta = {
        temporary: {
          label: t('conversation.history.deleteImpactTemporary'),
          detail: t('conversation.history.deleteImpactTemporaryDetail'),
          accentClass: 'bg-[rgba(var(--warning-6),0.12)] text-[rgb(var(--warning-6))] border-[rgba(var(--warning-6),0.18)]',
        },
        migrated: {
          label: t('conversation.history.deleteImpactMigrated'),
          detail: t('conversation.history.deleteImpactMigratedDetail'),
          accentClass: 'bg-[rgba(var(--primary-6),0.10)] text-[rgb(var(--primary-6))] border-[rgba(var(--primary-6),0.18)]',
        },
        manual: {
          label: t('conversation.history.deleteImpactManual'),
          detail: t('conversation.history.deleteImpactManualDetail'),
          accentClass: 'bg-[var(--color-fill-2)] text-[var(--color-text-1)] border-[var(--color-border-2)]',
        },
      }[workspaceMode];

      return (
        <div data-testid='conversation-delete-dialog-content' className='space-y-12px'>
          <div className='text-14px leading-6 text-[var(--color-text-2)]'>{t('conversation.history.deleteConfirm')}</div>
          <div className='rounded-12px bg-[var(--color-fill-1)] p-12px'>
            <div className='text-12px font-500 leading-5 text-[var(--color-text-3)]'>{t('conversation.history.deleteImpactTitle')}</div>
            <div data-testid={`conversation-delete-impact-${workspaceMode}`} className={`mt-8px inline-flex items-center rounded-full border px-8px py-4px text-12px font-600 leading-none ${reminderMeta.accentClass}`}>
              {reminderMeta.label}
            </div>
            <div className='mt-10px text-13px leading-5 text-[var(--color-text-1)]'>{reminderMeta.detail}</div>
          </div>
        </div>
      );
    },
    [t]
  );

  const buildBatchDeleteReminderContent = useCallback(
    (selectedConversations: TChatConversation[]) => {
      const reminderCounts = selectedConversations.reduce(
        (acc, conversation) => {
          const workspaceMode = getDeleteWorkspaceMode(conversation);
          if (workspaceMode) {
            acc[workspaceMode] += 1;
          }
          return acc;
        },
        {
          temporary: 0,
          migrated: 0,
          manual: 0,
        } satisfies Record<TWorkspaceSource, number>
      );

      const reminderItems = (
        [
          {
            key: 'temporary',
            label: t('conversation.history.deleteImpactTemporary'),
            detail: t('conversation.history.deleteImpactTemporaryDetail'),
            accentClass: 'bg-[rgba(var(--warning-6),0.12)] text-[rgb(var(--warning-6))] border-[rgba(var(--warning-6),0.18)]',
          },
          {
            key: 'migrated',
            label: t('conversation.history.deleteImpactMigrated'),
            detail: t('conversation.history.deleteImpactMigratedDetail'),
            accentClass: 'bg-[rgba(var(--primary-6),0.10)] text-[rgb(var(--primary-6))] border-[rgba(var(--primary-6),0.18)]',
          },
          {
            key: 'manual',
            label: t('conversation.history.deleteImpactManual'),
            detail: t('conversation.history.deleteImpactManualDetail'),
            accentClass: 'bg-[var(--color-fill-2)] text-[var(--color-text-1)] border-[var(--color-border-2)]',
          },
        ] as const
      ).filter((item) => reminderCounts[item.key] > 0);

      if (reminderItems.length === 0) {
        return (
          <div data-testid='conversation-batch-delete-dialog-content' className='text-14px leading-6 text-[var(--color-text-2)]'>
            {t('conversation.history.batchDeleteConfirm', { count: selectedConversationIds.size })}
          </div>
        );
      }

      return (
        <div data-testid='conversation-batch-delete-dialog-content' className='space-y-12px'>
          <div className='text-14px leading-6 text-[var(--color-text-2)]'>{t('conversation.history.batchDeleteConfirm', { count: selectedConversationIds.size })}</div>
          <div className='rounded-12px bg-[var(--color-fill-1)] p-12px'>
            <div className='text-12px font-500 leading-5 text-[var(--color-text-3)]'>{t('conversation.history.deleteImpactTitle')}</div>
            <div className='mt-8px space-y-8px'>
              {reminderItems.map((item) => (
                <div key={item.key} data-testid={`conversation-batch-delete-impact-${item.key}`} className='rounded-10px bg-[var(--color-bg-1)] p-10px'>
                  <div className={`inline-flex items-center rounded-full border px-8px py-4px text-12px font-600 leading-none ${item.accentClass}`}>
                    {item.label} · {reminderCounts[item.key]}
                  </div>
                  <div className='mt-8px text-13px leading-5 text-[var(--color-text-1)]'>{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    },
    [getDeleteWorkspaceMode, selectedConversationIds.size, t]
  );

  const handleDeleteClick = useCallback(
    (conversation: TChatConversation) => {
      const workspaceMode = getDeleteWorkspaceMode(conversation);
      Modal.confirm({
        title: t('conversation.history.deleteTitle'),
        content: buildDeleteReminderContent(workspaceMode),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            const success = await removeConversation(conversation.id);
            if (success) {
              emitter.emit('chat.history.refresh');
              Message.success(t('conversation.history.deleteSuccess'));
            } else {
              Message.error(t('conversation.history.deleteFailed'));
            }
          } catch (error) {
            console.error('Failed to remove conversation:', error);
            Message.error(t('conversation.history.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [buildDeleteReminderContent, getDeleteWorkspaceMode, removeConversation, t]
  );

  const handleBatchDelete = useCallback(() => {
    if (selectedConversationIds.size === 0) {
      Message.warning(t('conversation.history.batchNoSelection'));
      return;
    }

    const selectedConversations = conversations.filter((conversation) => selectedConversationIds.has(conversation.id));

    Modal.confirm({
      title: t('conversation.history.batchDelete'),
      content: buildBatchDeleteReminderContent(selectedConversations),
      okText: t('conversation.history.confirmDelete'),
      cancelText: t('conversation.history.cancelDelete'),
      okButtonProps: { status: 'warning' },
      onOk: async () => {
        const selectedIds = Array.from(selectedConversationIds);
        try {
          const results = await Promise.all(selectedIds.map((conversationId) => removeConversation(conversationId)));
          const successCount = results.filter(Boolean).length;
          emitter.emit('chat.history.refresh');
          if (successCount > 0) {
            Message.success(t('conversation.history.batchDeleteSuccess', { count: successCount }));
          } else {
            Message.error(t('conversation.history.deleteFailed'));
          }
        } catch (error) {
          console.error('Failed to batch delete conversations:', error);
          Message.error(t('conversation.history.deleteFailed'));
        } finally {
          setSelectedConversationIds(new Set());
          onBatchModeChange?.(false);
        }
      },
      style: { borderRadius: '12px' },
      alignCenter: true,
      getPopupContainer: () => document.body,
    });
  }, [buildBatchDeleteReminderContent, conversations, onBatchModeChange, removeConversation, selectedConversationIds, t, setSelectedConversationIds]);

  const handleEditStart = useCallback((conversation: TChatConversation) => {
    setRenameModalId(conversation.id);
    setRenameModalName(conversation.name);
    setRenameModalVisible(true);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameModalId || !renameModalName.trim()) return;

    setRenameLoading(true);
    try {
      const success = await ipcBridge.conversation.update.invoke({
        id: renameModalId,
        updates: { name: renameModalName.trim() },
      });

      if (success) {
        updateTabName(renameModalId, renameModalName.trim());
        emitter.emit('chat.history.refresh');
        setRenameModalVisible(false);
        setRenameModalId(null);
        setRenameModalName('');
        Message.success(t('conversation.history.renameSuccess'));
      } else {
        Message.error(t('conversation.history.renameFailed'));
      }
    } catch (error) {
      console.error('Failed to update conversation name:', error);
      Message.error(t('conversation.history.renameFailed'));
    } finally {
      setRenameLoading(false);
    }
  }, [renameModalId, renameModalName, updateTabName, t]);

  const handleRenameCancel = useCallback(() => {
    setRenameModalVisible(false);
    setRenameModalId(null);
    setRenameModalName('');
  }, []);

  const handleTogglePin = useCallback(
    async (conversation: TChatConversation) => {
      const pinned = isConversationPinned(conversation);

      try {
        const success = await ipcBridge.conversation.update.invoke({
          id: conversation.id,
          updates: {
            extra: {
              pinned: !pinned,
              pinnedAt: pinned ? undefined : Date.now(),
            } as Partial<TChatConversation['extra']>,
          } as Partial<TChatConversation>,
          mergeExtra: true,
        });

        if (success) {
          emitter.emit('chat.history.refresh');
        } else {
          Message.error(t('conversation.history.pinFailed'));
        }
      } catch (error) {
        console.error('Failed to toggle pin conversation:', error);
        Message.error(t('conversation.history.pinFailed'));
      }
    },
    [t]
  );

  const handleMenuVisibleChange = useCallback((conversationId: string, visible: boolean) => {
    setDropdownVisibleId(visible ? conversationId : null);
  }, []);

  const handleOpenMenu = useCallback((conversation: TChatConversation) => {
    setDropdownVisibleId(conversation.id);
  }, []);

  return {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
  };
};
