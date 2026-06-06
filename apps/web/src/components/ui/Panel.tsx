import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { LuArrowLeft as ArrowLeft } from 'react-icons/lu';
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
    <section className={cn('scrollbar-soft min-h-0 max-w-full overflow-y-auto overflow-x-hidden bg-transparent', className)} {...props}>
      <div className="flex min-h-full min-w-0 max-w-full flex-col overflow-x-hidden">
        {(title || kicker || action) && (
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-bone/15 px-3 py-1.5 md:px-4">
            <div className="flex min-w-0 items-center gap-2">
              {canGoBack && onBack ? (
                <IconButton label="Back" onClick={onBack} className="h-8 w-8 shrink-0" title="Back">
                  <ArrowLeft size={17} aria-hidden />
                </IconButton>
              ) : null}
              <div className="min-w-0">
                {kicker && <p className="eh-note text-xs leading-4 text-yellow">{kicker}</p>}
                {title && <h2 className="eh-title flex min-h-8 items-center break-words text-lg leading-none text-cream md:text-xl">{title}</h2>}
              </div>
            </div>
            {action}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
