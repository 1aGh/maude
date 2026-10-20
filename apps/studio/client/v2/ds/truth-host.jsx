// client/v2/ds/truth-host.jsx — S10.11: the shell's side of the outside-change review and the conflict pick
// (13 · ds-truth-outside, ds-truth-conflict).
//
// Mounted once, inside DsReviewHost (which the shell already mounts). While the open canvas is a system's own
// Design system canvas and the window is looked at, it reads `GET /_api/ds/state`, keeps the answer in a tiny store
// the inspector's empty place reads (truth-store.js → `DsTruthCard`), tells the canvas which swatches to mark
// ("Changed outside", "2 versions"), and runs the four writes the cards ask for:
//
//   Keep / Undo     POST /_api/ds/outside {ds, action}
//   Use this        POST /_api/ds/pick {ds, css, use}          (a token in two places)
//                   POST /_api/ds/pick {ds, head}               ("Published in two places")
//
// Every write is the server's to refuse (Can edit on the whole project, rule 12): a refusal comes back as a code
// and becomes the person's words. The system comes from the canvas the person has open, never from a message.
// The studio does not push `ds:outside` to the page yet, so the state is read again every few seconds while the
// canvas is on screen (the server only offers a review after its 5 s quiet window, so a faster read gains nothing).

import { useEffect, useRef } from 'react';
import { contrastLine } from './contrast.js';
import { fetchBoard } from './token-write.js';
import { getTruth, setTruth, setTruthActions } from './truth-store.js';
import { headValueName, ownSystemOf, refusalWords, TRUTH_WORDS, truthOf } from './truth-model.js';
import { bodyOf } from './update-available.jsx';

export const TRUTH_POLL_MS = 6000;
const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(fetchImpl, method, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      cache: 'no-store',
      ...(body ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, code: 'unreachable', body: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* an unreadable answer is judged by its status */
  }
  const code = res.ok ? null : (json?.code ?? (res.status === 403 ? 'forbidden' : 'failed'));
  return { ok: res.ok, code, body: json };
}

/**
 * Everything the cards draw, for one system: the state row's truth, the board (file values, names, contrast), and
 * the names the head revision gave a token that is in a conflict. null when there is nothing to say.
 */
export async function loadTruth(ds, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'GET', `/_api/ds/state?ds=${encodeURIComponent(ds)}`);
  if (!r.ok) return null;
  const truth = truthOf(r.body?.systems?.[0]);
  if (!truth) return null;
  const wantsBoard = truth.conflicts.length > 0 || (truth.outside?.changes?.length ?? 0) > 0;
  const board = wantsBoard ? await fetchBoard(ds, fetchImpl) : null;
  const light = board?.themes?.light ?? 'light';
  const headNames = {};
  if (truth.conflicts.length && truth.head) {
    const body = await bodyOf(ds, truth.head);
    for (const c of truth.conflicts) {
      const n = headValueName(body, c.css, light);
      if (n) headNames[c.css] = n;
    }
  }
  const contrast = {};
  if (board) {
    for (const c of truth.outside?.changes ?? []) {
      const line = contrastLine(board, c.css);
      if (line?.line) contrast[c.css] = line.line;
    }
  }
  return { ds, truth, board, headNames, contrast };
}

/** Keep / Undo. */
export async function writeOutside(ds, action, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/outside', { ds, action });
  return r.ok ? { ok: true } : { ok: false, message: refusalWords(r.code), code: r.code };
}

/** "Use this" on a token that changed in two places. */
export async function writePick(ds, css, use, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/pick', { ds, css, use });
  return r.ok ? { ok: true } : { ok: false, message: refusalWords(r.code), code: r.code };
}

/** "Use this" on one of two heads. */
export async function writePickHead(ds, head, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/pick', { ds, head });
  return r.ok ? { ok: true } : { ok: false, message: refusalWords(r.code), code: r.code };
}

/**
 * Tell the Design system canvas which swatches to mark. A preview of state the studio holds: the canvas keeps it in
 * memory and writes nothing; it answers only its parent, and the message goes to the canvas origin, never `*`.
 */
