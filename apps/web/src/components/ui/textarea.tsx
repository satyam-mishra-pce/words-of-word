import { ClipboardEvent, TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { hasError, className, onPaste, ...props },
  ref
) {
  function blockPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    event.preventDefault();
    onPaste?.(event);
  }

  return (
    <textarea
      ref={ref}
      className={cn('ui-textarea', hasError && 'ui-input-error', className)}
      onPaste={blockPaste}
      {...props}
      data-hj-suppress
    />
  );
});
