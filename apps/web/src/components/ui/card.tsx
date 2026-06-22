import { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

export type CardVariant = 'hero' | 'panel' | 'glass' | 'sm';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  as?: ElementType;
  watermark?: string;
}

export function Card({ variant = 'glass', as: Tag = 'div', watermark, className, children, ...props }: CardProps) {
  return (
    <Tag className={cn('ui-card', `ui-card-${variant}`, className)} {...props}>
      {watermark && (
        <span className="ui-card-watermark" aria-hidden="true">{watermark}</span>
      )}
      {children}
    </Tag>
  );
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('ui-card-header', className)} {...props}>
      {children}
    </div>
  );
}

export function CardContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('ui-card-footer', className)} {...props}>
      {children}
    </div>
  );
}
