/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Down } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';

interface WorkspaceCollapseProps {
  expanded: boolean;
  onToggle: () => void;
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  siderCollapsed?: boolean;
  toggleTestId?: string;
}

const WorkspaceCollapse: React.FC<WorkspaceCollapseProps> = ({ expanded, onToggle, header, children, className, siderCollapsed = false, toggleTestId }) => {
  const showContent = siderCollapsed || expanded;

  return (
    <div className={classNames('workspace-collapse min-w-0', className)}>
      {!siderCollapsed && (
        <div data-testid={toggleTestId} className='flex items-center ml-2px gap-8px h-32px p-4px cursor-pointer hover:bg-hover rd-4px transition-colors min-w-0' onClick={onToggle}>
          <Down size={16} className={classNames('line-height-0 transition-transform duration-200 flex-shrink-0', expanded ? 'rotate-0' : '-rotate-90')} />
          <div className='flex-1 ml-6px min-w-0 overflow-hidden'>{header}</div>
        </div>
      )}

      {showContent && <div className={classNames('workspace-collapse-content min-w-0', { 'ml-8px': !siderCollapsed })}>{children}</div>}
    </div>
  );
};

export default WorkspaceCollapse;
