import { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <div className={cn('ui-tooltip-host', className)}>
      {children}
      <span className="ui-tooltip-box" role="tooltip">{content}</span>
    </div>
  );
}
