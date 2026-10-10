// ui-open.js — the shell half of `maude design open` (contract V2-1.11 §5.3, V2-2.4b).
//
// The studio relays `{type:'ui-open', open}` (routes/agent.ts → ws.ts) to this project's shell.
// The shell runs what the UI runs — no second implementation:
//   #artboard      → run-action `view.zoom-to-artboard` {id}   (view.jump-artboard's target too)
//   @element       → `select-by-id` {id, artboardId}            (object.select-child/-parent/-next)
//   --select <x>   → run-action `select.all` / `select.none` / `select.all-annotations`
//   --mode present → the present toggle (present.canvas); edit / preview → present off
//
// A freshly opened canvas iframe mounts its listener late (dgn:'loaded' fires before the React
// shell is up), so the canvas messages are re-posted on the same retry ladder as the halo restore
// (use-shell-core.jsx). Every message is idempotent, so a repeat is harmless.

export const OPEN_LADDER_MS = [50, 450, 1200, 2500, 5000];

const SELECT_ACTION = {
  all: 'select.all',
  none: 'select.none',
  annotations: 'select.all-annotations',
};

const runAction = (id, params) =>
  params ? { dgn: 'run-action', v: 1, id, params } : { dgn: 'run-action', v: 1, id };

/** What a `ui-open` payload does, as data. Pure. null when the payload is not one. */
export function uiOpenPlan(open) {
  if (!open || typeof open !== 'object' || typeof open.file !== 'string' || !open.file) return null;
  const posts = [];
  if (typeof open.artboard === 'string' && open.artboard)
    posts.push(runAction('view.zoom-to-artboard', { id: open.artboard }));
  if (typeof open.element === 'string' && open.element)
    posts.push({
      dgn: 'select-by-id',
      id: open.element,
      artboardId: open.artboard || null,
      index: 0,
    });
  else if (SELECT_ACTION[open.select]) posts.push(runAction(SELECT_ACTION[open.select]));
  const present =
    open.mode === 'present' ? true : open.mode === 'edit' || open.mode === 'preview' ? false : null;
  return { file: open.file, posts, present };
}

/**
 * Apply a `ui-open` payload. deps:
 *   openTab(file)          — the shell's tab opener (use-tabs.jsx)
 *   frameFor(file)         — the canvas iframe element for that file, or null
 *   setPresent(on)         — present mode on / off
 *   schedule(fn, ms)       — setTimeout (injected for tests)
 * Returns the plan (null = ignored).
 */
export function applyUiOpen(open, deps) {
  const plan = uiOpenPlan(open);
  if (!plan) return null;
  deps.openTab(plan.file);
  if (plan.present !== null) deps.setPresent(plan.present);
  if (plan.posts.length) {
    const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    for (const ms of OPEN_LADDER_MS) {
      schedule(() => {
        const win = deps.frameFor(plan.file)?.contentWindow;
        if (!win) return;
        for (const m of plan.posts) {
          try {
            win.postMessage(m, '*');
          } catch {
            /* frame navigated away — the next rung re-posts */
          }
        }
      }, ms);
    }
  }
  return plan;
}
