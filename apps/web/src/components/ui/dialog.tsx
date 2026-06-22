import { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Dialog({ open, onClose, children, className, size = 'md' }: DialogProps) {
  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={cn('ui-dialog', `ui-dialog-${size}`, className)}>
        <button
          className="ui-dialog-close"
          onClick={onClose}
          aria-label="Close dialog"
          type="button"
        >
          ×
        </button>
        <div className="ui-dialog-content">
          {children}
        </div>
      </div>
    </div>
  );
}
