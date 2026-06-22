import { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export interface SeparatorProps extends HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({ orientation = 'horizontal', className, ...props }: SeparatorProps) {
  return (
    <hr
      className={cn('ui-sep', orientation === 'horizontal' ? 'ui-sep-h' : 'ui-sep-v', className)}
      {...props}
    />
  );
}
