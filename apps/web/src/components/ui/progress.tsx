import { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export type ProgressState = 'ok' | 'warn' | 'urgent';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  state?: ProgressState;
}

export function Progress({ value, state = 'ok', className, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('ui-progress', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div
        className={cn('ui-progress-bar', `ui-progress-${state}`)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