export function postDsMarks(frame, marks, origin) {
  try {
    frame?.contentWindow?.postMessage(
      {
        dgn: 'ds-marks',
        outside: Array.isArray(marks?.outside) ? marks.outside : [],
        conflicts: Array.isArray(marks?.conflicts) ? marks.conflicts : [],
      },
      origin
    );
    return !!frame?.contentWindow;
  } catch {
    return false; // detached
  }
}

/** The file the outside card names, for the toast after Undo. */
function fileOfOutside(truth) {
  const f = truth?.outside?.files?.[0]?.path;
  return typeof f === 'string' ? f.replace(/^.*\//, '') : '';
}

/**
 * @param {{ cfg: any, activePath: string | null, toast?: (m: string) => void,
 *           frameFor?: () => HTMLIFrameElement | null, fetchImpl?: typeof fetch, pollMs?: number }} props
 */
export function DsTruthHost({
  cfg,
  activePath,
  toast,
  frameFor,
  fetchImpl,
  pollMs = TRUTH_POLL_MS,
}) {
  const ds = ownSystemOf(activePath, cfg);
  const live = useRef({ cfg, activePath, toast, frameFor, fetchImpl });
  live.current = { cfg, activePath, toast, frameFor, fetchImpl };
  const f = () => live.current.fetchImpl ?? globalThis.fetch;
  const say = (m) => live.current.toast?.(m);
  const last = useRef(null); // the marks the canvas was last told
  const current = getTruth; // the card as it was when the person pressed the button

  // biome-ignore lint/correctness/useExhaustiveDependencies: `ds` and the poll rate are the triggers; the rest rides on `live`
  useEffect(() => {
    if (!ds) {
      setTruth(null);
      setTruthActions(null);
      last.current = null;
      return undefined;
    }
    let dead = false;
    let seq = 0;

    const tell = (marks) => {
      const frame = live.current.frameFor?.() ?? null;
      const origin = live.current.cfg?.canvasOrigin || window.location.origin;
      last.current = marks;
      postDsMarks(frame, marks, origin);
    };

    const refresh = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const n = ++seq;
      const got = await loadTruth(ds, f());
      if (dead || n !== seq) return;
      setTruth(got ? { ...got, busy: false, note: null } : null);
      tell(got ? got.truth.marks : { outside: [], conflicts: [] });
    };

    // one write: busy while it runs, the outcome in words, then the new state
    const run = async (doIt, done) => {
      setTruth((t) => (t ? { ...t, busy: true, note: null } : t));
      const r = await doIt();
      if (dead) return;
      if (r.ok) {
        say(done());
        await refresh();
      } else {
        setTruth((t) => (t ? { ...t, busy: false, note: r.message } : t));
        // a refusal that means "that moved" shows what is there now
        if (r.code === 'ds-no-outside' || r.code === 'ds-no-conflict') await refresh();
      }
    };

    setTruthActions({
      keep: () =>
        run(
          () => writeOutside(ds, 'keep', f()),
          () => {
            const n = current()?.truth?.outside?.changes?.length ?? 0;
            return n > 0 ? TRUTH_WORDS.kept(n) : TRUTH_WORDS.keptOther;
          }
        ),
      undo: () =>
        run(
          () => writeOutside(ds, 'undo', f()),
          () => TRUTH_WORDS.undone(fileOfOutside(current()?.truth))
        ),
      pick: (css, use) =>
        run(
          () => writePick(ds, css, use, f()),
          () => {
            const label = current()?.truth?.conflicts?.find((c) => c.css === css)?.label ?? css;
            return TRUTH_WORDS.picked(label, use);
          }
        ),
      pickHead: (head) =>
        run(
          () => writePickHead(ds, head, f()),
          () => TRUTH_WORDS.pickedTwice
        ),
    });

    refresh();
    const timer = setInterval(refresh, pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    // a canvas that reloaded forgot its marks: when it says it has loaded, tell it again
    const onLoaded = (e) => {
      const frame = live.current.frameFor?.() ?? null;
      if (!frame || e.source !== frame.contentWindow) return;
      if (e.data && typeof e.data === 'object' && e.data.dgn === 'loaded' && last.current)
        tell(last.current);
    };
    window.addEventListener('message', onLoaded);
    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('message', onLoaded);
      setTruthActions(null);
      setTruth(null);
    };
  }, [ds, pollMs]);

  return null;
}
