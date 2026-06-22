import { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export type AlertVariant = 'error' | 'success' | 'notice' | 'warning';

const ICONS: Record<AlertVariant, string> = {
  error: '⚠',
  success: '✓',
  notice: 'ℹ',
  warning: '⚡',
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  showIcon?: boolean;
}

export function Alert({ variant = 'notice', showIcon = true, className, children, ...props }: AlertProps) {
  return (
    <div
      className={cn('ui-alert', `ui-alert-${variant}`, className)}
      role={variant === 'error' ? 'alert' : 'status'}
      {...props}
    >
      {showIcon && <span className="ui-alert-icon" aria-hidden="true">{ICONS[variant]}</span>}
      <span>{children}</span>
    </div>
  );
}
