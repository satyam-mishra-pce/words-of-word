import { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'word' | 'red' | 'blue' | 'gold' | 'ink';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'word', className, children, ...props }: BadgeProps) {
  return (
    <span className={cn('ui-badge', `ui-badge-${variant}`, className)} {...props}>
      {children}
    </span>
  );
}
