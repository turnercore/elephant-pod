import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}

export function IconButton({ label, active, danger, children, className, title, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      data-tooltip={title || label}
      className={cn(
        'eh-tooltip grid h-10 w-10 place-items-center rounded-eh border border-bone/15 bg-surface/70 text-cream transition hover:border-yellow/50 hover:text-yellow active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
        active && 'border-yellow bg-yellow text-canvas hover:text-canvas',
        danger && 'border-coral/40 text-coral hover:text-coral',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
