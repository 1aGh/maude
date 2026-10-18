// S10.4 (V2-1.6 §5.8 "Element pins") — the studio's side of `data-ds-rev`.
//
// A canvas element may carry `data-ds-rev="head"` or `data-ds-rev="<id>"`: it keeps that revision's look
// while the canvas renders its own. The canvas document ASKS for the values it carries (`ds-pins-want`);
// this answers (`ds-pins`) with the two sibling paths per value, which the document fetches and scopes
// (ds/pin-scope.ts, mirrored in the shell template). The iframe is untrusted (DDR-054): every value it
// names is checked here, it cannot name a path, and a revision this Mac does not hold is simply not listed
// (that element keeps the canvas's own look until it arrives).

const REV_ID = /^[0-9a-f]{64}$/;
const MAX_VALUES = 16;

/** `head` or a revision id. */
export function isPinValue(v) {
  return v === 'head' || (typeof v === 'string' && REV_ID.test(v));
}

/**
 * The quiet line for a canvas whose revision has not reached this Mac (CONTRACT §3: a file that exists on
 * someone's device but hasn't synced is "Waiting for Jonas's Mac", never an error). `peer` comes from
 * `canvasDsRender(...).waiting.peer`; until a device is named it is "another device".
 */
export function dsWaitingText(peer) {
  return typeof peer === 'string' && peer.trim()
    ? `Waiting for ${peer.trim()}'s Mac`
    : 'Waiting for another device';
}

/**
 * The `data-ds-rev` a NEW instance placed on this canvas arrives with (10 `ds-edit-instance`: "a new one
 * placed with Component (⇧I) arrives current"). A canvas left on a revision (it has a `dsRev`) would render
 * the new instance with that old look, so the instance carries `head`; a canvas that follows head needs
 * nothing. `null` = write no attribute.
 */
export function dsRevForPlacement({ converted, canvasDsRev }) {
  if (!converted) return null;
  return typeof canvasDsRev === 'string' && canvasDsRev ? 'head' : null;
}

/**
 * The `ds-pins` message for the values a canvas asked for.
 * @param {{ want: unknown, ds: { path: string, rootClass?: string | null }, head: string | null,
 *           canvasRev?: string | null, gaps?: Record<string, unknown> }} a
 *   `canvasRev` is the revision the canvas itself renders — a pin equal to it needs no sheet of its own.
 */
export function pinsReply({ want, ds, head, canvasRev = null, gaps = {} }) {
  const revs = {};
  const list = Array.isArray(want) ? want : [];
  for (const v of list.slice(0, MAX_VALUES)) {
    if (!isPinValue(v)) continue;
    const id = v === 'head' ? head : v;
    if (typeof id !== 'string' || !REV_ID.test(id)) continue;
    if (id === canvasRev) continue;
    if (Object.hasOwn(gaps, id)) continue;
    revs[v] = {
      tokens: `${ds.path}/revisions/${id}.tokens.css`,
      components: `${ds.path}/revisions/${id}.components.css`,
    };
  }
  return { dgn: 'ds-pins', revs, rootClass: ds.rootClass ?? null };
}

/**
 * Wire it per canvas frame. `state(key)` returns what the studio knows about that canvas now —
 * `{ ds, head, canvasRev, gaps }`, or null when the canvas follows no converted system — and `post(key,
 * message)` posts into its frame.
 */
export function createPinsHost({ state, post }) {
  /** key → the values the frame last asked for */
  const asked = new Map();

  function answer(key) {
    const s = state(key);
    if (!s) return false;
    post(key, pinsReply({ want: asked.get(key) ?? [], ...s }));
    return true;
  }

  return {
    /** A `ds-pins-want` from the frame at `key` (already past the dgn gate). */
    onMessage(key, m) {
      if (!m || m.dgn !== 'ds-pins-want') return false;
      const revs = Array.isArray(m.revs) ? m.revs.filter(isPinValue).slice(0, MAX_VALUES) : [];
      asked.set(key, revs);
      return answer(key);
    },
    /** The head (or a revision's presence) changed: answer again for what each frame asked. */
    refresh(key) {
      if (key !== undefined) return asked.has(key) && answer(key);
      let n = 0;
      for (const k of asked.keys()) if (answer(k)) n++;
      return n;
    },
    forget(key) {
      asked.delete(key);
    },
  };
}
