import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('h-10 rounded-eh border border-bone/20 bg-canvas/50 px-3 text-sm text-cream placeholder:text-bone/55', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn('min-h-24 rounded-eh border border-bone/20 bg-canvas/50 px-3 py-2 text-sm text-cream placeholder:text-bone/55', className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('h-10 rounded-eh border border-bone/20 bg-canvas/50 px-3 text-sm text-cream', className)} {...props} />;
}
