import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'mini' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', isLoading, fullWidth, className, children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'ui-btn',
        `ui-btn-${variant}`,
        `ui-btn-${size}`,
        fullWidth && 'ui-btn-full',
        isLoading && 'ui-btn-loading',
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <span className="ui-btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});
