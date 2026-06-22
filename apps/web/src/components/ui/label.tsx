import { LabelHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function Label({ required, className, children, ...props }: LabelProps) {
  return (
    <label
      className={cn('ui-label', required && 'ui-label-required', className)}
      {...props}
    >
      {children}
    </label>
  );
}
