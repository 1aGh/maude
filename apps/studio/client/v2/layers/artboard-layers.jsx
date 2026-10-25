// client/v2/layers/artboard-layers.jsx — gate-b-polish3: the Layers tab lists the canvas BY ARTBOARD (08 ·
// ak-mixed-fit, 14 · the Layers tab synced with the canvas).
//
//   Combine-kampan                         21 artboards
//   ▣ Combine campaign 1
//   ▣ Combine campaign 11                  ← the artboard you are in (aria-current)
//       Box · Heading · Text …               its objects, the v1 tree, nested under it
//   ▣ Combine campaign 12
//
// Every artboard is one row with its kind glyph and its label; a click selects it on the canvas (the same
// `select-by-id {artboardId}` the halo restore posts). The tree of the artboard you are in — every v1 capability
// of it: select, ↑/↓, ⌥↑/↓ move, drag, rename, hide, lock — is drawn under that row, unchanged. The kind chips
// above dim rows the same way they dim the canvas (S7.24b); they never hide one. A canvas the index does not know
// yet draws the tree alone, as before.

import { Fragment } from 'react';
import { DigitalIcon, PrintIcon, VideoIcon, WebIcon } from '../canvases/canvas-icons.jsx';
import { isFilterKind } from '../kinds/kind-filter-model.js';
import { boardsOfKind } from '../kinds/layers-kind-model.js';
import { LayersKindFoot } from '../kinds/LayersKindFilter.jsx';
import { useKindFilter } from '../kinds/kind-filter-store.js';

const ICON = { digital: DigitalIcon, web: WebIcon, print: PrintIcon, video: VideoIcon };

/** "1 artboard" / "21 artboards" — CONTRACT §4: counts read for one and for many. */
export const artboardCountWords = (n) => (n === 1 ? '1 artboard' : `${n} artboards`);

/**
 * Which row the tree goes under: the artboard the tree is of, else the selection's, else none.
 * @param {{ boards?: Array<{ id: string }>, treeArtboard?: string|null, selectedArtboard?: string|null }} p
 */
export function currentBoard({ boards = [], treeArtboard = null, selectedArtboard = null }) {
  for (const id of [treeArtboard, selectedArtboard])
    if (id && boards.some((b) => b.id === id)) return id;
  return null;
}

/**
 * @param {{ boards?: Array<{ id: string, label?: string, kind?: string }>, canvasName?: string,
 *   count?: number, current?: string|null, onPick?: (artboardId: string) => void, children?: any }} props
 */
export function ArtboardLayers({
  boards,
  canvasName = '',
  count,
  current = null,
  onPick,
  children,
}) {
  const [filter] = useKindFilter();
  const list = Array.isArray(boards) ? boards : [];
  const n = Number.isFinite(count) && count > 0 ? count : list.length;
  const dimKind = list.length && isFilterKind(filter) && filter !== 'all' ? filter : null;
  // V2-8.5 C8 (08 ak-mixed-fit): while a kind chip is on, the list names only the artboards of that kind (the canvas
  // dims the rest); the tree of an artboard outside the kind waits until the chip goes.
  const shown = boardsOfKind(list, dimKind);
  const placed = current && shown.some((b) => b.id === current);
  const treeHere = !dimKind || placed;
  return (
    <div className="ly2" data-testid="layers-by-artboard">
      <p className="ly2-t">
        <span className="ly2-t-name">{canvasName || 'Layers'}</span>
        {n > 0 ? (
          <span className="ly2-t-count" data-testid="layers-artboard-count">
            {artboardCountWords(n)}
          </span>
        ) : null}
      </p>
      {list.length ? (
        <div className="ly2-list" role="group" aria-label="Artboards">
          {shown.map((b) => {
            const Icon = ICON[b.kind] ?? DigitalIcon;
            const on = b.id === current;
            return (
              <Fragment key={b.id}>
                <button
                  type="button"
                  className="ly2-board"
                  data-testid={`layers-artboard-${b.id}`}
                  data-kind={b.kind || 'digital'}
                  aria-current={on ? 'true' : undefined}
                  title={b.label || b.id}
                  onClick={() => onPick?.(b.id)}
                >
                  <span className="ly2-ic" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="ly2-name">{b.label || b.id}</span>
                </button>
                {on && children ? <div className="ly2-tree">{children}</div> : null}
              </Fragment>
            );
          })}
          {!placed && treeHere && children ? (
            <div className="ly2-tree ly2-tree--loose">{children}</div>
          ) : null}
        </div>
      ) : (
        children
      )}
      <LayersKindFoot boards={list} />
    </div>
  );
}
