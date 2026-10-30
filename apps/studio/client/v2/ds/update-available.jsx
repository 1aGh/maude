// client/v2/ds/update-available.jsx — S10.8: "Update available" on an instance of a canvas that was left out of an
// update (13 · ds-edit-instance, V2-1.6 §5.11 d). S2.17's instance kind has the slot (blocks.js); this registers the
// block into it. Select an instance on a left-out canvas and it says what it is missing:
//
//   ● Update available
//   Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update.
//   [Update]  [Keep this version]  [Detach]
//
// Keep this version (`ds.canvas-leave`, p8-dead-reasons) keeps the canvas on its version and the card away for this
// update — after a reload too, and on every peer (`.meta.json` `dsKept`); Update stays in the canvas's menu.
//
// Update gives THIS instance the current look (`ds.instance-update` writes `data-ds-rev="head"` on it — one
// edit, one ⌘Z); the rest of the canvas keeps its version. Detach is S2's (`component.detach`). The block is
// quiet otherwise: nothing on a canvas that follows the system, nothing on an instance already current.

import { useCallback, useEffect, useState } from 'react';
import { registerBlock } from '../inspector/blocks.js';
import { canvasLeaveNow, DS_STATE_CHANGED } from './door-write.js';
import { diffRevisions, leftOutOf, missedUpdate, relOf, whatWords } from './update-model.js';

const noCache = { cache: 'no-store' };
const bodies = new Map(); // revision id → body | null (revisions are immutable: cached for the session)

