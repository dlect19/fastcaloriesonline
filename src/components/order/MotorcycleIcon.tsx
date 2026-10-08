/** Motorcycle delivery-rider glyph (lucide only ships a bicycle). Inherits currentColor. */
export function MotorcycleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="17" r="3" /><circle cx="19" cy="17" r="3" />
      <path d="M5 17l4-5h5l5 5M9 12l-1-3H6M14 12l2-4h3M11 11l1-4 3 2" />
      <circle cx="12" cy="4" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
