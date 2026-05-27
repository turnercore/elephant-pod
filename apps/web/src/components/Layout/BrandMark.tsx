import { Headphones } from 'lucide-react';

export function BrandMark() {
  return (
    <div className="flex items-center gap-3" aria-label="Elephant Ears">
      <div className="grid h-12 w-12 place-items-center rounded-eh border border-yellow/40 bg-yellow text-canvas">
        <Headphones size={26} strokeWidth={2.8} aria-hidden />
      </div>
      <div className="hidden min-w-0 md:block">
        <div className="eh-brand text-xl leading-none text-cream">Elephant Ears</div>
        <div className="eh-note text-sm leading-none text-yellow">Never forget the fun</div>
      </div>
    </div>
  );
}
