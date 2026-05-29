import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useBackNavigation } from '../Layout/BackNavigationContext';
import { IconButton } from './IconButton';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  kicker?: string;
  action?: ReactNode;
}

export function Panel({ title, kicker, action, className, children, ...props }: PropsWithChildren<PanelProps>) {
  const { canGoBack, onBack } = useBackNavigation();
  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden bg-transparent', className)} {...props}>
      {(title || kicker || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-bone/15 px-4 py-4 md:px-5">
          <div className="flex min-w-0 items-start gap-3">
            {canGoBack && onBack ? (
              <IconButton label="Back" onClick={onBack} className="mt-0.5 h-9 w-9 shrink-0" title="Back">
                <ArrowLeft size={18} aria-hidden />
              </IconButton>
            ) : null}
            <div className="min-w-0">
              {kicker && <p className="eh-note mb-1 text-sm text-yellow">{kicker}</p>}
              {title && <h2 className="eh-title break-words text-xl text-cream">{title}</h2>}
            </div>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
