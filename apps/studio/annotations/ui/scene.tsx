/**
 * @file       annotations/ui/scene.tsx — the annotation elements, in paint order
 * @scope      apps/studio/annotations/ui/scene.tsx
 * @purpose    Portaled into `.dc-world` (whose CSS transform does pan/zoom), one
 *             node per element (element-node.tsx). Selection chrome (halos,
 *             marquee, guides, handles) stays in the `.dc-annot-svg` overlay the
 *             layer renders after this, so it always paints on top.
 *
 *             `data-mdcc-annotations` marks the scene for export capture, which
 *             hides annotations from exported artboards.
 */

import type { Box } from '../types.ts';
import { type EditRequest, ElementNode, PendingTextNode } from './element-node.tsx';
import type { RenderItem } from './render-model.ts';
import { clusterStamps } from './stamps.ts';
import { StampClusters } from './stamps.tsx';

export interface PendingText {
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

export function AnnotationScene({
  items,
  interactive,
  quiet = false,
  editingId,
  edit,
  pending,
  resolveAsset,
  selectedIds,
  me,
  typists,
  foldNotes,
  stampHosts,
}: {
  items: readonly RenderItem[];
  interactive: boolean;
  /** S4.9 — Edit's posture (annotations/ui/posture.ts): faded, readable, click-through. */
  quiet?: boolean;
  /** Element whose text slot is open in the editor. */
  editingId: string | null;
  edit: EditRequest | null;
  /** A text caret not yet backed by an element (born on commit). */
  pending: PendingText | null;
  resolveAsset: (href: string) => string;
  /** S4.12 — the selection (a selected sticky shows its author line). */
  selectedIds?: ReadonlySet<string>;
  /** S4.12 — the signed-in person's name ("You" on their own stickies). */
  me?: string | null;
  /** S4.12 — element id → the colour of the collaborator typing in it. */
  typists?: ReadonlyMap<string, string>;
  /** S4.12 — section id → "6 stickies · 2 people", drawn on a folded section's chip. */
  foldNotes?: ReadonlyMap<string, string>;
  /**
   * S4.13 - the stamps gather into clusters (one per person per kind): this finds where a bound target sits
   * and what to call it ("Směr B"). Absent = stamps sit where they were put, unnamed.
   */
  stampHosts?: {
    box: (target: string) => Box | null;
    label: (target: string | null) => string;
  };
}) {
  const stampEls = items.filter((it) => it.el.type === 'stamp').map((it) => it.el);
  const clusters = stampEls.length ? clusterStamps(stampEls, stampHosts?.box) : [];
  return (
    <div
      className="dc-annot-scene"
      data-mdcc-annotations="1"
      {...(quiet ? { 'data-an-quiet': '1' } : {})}
    >
      {items
        .filter((it) => it.el.type !== 'stamp')
        .map((it) => (
          <ElementNode
            key={it.el.id}
            el={it.el}
            ends={it.ends}
            interactive={interactive}
            quiet={quiet}
            selected={selectedIds?.has(it.el.id) === true}
            mine={isMine(it.el, me)}
            typist={typists?.get(it.el.id) ?? null}
            foldNote={foldNotes?.get(it.el.id)}
            edit={it.el.id === editingId ? edit : null}
            resolveAsset={resolveAsset}
          />
        ))}
      <StampClusters clusters={clusters} labelOf={stampHosts?.label ?? (() => '')} me={me} />
      {pending && edit ? (
        <PendingTextNode
          x={pending.x}
          y={pending.y}
          color={pending.color}
          fontSize={pending.fontSize}
          edit={edit}
        />
      ) : null}
    </div>
  );
}

/** The element's author is the signed-in person (by name — the board stores no account id). */
function isMine(el: RenderItem['el'], me?: string | null): boolean {
  if (!me) return false;
  const a = el.author as { kind?: unknown; name?: unknown } | undefined;
  return a?.kind === 'human' && a.name === me;
}
