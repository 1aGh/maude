// client/v2/access/trashed-banner.jsx — S9.21 (10 co-trashed): moved to the trash while you had it open.
//
// Nothing closes under you. Tereza moved Combine-cisla to the trash; your tab stays on it with one banner:
// "Tereza moved Combine-cisla to the trash · 2 min ago" / "You can keep looking. Your unsent changes stay with it."
// and Restore (an editor's — the server refuses anyone without `trash`). The Canvases panel keeps a dim ghost row
// "In the trash · open here" at the canvas's old place (S1-canvas-row-slots §2, source `trash`).
//
// Writes stop at once (decision v2-lead-trashed-while-open-stops-writes): `trashedWhileOpen` is what the shell
// reads to put the tab in Viewing with no toolbar; what this Mac had not sent yet is parked with the trashed
// canvas by V2-1.14 G1 (the kernel answers `dependency-missing`), and Restore brings both back.

import { useEffect, useMemo, useState } from 'react';

import { setGhostRows } from '../canvases/row-slots.js';
import { commentTime } from '../comments/comments-model.js';
import { restoreItem } from '../left-panel/use-trash.js';
import { canvasName, WORDS } from './access-client.js';

/** The shared Trash's canvas item for the open canvas (designRoot-relative `rel`), or null. */
export function trashedWhileOpen(items, rel) {
  if (!rel || !Array.isArray(items)) return null;
  return items.find((i) => i?.kind === 'canvas' && i.path === rel) ?? null;
}

/** Every open tab whose canvas is in the trash → the panel's ghost rows. `open` = designRoot-relative paths. */
export function trashGhosts(items, open, onOpen, activeRel = null) {
  const out = [];
  for (const rel of open || []) {
    const item = trashedWhileOpen(items, rel);
    if (!item) continue;
    out.push({
      path: rel,
      name: canvasName(rel),
      slot: { sub: { text: 'In the trash · open here', icon: 'trash' }, dim: true },
      // the tab you are on is the selected row (10 co-trashed draws it so)
      current: rel === activeRel,
      onOpen: () => onOpen?.(rel),
    });
  }
  return out;
}

/** "Tereza moved Combine-cisla to the trash · 2 min ago" — "You" when this session did it. */
export function trashedTitle(item, now = Date.now()) {
  if (!item) return '';
  const who = item.mine ? 'You' : item.who || 'Someone';
  const at = typeof item.at === 'number' ? commentTime(new Date(item.at).toISOString(), now) : '';
  return [WORDS.trashedTitle(who, canvasName(item.path)), at].filter(Boolean).join(' · ');
}

/**
 * Publish the ghost rows for the open tabs (the `trash` source); cleared on unmount. `items` from `useTrash()`.
 */
export function useTrashGhosts(items, open, onOpen, activeRel = null) {
  const key = (open || []).join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `open`
  const ghosts = useMemo(
    () => trashGhosts(items, open, onOpen, activeRel),
    [items, key, onOpen, activeRel]
  );
  useEffect(() => {
    setGhostRows('trash', ghosts);
  }, [ghosts]);
  useEffect(() => () => setGhostRows('trash', []), []);
  return ghosts;
}

export function TrashedBanner({ item, canRestore = true, now, fetchImpl, onRestored, onError }) {
  const [busy, setBusy] = useState(false);
  if (!item) return null;
  const restore = async () => {
    setBusy(true);
    try {
      const r = await restoreItem(item.id, fetchImpl);
      if (r.status >= 200 && r.status < 300 && r.body?.ok !== false)
        onRestored?.(r.body?.path ?? item.path);
      else
        onError?.(
          typeof r.body?.error === 'string' ? r.body.error : 'Could not restore it. Try again.'
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="island v2ac-banner" role="status" data-testid="canvas-trashed-banner">
      <span className="v2ac-banner-ic" aria-hidden="true">
        <TrashGlyph />
      </span>
      <span className="v2ac-banner-t">
        {trashedTitle(item, now)}
        <span>{WORDS.trashedLine}</span>
      </span>
      {canRestore && (
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy}
          data-testid="canvas-trashed-restore"
          onClick={restore}
        >
          {WORDS.restore}
        </button>
      )}
    </div>
  );
}

function TrashGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  );
}
