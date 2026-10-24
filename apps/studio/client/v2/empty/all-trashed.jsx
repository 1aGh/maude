// client/v2/empty/all-trashed.jsx — S11.5: "Every artboard moved to the trash" (05 Empty States › es-all-trashed).
//
// The canvas has no artboards left and the Trash holds them. The shell draws ONE card over the empty canvas —
// the situation, why it is fine, one verb — and tells the canvas to keep the outlines where the artboards stood
// (all-trashed-relay.js → artboard-ghosts-overlay.tsx). Restore N puts every artboard back where it was (S1.13's
// splice, one trash restore each) and the toast's Undo takes them all back to the trash as one step.
//
//   AllTrashedCard   the card (presentational): the kit's Empty with the table's words. Can view sees it without
//                    the button; the server refuses a restore from them anyway (hidden ≠ refused).
//   AllTrashed       the host the app mounts once over the canvas stage: reads the shared Trash, decides whether
//                    this canvas is the all-trashed one, runs Restore N, feeds the ghost lane.
//
// Mount (lead, app.jsx): `<AllTrashed activePath designRel artboardCount={activeArtboards} ready canEdit />` inside
// the canvas stage, beside the other canvas overlays. It renders nothing unless the open canvas has no artboard
// and the Trash has some of its own.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createGhostLane } from './all-trashed-relay.js';
import {
  allTrashedModel,
  loadGhosts,
  restoreAll,
  restoreOutcome,
  showAllTrashed,
  TRASH_CHANGED_EVENT,
  undoRestore,
} from './all-trashed-model.js';
import { Empty } from './empty.jsx';

/** @param {{ model: ReturnType<typeof allTrashedModel>, canEdit: boolean, busy?: boolean, note?: string|null, onRestore?: () => void }} props */
export function AllTrashedCard({ model, canEdit, busy = false, note = null, onRestore }) {
  const door = canEdit ? (
    <button
      type="button"
      className="btn btn--primary btn--sm"
      data-testid="all-trashed-restore"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={onRestore}
    >
      {model.restoreLabel}
    </button>
  ) : undefined;
  return (
    <div className="es-alltrashed" data-testid="all-trashed" data-count={model.count}>
      <Empty
        size="canvas"
        glyph="trash"
        className="es-trashcard"
        copyId="es-all-trashed.all-trashed"
        vars={model.vars}
        actions={door}
        foot={note}
      />
    </div>
  );
}

/** The shared Trash's items, or [] while no home answers / this home has no shared Trash. */
async function readTrash(fetchImpl) {
  try {
    const r = await fetchImpl('/_api/trash');
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return j?.ok === true && Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

const defaultToast = (message, ok, action) =>
  import('../../shell/util.js').then((m) => m.shellToast(message, ok, action));

/**
 * @param {{
 *   activePath: string|null, designRel?: string, artboardCount: number, ready?: boolean, canEdit: boolean,
 *   fetchImpl?: typeof fetch, toast?: (message: string, ok?: boolean, action?: {label: string, onClick: () => void}) => void,
 *   onChanged?: () => void, now?: () => number, lane?: ReturnType<typeof createGhostLane>
 * }} props
 */
export function AllTrashed({
  activePath,
  designRel = '.design',
  artboardCount,
  ready = true,
  canEdit,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  toast = defaultToast,
  onChanged,
  now = Date.now,
  lane: laneIn,
  onShown, // (boolean) => void — told when the card goes on / off screen (the host hides "Your canvas is ready.")
}) {
  const prefix = `${designRel.replace(/\/+$/, '')}/`;
  const canvasPath = activePath?.startsWith(prefix) ? activePath.slice(prefix.length) : null;
  const wantTrash = ready === true && artboardCount === 0 && canvasPath !== null;

  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false); // the Trash has answered once for this canvas
  const [gone, setGone] = useState(() => new Set()); // restored here; the list catches up on its own
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [bump, setBump] = useState(0);
  const [ghosts, setGhosts] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const on = () => setBump((n) => n + 1);
    window.addEventListener(TRASH_CHANGED_EVENT, on);
    return () => window.removeEventListener(TRASH_CHANGED_EVENT, on);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bump` is the re-read trigger.
  useEffect(() => {
    if (!wantTrash) {
      setItems([]);
      setLoaded(false);
      return undefined;
    }
    let live = true;
    readTrash(fetchImpl).then((list) => {
      if (live && alive.current) {
        setItems(list);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, [wantTrash, canvasPath, fetchImpl, bump]);

  const visible = items.filter((i) => !gone.has(i.id));
  const model = wantTrash ? allTrashedModel(visible, canvasPath, now()) : null;
  const shown = showAllTrashed({ artboardCount, ready, model });
  // true / false once the Trash has answered (or there is nothing to ask); null while it has not — the host
  // holds "Your canvas is ready." back that long so it does not flash under the card
  const settled = !wantTrash || loaded;
  useEffect(() => {
    onShown?.(settled ? shown : null);
  }, [settled, shown, onShown]);

  // The outlines: the canvas keeps the places the artboards stood in.
  const lane = useRef(laneIn ?? null);
  useEffect(() => {
    if (!lane.current) lane.current = createGhostLane();
    return () => {
      lane.current?.stop();
      lane.current = null;
    };
  }, []);
  const modelKey = shown ? model.items.map((i) => `${i.id}@${i.rev}`).join(',') : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `modelKey` stands for the model's items.
  useEffect(() => {
    if (!shown) {
      setGhosts(null);
      return undefined;
    }
    let live = true;
    loadGhosts(model, { fetchImpl }).then((g) => {
      if (live && alive.current) setGhosts(g);
    });
    return () => {
      live = false;
    };
  }, [modelKey, shown, fetchImpl]);
  useEffect(() => {
    if (!lane.current) return;
    lane.current.set(
      shown && ghosts ? activePath : null,
      shown && ghosts ? canvasPath : '',
      shown && ghosts ? ghosts : null
    );
  }, [shown, ghosts, activePath, canvasPath]);

  const restore = useCallback(async () => {
    if (!model || busy) return;
    setBusy(true);
    setNote(null);
    const asked = model.items;
    const result = await restoreAll(asked, { fetchImpl });
    if (!alive.current) return;
    setBusy(false);
    const out = restoreOutcome(result, asked.length);
    if (result.restored.length) {
      setGone((prev) => new Set([...prev, ...result.restored]));
      onChanged?.();
    }
    if (!out.ok) setNote(out.line);
    toast(
      out.line,
      out.ok,
      out.undo
        ? {
            label: 'Undo',
            onClick: async () => {
              const back = await undoRestore(out.undo, { fetchImpl });
              if (!alive.current) return;
              if (back) {
                setGone((prev) => {
                  const next = new Set(prev);
                  for (const id of result.restored) next.delete(id);
                  return next;
                });
                setBump((n) => n + 1);
                onChanged?.();
              } else {
                toast('Could not undo that. The artboards are still back.', false);
              }
            },
          }
        : undefined
    );
  }, [model, busy, fetchImpl, toast, onChanged]);

  if (!shown) return null;
  return (
    <AllTrashedCard model={model} canEdit={canEdit} busy={busy} note={note} onRestore={restore} />
  );
}
