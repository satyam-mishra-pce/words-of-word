import { ClipboardEvent, InputHTMLAttributes, ReactNode, forwardRef } from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  hasSuccess?: boolean;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasError, hasSuccess, icon, className, onPaste, ...props },
  ref
) {
  const stateClass = hasError ? 'ui-input-error' : hasSuccess ? 'ui-input-success' : undefined;
  function blockPaste(event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    onPaste?.(event);
  }
  if (icon) {
    return (
      <div className="ui-input-wrap">
        <span className="ui-input-icon" aria-hidden="true">{icon}</span>
        <input
          ref={ref}
          className={cn('ui-input', 'ui-input-has-icon', stateClass, className)}
          onPaste={blockPaste}
          {...props}
        />
      </div>
    );
  }
  return (
    <input
      ref={ref}
      className={cn('ui-input', stateClass, className)}
      onPaste={blockPaste}
      {...props}
    />
  );
});
