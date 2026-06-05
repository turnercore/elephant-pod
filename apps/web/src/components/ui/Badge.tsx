import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/cn';

export function Badge({ children, tone = 'sage', className, title }: PropsWithChildren<{ tone?: 'sage' | 'teal' | 'mauve' | 'coral' | 'yellow'; className?: string; title?: string }>) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-[4px] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]',
        tone === 'sage' && 'border-sage/25 bg-sage/10 text-sage',
        tone === 'teal' && 'border-teal/25 bg-teal/10 text-teal',
        tone === 'mauve' && 'border-mauve/35 bg-mauve/15 text-bone',
        tone === 'coral' && 'border-coral/35 bg-coral/15 text-coral',
        tone === 'yellow' && 'border-yellow/35 bg-yellow/10 text-yellow',
        className
      )}
    >
      {children}
    </span>
  );
}
