import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  kicker?: string;
  action?: ReactNode;
}

export function Panel({ title, kicker, action, className, children, ...props }: PropsWithChildren<PanelProps>) {
  return (
    <section className={cn('eh-card flex min-h-0 flex-col', className)} {...props}>
      {(title || kicker || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-bone/15 p-4">
          <div>
            {kicker && <p className="eh-note mb-1 text-sm text-yellow">{kicker}</p>}
            {title && <h2 className="eh-title text-lg text-cream">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
