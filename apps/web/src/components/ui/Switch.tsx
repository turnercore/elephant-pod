import { cn } from '@/lib/cn';

interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
}

export function Switch({ label, checked, onCheckedChange, description }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-eh border border-bone/15 bg-canvas/30 p-3">
      <span>
        <span className="block text-sm font-bold text-cream">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-bone">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onCheckedChange(!checked)}
        className={cn('relative h-7 w-12 rounded-[6px] border border-bone/25 bg-canvas transition', checked && 'border-yellow bg-yellow/25')}
      >
        <span className={cn('absolute left-1 top-1 h-5 w-5 rounded-[4px] bg-bone transition', checked && 'translate-x-5 bg-yellow')} />
      </button>
    </label>
  );
}
