/**
 * @file       annotations/ui/stamps.tsx — the stamp faces, the cluster count and the hover card (S4.13)
 * @scope      apps/studio/annotations/ui/stamps.tsx
 * @purpose    Canvas 15 `an-stamps`: a stamp is a coloured disc with its glyph and, on its corner, the face of
 *             the person who made it. Several on one spot gather into a cluster (two faces, then a number);
 *             hovering it opens the card "5 stamps on Směr B" with one row per stamp. The counting is
 *             `clusterStamps` (stamps.ts): one per person per kind. Rendered in the world layer, screen-constant
 *             (counter-scaled by the live zoom, like the section chip), click-through except for the hover card.
 */

import { type CSSProperties, useState } from 'react';
import { useLiveViewport } from '../../canvas-lib.tsx';
import { colorForName } from '../../use-collab.tsx';
import { stampKindById } from '../stamp-kinds.ts';
import {
  STAMP_BOX,
  type StampCluster,
  type StampFace,
  stampCardRows,
  stampCardTitle,
} from './stamps.ts';

const TONE: Record<string, string> = {
  yellow: 'var(--object-yellow, #fce8a6)',
  coral: 'var(--object-coral, #f7c5c0)',
  sky: 'var(--object-sky, #bfdcf7)',
  green: 'var(--object-green, #c4e8c2)',
};
const INK = 'var(--object-ink, #1f1f1f)';

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** One stamp: the glyph on its paper tone, the maker's face on the corner. */
export function StampFaceView({ face, size }: { face: StampFace; size: number }) {
  const kind = stampKindById(face.kind);
  const avatar = Math.round(size * 0.46);
  return (
    <span
      data-testid="annot-stamp-face"
      data-kind={face.kind}
      title={`${kind?.name ?? face.kind} · ${face.who}`}
      style={{
        position: 'relative',
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: TONE[kind?.tone ?? 'yellow'],
        color: INK,
        boxShadow: '0 0 0 2px var(--bg-2, #fff), 0 1px 3px rgba(0,0,0,.25)',
      }}
    >
      <svg
        width={Math.round(size * 0.56)}
        height={Math.round(size * 0.56)}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={kind?.d ?? ''} transform={kind?.rotate ? 'rotate(180 8 8)' : undefined} />
      </svg>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: -Math.round(size * 0.12),
          bottom: -Math.round(size * 0.12),
          width: avatar,
          height: avatar,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: colorForName(face.who),
          color: '#fff',
          fontSize: Math.max(7, Math.round(avatar * 0.62)),
          fontWeight: 600,
          boxShadow: '0 0 0 1.5px var(--bg-2, #fff)',
        }}
      >
        {initial(face.who)}
      </span>
    </span>
  );
}

function Cluster({
  cluster,
  label,
  me,
  zoom,
}: {
  cluster: StampCluster;
  label: string;
  me?: string | null;
  zoom: number;
}) {
  const [open, setOpen] = useState(false);
  const px = 1 / zoom; // one screen pixel in world units
  const size = 30;
  const wrap: CSSProperties = {
    position: 'absolute',
    left: cluster.x,
    top: cluster.y - (size / 2) * px,
    width: 0,
    height: 0,
    transformOrigin: '0 0',
    transform: `scale(${px})`,
    pointerEvents: 'none',
  };
  return (
    <div
      data-testid="annot-stamp-cluster"
      data-spot={cluster.spot}
      data-count={cluster.count}
      style={wrap}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={stampCardTitle(cluster.count, label)}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          pointerEvents: 'auto',
          cursor: 'default',
          padding: 0,
          border: 0,
          background: 'none',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        {cluster.faces.map((f, i) => (
          <span key={f.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <StampFaceView face={f} size={size} />
          </span>
        ))}
        {cluster.showCount ? (
          <span
            data-testid="annot-stamp-count"
            style={{
              display: 'grid',
              placeItems: 'center',
              minWidth: 26,
              height: 26,
              marginLeft: -6,
              padding: '0 4px',
              borderRadius: 13,
              background: 'var(--fg-0, #1f1f1f)',
              color: 'var(--bg-2, #fff)',
              fontSize: 12,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              boxShadow: '0 0 0 2px var(--bg-2, #fff)',
            }}
          >
            {cluster.count}
          </span>
        ) : null}
      </button>
      {open ? <StampCard cluster={cluster} label={label} me={me} top={size + 6} /> : null}
    </div>
  );
}

/** The hover card: "5 stamps on Směr B", then who stamped what. */
export function StampCard({
  cluster,
  label,
  me,
  top = 36,
}: {
  cluster: StampCluster;
  label: string;
  me?: string | null;
  top?: number;
}) {
  const rows = stampCardRows(cluster, me);
  return (
    <div
      data-testid="annot-stamp-card"
      role="status"
      style={{
        position: 'absolute',
        left: 0,
        top,
        width: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 12,
        borderRadius: 10,
        background: 'var(--bg-2, #fff)',
        color: 'var(--fg-0, #1f1f1f)',
        boxShadow: '0 8px 24px rgba(0,0,0,.22), inset 0 0 0 .5px rgba(0,0,0,.12)',
        fontSize: 13,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <p style={{ margin: '0 0 4px', color: 'var(--fg-1, #555)' }}>
        <b style={{ fontWeight: 600, color: 'var(--fg-0, #1f1f1f)' }}>
          {stampCardTitle(cluster.count, label).replace(/ on .*$/, '')}
        </b>
        {label ? ` on ${label}` : ''}
      </p>
      {rows.map((r) => (
        <span
          key={r.id}
          data-testid="annot-stamp-card-row"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <StampFaceView
            face={{ id: r.id, kind: r.kind, who: r.who === 'You' ? (me ?? 'You') : r.who }}
            size={20}
          />
          <span>{r.who}</span>
          <em
            style={{
              marginLeft: 'auto',
              fontStyle: 'normal',
              fontSize: 11,
              color: 'var(--fg-2, #777)',
            }}
          >
            {r.name}
          </em>
        </span>
      ))}
    </div>
  );
}

/** All the clusters of a scene. `labelOf` names a target ("Směr B"); `me` is the signed-in person's name. */
export function StampClusters({
  clusters,
  labelOf,
  me,
}: {
  clusters: readonly StampCluster[];
  labelOf: (target: string | null) => string;
  me?: string | null;
}) {
  const zoom = useLiveViewport().zoom || 1;
  if (!clusters.length) return null;
  return (
    <>
      {clusters.map((c) => (
        <Cluster key={c.spot} cluster={c} label={labelOf(c.target)} me={me} zoom={zoom} />
      ))}
    </>
  );
}

export { STAMP_BOX };
