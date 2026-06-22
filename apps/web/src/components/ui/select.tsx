import { SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../utils/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref
) {
  return (
    <div className="ui-select-wrap">
      <select ref={ref} className={cn('ui-select', className)} {...props}>
        {children}
      </select>
      <span className="ui-select-arrow" aria-hidden="true">▾</span>
    </div>
  );
});
