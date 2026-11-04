// Ported once from .design/ui/v2/_kit.tsx on 2026-11-04; site/ is the source now.
// A tiny artboard picture drawn from the object colours. Pinned to the light palette so a
// picture of the user's work never re-colours with the site theme (`mdcc-pin-light`).

export type Art = 'home' | 'price' | 'brand' | 'video';

export function Thumb({
  art = 'brand',
  w,
  h,
  className = '',
}: {
  art?: Art;
  w?: number;
  h?: number;
  className?: string;
}) {
  return (
    <span
      className={`k-thumb k-art--${art} mdcc-pin-light k-fixed ${className}`}
      style={w ? { width: w, height: h } : undefined}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
