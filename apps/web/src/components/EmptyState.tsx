import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-56 place-items-center rounded-eh border border-dashed border-bone/20 bg-canvas/25 p-8 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-eh border border-bone/20 bg-surface text-yellow">{icon}</div>
        <h3 className="eh-title text-base text-cream">{title}</h3>
        {children && <div className="mx-auto mt-2 max-w-md text-sm text-bone">{children}</div>}
      </div>
    </div>
  );
}
