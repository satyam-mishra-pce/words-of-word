import { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
}

export function Spinner({ size = 'md', className, ...props }: SpinnerProps) {
  return (
    <div
      className={cn('ui-spinner', `ui-spinner-${size}`, className)}
      role="status"
      aria-label="Loading"
      {...props}
    />
  );
}
