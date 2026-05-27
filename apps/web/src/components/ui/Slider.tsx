import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface SliderProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  valueLabel: string;
}

export function Slider({ label, valueLabel, className, ...props }: SliderProps) {
  return (
    <label className="grid gap-2 rounded-eh border border-bone/15 bg-canvas/30 p-3">
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-cream">{label}</span>
        <span className="text-xs font-bold text-yellow">{valueLabel}</span>
      </span>
      <input type="range" className={cn('range-track w-full', className)} {...props} />
    </label>
  );
}
