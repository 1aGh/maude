// client/v2/create/take-intent.js — S6.3: a project window takes the intent Home parked for it and does it.
//
// Home sends `open_project({pid | root}, intent)`; Rust validates the intent, parks it for the target window
// (the prompt is never in a URL — V2-1.1 §5.4, invariant 8) and nudges `shell://intent`. This module is the other
// end: ask once on start (`take_pending_intent`, which hands it over ONCE — a reload finds nothing, so nothing
// runs twice) and again on every nudge.
//
//   create-canvas   a canvas from one sentence, opened, drafted by AI (first-draft.js)
//   create-empty    a blank canvas (⌘N on Home)
//   import-brand    the Import a brand sheet (`import.brand`)
//   import-figma    the Figma import (`import.figma`)
//   make-ds         Home's "A design system" starter (`ds.make`: the three-input sheet), S10.16c
//
// The intent is UNTRUSTED here as well: Rust already refused a bad one, but a page can hold any value, so the kind
// is re-checked against the same five, the sentence against the same rules, and anything else is dropped — never
// run. A Can view / Can comment project refuses with the shell's one denial line and makes nothing (the server
// refuses the create too; this only says so).

import { startFirstDraft } from './first-draft.js';
import { createBlankCanvas } from './new-canvas.js';

/** Mirrors Rust's `INTENT_KINDS` (`home.rs`). */
export const INTENT_KINDS = Object.freeze([
  'create-canvas',
  'create-empty',
  'import-brand',
  'import-figma',
  'make-ds',
]);

/** Mirrors Rust's cap on the sentence (characters). */
export const INTENT_PROMPT_MAX = 4000;

/** A kind → the registry action it runs when it is an import. */
export const IMPORT_ACTION = Object.freeze({
  'import-brand': 'import.brand',
  'import-figma': 'import.figma',
});

/** Every kind that runs a registry action instead of making a canvas. S10.16c: `make-ds` is Home's "A design
 *  system" starter — `ds.make` opens the three-input sheet (13 · ds-make-inputs) in the target's window. */
export const INTENT_ACTION = Object.freeze({ ...IMPORT_ACTION, 'make-ds': 'ds.make' });

/** The toast after a project Home just made has moved to the cloud (02 ob-first-draw). */
export const firstProjectWords = (project) =>
  `${project} is your first project, on cloud.maude.sh.`;

/**
 * `validate_intent`, on the page. Returns the clean intent or null (= dropped).
 * @returns {{ kind: string, prompt: string, moveToCloud: boolean } | null}
 */
export function validateIntent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { kind } = raw;
  if (typeof kind !== 'string' || !INTENT_KINDS.includes(kind)) return null;
  const prompt = raw.prompt == null ? '' : raw.prompt;
  if (typeof prompt !== 'string' || [...prompt].length > INTENT_PROMPT_MAX) return null;
  if (kind === 'create-canvas' && !prompt.trim()) return null; // the sentence is the point
  if (kind === 'create-empty' && prompt !== '') return null; // an empty canvas carries no prompt
  if (kind === 'make-ds' && prompt !== '') return null; // the sheet asks its own sentence
  return { kind, prompt, moveToCloud: raw.moveToCloud === true };
}

/**
 * Do one intent.
 * @param {unknown} raw  whatever `take_pending_intent` returned
 * @param {{ canEdit: () => boolean, roleDenial: string, toast: (m: string, ok?: boolean, action?: object) => void,
 *           fetchImpl?: typeof fetch, open?: (file: string) => void, runAction: (id: string) => unknown,
 *           firstDraft?: typeof startFirstDraft, blank?: typeof createBlankCanvas,
 *           onRename?: () => void }} deps
 * @returns {Promise<{ ok: boolean, reason?: 'invalid' | 'role' | 'create', file?: string }>}
 */
export async function runIntent(raw, deps) {
  const intent = validateIntent(raw);
  if (!intent) return { ok: false, reason: 'invalid' };
  if (!deps.canEdit()) {
    deps.toast(deps.roleDenial);
    return { ok: false, reason: 'role' };
  }
  const d = { fetchImpl: deps.fetchImpl, open: deps.open, toast: deps.toast };
  let made = null;
  if (intent.kind === 'create-canvas') {
    made = await (deps.firstDraft ?? startFirstDraft)(intent.prompt, d);
    if (!made.ok) return { ok: false, reason: 'create' };
  } else if (intent.kind === 'create-empty') {
    made = await (deps.blank ?? createBlankCanvas)(d);
    if (!made.ok) return { ok: false, reason: 'create' };
  } else {
    // An import carries no sentence into the sheet: whatever a parked prompt said is never put in a form.
    deps.runAction(INTENT_ACTION[intent.kind]);
  }
  // The canvas never waits on the cloud: the move runs after, in the background, and may fail quietly.
  if (intent.moveToCloud) void moveToCloud(deps);
  return made ? { ok: true, file: made.file } : { ok: true };
}

/**
 * S6.0 §5.5: `POST /_api/cloud/move` — the project window's own call, once, for a project Home just made while
 * signed in. 200 → the first-project toast with Rename; anything else (404 route absent, 401, 402, 403, 409, 503)
 * leaves the project local — "This Mac only" is the status word, no extra toast.
 */
async function moveToCloud(deps) {
  const f = deps.fetchImpl ?? globalThis.fetch;
  try {
    const r = await f('/_api/cloud/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok || typeof j.project !== 'string' || !j.project) return;
    deps.toast(
      firstProjectWords(j.project),
      true,
      deps.onRename ? { label: 'Rename', onClick: deps.onRename } : undefined
    );
  } catch {
    /* offline: the project stays on this Mac */
  }
}

/**
 * Take the parked intent on start and on every `shell://intent` nudge, and run each once.
 * `invoke` rejects for an unknown command (a shell without the intent lane): then there is nothing to take.
 * @param {{ invoke: (cmd: string) => Promise<unknown>, listen: (event: string, h: () => void) => Promise<() => void> | (() => void),
 *           run: (raw: unknown) => unknown }} d
 * @returns {() => void} stop
 */
export function startIntentConsumer({ invoke, listen, run }) {
  let alive = true;
  let off = null;
  // Rust hands the intent over once, so two takes (the boot ask and the nudge) can never run it twice.
  const take = () =>
    Promise.resolve()
      .then(() => invoke('take_pending_intent'))
      .then((raw) => (alive && raw ? run(raw) : undefined))
      .catch(() => {});
  Promise.resolve(listen('shell://intent', take))
    .then((fn) => {
      if (typeof fn !== 'function') return;
      if (alive) off = fn;
      else fn();
    })
    .catch(() => {});
  take();
  return () => {
    alive = false;
    off?.();
    off = null;
  };
}
