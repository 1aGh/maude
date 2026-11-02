// client/v2/empty/skeleton.jsx — S11.1: "arriving is not empty" (05 · es-arriving).
//
// On a Mac that is still pulling a project, names and sizes are known before the content: the panel lists
// every canvas by NAME (dimmed, quietly pulsing) and the canvas shows each artboard's SHAPE — never nameless
// bars, never an "empty project". The pulse is an opacity loop on `--dur-panel`; reduced motion stops it.

/**
 * One canvas (or folder) that is on its way. The name is always there.
 * @param {{ name: string, depth?: number, folder?: boolean, count?: number,
 *   meta?: import('react').ReactNode }} props
 */
export function ArrivingRow({ name, depth = 0, folder = false, count, meta }) {
  return (
    <span
      className={`es-arr es-arr-row${folder ? ' es-arr-row--folder' : ''}`}
      style={{ paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))` }}
      data-testid="arriving-row"
    >
      <i
        className={`es-sk ${folder ? 'es-sk--folder' : 'es-sk--thumb'} es-pulse`}
        aria-hidden="true"
      />
      <span className="es-arr-name">{name}</span>
      {count !== undefined ? <span className="es-arr-count">{count}</span> : null}
      {meta ? <span className="es-arr-meta">{meta}</span> : null}
    </span>
  );
}

/**
 * An artboard whose content has not arrived: its label and its exact rectangle, a page-shaped placeholder.
 * Positioned in world coordinates by the caller's canvas layer.
 * @param {{ label: string, kind?: string, x: number, y: number, w: number, h: number }} props
 */
export function SkeletonArtboard({ label, kind, x, y, w, h }) {
  return (
    <div
      className="es-skab"
      style={{ left: x, top: y, width: w, height: h }}
      data-kind={kind}
      data-testid="skeleton-artboard"
    >
      <span className="es-skab-name">{label}</span>
      <span className="es-skab-page es-pulse" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
