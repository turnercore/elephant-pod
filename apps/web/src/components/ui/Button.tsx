import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ className, variant = 'secondary', size = 'md', children, ...props }: PropsWithChildren<ButtonProps>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-eh border font-sans font-black uppercase tracking-[0.06em] transition active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
        variant === 'primary' && 'border-yellow/80 bg-yellow text-canvas hover:bg-yellow/90',
        variant === 'secondary' && 'border-bone/20 bg-surface text-cream hover:border-yellow/50 hover:text-yellow',
        variant === 'ghost' && 'border-transparent bg-transparent text-cream hover:bg-cream/5 hover:text-yellow',
        variant === 'danger' && 'border-coral/50 bg-coral/15 text-coral hover:bg-coral/25',
        size === 'sm' && 'h-8 px-3 text-[11px]',
        size === 'md' && 'h-10 px-4 text-xs',
        size === 'lg' && 'h-12 px-5 text-sm',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
