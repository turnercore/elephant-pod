export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) return null;

  return (
    <div className="hidden min-w-0 px-1 pt-2 md:block" aria-label="Elephant Pod">
      <div className="eh-brand text-xl leading-none text-cream">Elephant Pod</div>
      <div className="eh-note text-sm leading-none text-yellow">Keep Listening</div>
    </div>
  );
}
