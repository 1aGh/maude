// shell-events.js — what a project window does with the Rust shell's own events (V2-3.3 / V2-3.5,
// contract V2-1.1 §5.4 events, §5.10 words). Every event is `emit_to(<this window>)`.
//
//   shell://navigate {canvas, artboard}  open that canvas and focus the artboard — through the SAME
//                                         path `?open=` and `maude design open` use: the URL identity
//                                         resolves like a link (use-tabs `openLinkedFile`), the
//                                         artboard runs `view.zoom-to-artboard` (ui-open.js)
//   shell://opened-existing {name}       toast "<name> is open in this window."
//   shell://tabs-restored {count}        toast "<count> tabs reopened. Each one starts when you open it."
//
// Rust emits tabs-restored while the restored front tab is still on its splash, before this page
// exists to hear it, and a NEW tab opened from a link gets its canvas as `?open=` but no artboard.
// So on start the page also asks once: `take_tabs_restored` and `take_pending_navigate` (one-shot,
// parked per window like `take_pending_deep_link`). A shell without those commands rejects the
// invoke — the feature check — and the events alone still work.

import { CANVAS_EXT_RE as CANVAS_RE } from './shell/constants.js';
import { normalizeOpenPath } from './share-link.js';
import { applyUiOpen } from './ui-open.js';

// The artboard rule Rust's `validate_target` applies: 1–128 characters, no control characters.
const okArtboard = (a) =>
  typeof a === 'string' &&
  a.length > 0 &&
  a.length <= 128 &&
  ![...a].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export const openedExistingWords = (name) => `${name} is open in this window.`;
export const tabsRestoredWords = (count) =>
  `${count} tabs reopened. Each one starts when you open it.`;

const cleanName = (name) =>
  typeof name === 'string' && name.trim() && name.length <= 200 ? name.trim() : null;
const cleanCount = (count) =>
  Number.isInteger(count) && count > 1 && count <= 10_000 ? count : null;

/**
 * What a `shell://navigate` payload does, as data. Pure. null = nothing.
 *   { rel, file, artboard }  rel = the canvas's URL identity (null: the artboard is in the open
 *                            canvas), file = the tree path it resolves to (null: not in this tree)
 */
export function navigatePlan(payload, { paths, designRel, activePath }) {
  if (!payload || typeof payload !== 'object') return null;
  const artboard = okArtboard(payload.artboard) ? payload.artboard : null;
  if (payload.canvas == null) {
    if (!artboard || !activePath || !CANVAS_RE.test(activePath)) return null;
    return { rel: null, file: activePath, artboard };
  }
  const rel = normalizeOpenPath(payload.canvas, designRel);
  if (!rel) return null;
  const file = (paths ?? []).find((p) => normalizeOpenPath(p, designRel) === rel) ?? null;
  return { rel, file, artboard };
}

/**
 * Apply a `shell://navigate` payload. deps:
 *   paths, designRel, activePath   the loaded tree, read when the event lands
 *   openLinkedFile(rel)             use-tabs: a URL identity → its tab / preview / "Not here yet"
 *   openTab, frameFor, setPresent   ui-open.js's deps (the artboard focus ladder)
 *   schedule                        setTimeout (injected for tests)
 * Returns the plan (null = ignored).
 */
export function applyShellNavigate(payload, deps) {
  const plan = navigatePlan(payload, deps);
  if (!plan) return null;
  if (plan.artboard && plan.file && CANVAS_RE.test(plan.file))
    applyUiOpen({ file: plan.file, artboard: plan.artboard }, deps);
  else if (plan.rel) deps.openLinkedFile(plan.rel);
  return plan;
}

/**
 * Subscribe this window to the shell events. deps: { invoke, listen, toast, onNavigate }.
 * `listen(event, handler)` resolves to an unlisten fn; `invoke` rejects for an unknown command.
 * Returns a stop fn.
 */
export function startShellEvents({ invoke, listen, toast, onNavigate }) {
  let alive = true;
  let restoredShown = false;
  const offs = [];
  const restored = (p) => {
    const count = cleanCount(p?.count);
    if (!alive || restoredShown || !count) return;
    restoredShown = true;
    toast(tabsRestoredWords(count));
  };
  const navigate = (p) => {
    if (alive && p) onNavigate(p);
  };
  const sub = (event, handler) =>
    Promise.resolve(listen(event, handler))
      .then((off) => {
        if (typeof off !== 'function') return;
        if (alive) offs.push(off);
        else off();
      })
      .catch(() => {});
  sub('shell://opened-existing', (p) => {
    const name = cleanName(p?.name);
    if (alive && name) toast(openedExistingWords(name));
  });
  sub('shell://tabs-restored', restored);
  sub('shell://navigate', navigate);
  const ask = (cmd, then) =>
    Promise.resolve()
      .then(() => invoke(cmd))
      .then((v) => v && then(v))
      .catch(() => {});
  ask('take_tabs_restored', restored);
  ask('take_pending_navigate', navigate);
  return () => {
    alive = false;
    for (const off of offs.splice(0)) off();
  };
}