async function getJson(url) {
  try {
    const r = await fetch(url, noCache);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function bodyOf(ds, rev) {
  const key = `${ds}@${rev}`;
  if (bodies.has(key)) return bodies.get(key);
  const b = await getJson(`/_api/ds/revision?ds=${encodeURIComponent(ds)}&rev=${rev}`);
  bodies.set(key, b);
  return b;
}

/** Test seam: forget what was read. */
export const forgetRevisions = () => bodies.clear();

/**
 * `ds.instance-update` — ask the studio to give one instance the current look. The writer is an edit-op
 * (`edit-ops/ds-instance-update.ts`), so an AI hold, a lock and a viewer's 403 come back as words.
 * @returns {Promise<{ ok: true, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export async function writeInstanceUpdate({ canvas, ref }, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: canvas, op: 'ds.instance-update', targets: [ref] }),
    });
  } catch {
    return { ok: false, message: 'Not updated. The studio could not be reached; try again.' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (body?.ok) return { ok: true, writeId: body.writeId, actionId: body.actionId ?? null };
  const said = {
    'held-by-ai': 'Not updated. This belongs to AI until it’s done; Stop is in the AI chat.',
    locked: 'Not updated. This object is locked; unlock it first.',
    stale: 'Not updated. The canvas changed underneath; try again.',
    forbidden: 'Not updated. You can look here; ask to edit.',
  };
  return { ok: false, message: said[body?.code] ?? body?.message ?? 'Not updated; try again.' };
}

/** What the canvas is missing: `{ diff, row, more }`, or null while it loads / when nothing is known. */
export function useMissedUpdate(info) {
  const [state, setState] = useState(null);
  const key = info ? `${info.ds}|${info.dsRev}|${info.head}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the three ids
  useEffect(() => {
    if (!info) {
      setState(null);
      return undefined;
    }
    let dead = false;
    (async () => {
      const [list, oldBody, newBody] = await Promise.all([
        getJson(`/_api/ds/revisions?ds=${encodeURIComponent(info.ds)}`),
        bodyOf(info.ds, info.dsRev),
        bodyOf(info.ds, info.head),
      ]);
      if (dead) return;
      const diff =
        oldBody && newBody ? diffRevisions(oldBody, newBody) : { tokens: [], components: [] };
      const missed = missedUpdate(list?.revisions, info.dsRev);
      setState({ diff, row: missed?.row ?? null, more: missed?.more ?? 0 });
    })();
    return () => {
      dead = true;
    };
  }, [key]);
  return state;
}

/**
 * @param {{ canvas: string, elementId: string, cfg: any, el?: any, onUpdate?: () => any, onDetach?: () => any,
 *           busy?: boolean, error?: string }} props
 */
export function DsUpdateAvailable({
  canvas,
  cfg,
  el,
  onUpdate,
  onKeep,
  onDetach,
  busy = false,
  error = '',
}) {
  const info = leftOutOf(canvas, cfg);
  const missed = useMissedUpdate(info);
  const pin = el?.instanceInfo?.dsPin ?? null;
  if (!info || info.kept || pin === 'head' || pin === info.head) return null;
  const name = canvas.replace(/^.*\//, '').replace(/\.tsx$/i, '');
  const text = missed
    ? whatWords({
        diff: missed.diff,
        row: missed.row,
        folder: info.folder,
        name,
        more: missed.more,
      })
    : 'The design system has changed since this canvas was left out.';
  return (
    <section className="insp-sec" data-testid="ds-update-available" aria-label="Update available">
      <div className="ds-upd-block">
        <p>
          <span className="ds-upd-dot" aria-hidden="true" />
          Update available
        </p>
        <span className="ds-upd-what" data-testid="ds-update-what">
          {text}
        </span>
        <span className="ds-upd-acts">
          <button
            type="button"
            className="btn btn--sm btn--primary"
            disabled={busy}
            data-testid="ds-update-do"
            onClick={onUpdate}
          >
            Update
          </button>
          {onKeep ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={busy}
              data-testid="ds-update-keep"
              onClick={onKeep}
            >
              Keep this version
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={busy}
            data-testid="ds-update-detach"
            onClick={onDetach}
          >
            Detach
          </button>
        </span>
        {error ? (
          <span className="dsr-err" role="alert" data-testid="ds-update-error">
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}

const refOf = (el) => (Array.isArray(el?.refs) ? el.refs[0] : null);

/** The block as the inspector draws it: wires the buttons to the edit-op and to S2's Detach. */
export function UpdateAvailableBlock({ el, ctx }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canvas = ctx?.canvasFile;
  const ref = refOf(el);
  const editable = ctx?.editable !== false && !!ref;
  const update = useCallback(async () => {
    if (!editable || busy) return;
    setBusy(true);
    setError('');
    const r = await writeInstanceUpdate({ canvas, ref });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // a legacy-link project undoes through the edit-op revert; an op-log project's ⌘Z binds to the action
    if (r.writeId && r.actionId == null)
      ctx?.onRecordEdit?.({ op: 'edit-op', writeId: r.writeId, label: 'Update' });
    ctx?.refreshInstance?.();
  }, [editable, busy, canvas, ref, ctx]);
  const [kept, setKept] = useState(false);
  const keep = useCallback(async () => {
    if (!editable || busy || !canvas) return;
    setBusy(true);
    setError('');
    const r = await canvasLeaveNow({ canvas: relOf(canvas, ctx?.cfg) });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setKept(true);
    window.dispatchEvent(new CustomEvent(DS_STATE_CHANGED));
  }, [editable, busy, canvas, ctx]);
  const detach = useCallback(() => {
    if (!editable || !ctx?.onRunAction) return;
    ctx.onRunAction({
      dgn: 'run-action',
      v: 1,
      id: 'component.detach',
      params: { targets: [ref] },
    });
    setTimeout(() => ctx.refreshInstance?.(), 450);
  }, [editable, ctx, ref]);
  if (!canvas || kept) return null;
  return (
    <DsUpdateAvailable
      canvas={canvas}
      cfg={ctx?.cfg}
      el={el}
      busy={busy || !editable}
      error={error}
      onUpdate={update}
      onKeep={keep}
      onDetach={detach}
    />
  );
}

let off = null;

/** Mount the block in S2.17's instance slot (idempotent; tests that took it back call it again). */
export function registerUpdateAvailable() {
  if (off) return;
  off = registerBlock({
    id: 'ds.update-available',
    kinds: ['instance'],
    at: 'top',
    order: 5,
    Body: UpdateAvailableBlock,
  });
}

export const offUpdateAvailable = () => {
  off?.();
  off = null;
};

registerUpdateAvailable();
