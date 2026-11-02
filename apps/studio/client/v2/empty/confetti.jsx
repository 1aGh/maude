// client/v2/empty/confetti.jsx — S11.1: the sticky-confetti tile (assets/organic/patterns.svg, token fills).
// DS rule: confetti belongs to empty states and celebrations — never behind a canvas you're working on.
// ONE celebration exists: Comments "All done." (es-panels-canvas). Only client/v2/comments/ may import this
// (test/v2-empty-kit.test.tsx holds the line); `Empty` never renders it on its own.

/* x, y, rotation, size, fill — one 320 × 240 tile. */
const TILE = [
  [204.8, 153.6, 24, 8, 'var(--object-coral)'],
  [80, 60, -16, 6, 'var(--object-sky)'],
  [0, 180, 34, 6, 'var(--object-green)'],
  [320, 180, 34, 6, 'var(--object-green)'],
  [160, 0, -10, 4, 'var(--object-lilac)'],
  [160, 240, -10, 4, 'var(--object-lilac)'],
  [240, 80, -28, 4, 'var(--object-yellow)'],
];

/** @param {{ id: string, shift?: [number, number] }} props  `id` must be unique on the page. */
export function Confetti({ id, shift = [0, 0] }) {
  return (
    <svg className="es-confetti" aria-hidden="true" data-testid="empty-confetti">
      <defs>
        <pattern
          id={id}
          width="320"
          height="240"
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(${shift[0]} ${shift[1]})`}
        >
          {TILE.map(([x, y, r, s, fill]) => (
            <rect
              key={`${x}-${y}`}
              x={-s / 2}
              y={-s / 2}
              width={s}
              height={s}
              rx="1"
              fill={fill}
              transform={`translate(${x} ${y}) rotate(${r})`}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
