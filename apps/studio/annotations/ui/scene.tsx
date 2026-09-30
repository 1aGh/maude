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

import { type EditRequest, ElementNode, PendingTextNode } from './element-node.tsx';
import type { RenderItem } from './render-model.ts';

export interface PendingText {
  x: number;
  y: number;
  color: string;
  fontSize: number;
}

export function AnnotationScene({
  items,
  interactive,
  editingId,
  edit,
  pending,
  resolveAsset,
}: {
  items: readonly RenderItem[];
  interactive: boolean;
  /** Element whose text slot is open in the editor. */
  editingId: string | null;
  edit: EditRequest | null;
  /** A text caret not yet backed by an element (born on commit). */
  pending: PendingText | null;
  resolveAsset: (href: string) => string;
}) {
  return (
    <div className="dc-annot-scene" data-mdcc-annotations="1">
      {items.map((it) => (
        <ElementNode
          key={it.el.id}
          el={it.el}
          ends={it.ends}
          interactive={interactive}
          edit={it.el.id === editingId ? edit : null}
          resolveAsset={resolveAsset}
        />
      ))}
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
