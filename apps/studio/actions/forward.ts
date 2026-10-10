// actions/forward.ts — what the canvas iframe forwards to the shell (V2-1.3 contract §5.7).
//
// A keydown inside the canvas never reaches the shell's window listener, so the chords of the
// shell actions a canvas may invoke (`fromCanvas`) are forwarded by the injected inspector script
// (inspect.ts › INSPECTOR_SCRIPT), registered at page load — a canvas that failed to build, or a
// legacy .html canvas, still answers ⌘K and ⌘R. The table is generated from the registry here and
// interpolated into the script; it is no longer a hand list.

import { bindingInDocument } from './documents.ts';
import { ACTIONS } from './index.ts';
import type { ActionDef, ActionId, Chord } from './types.ts';

/** chord → action, for every binding of a `fromCanvas` action the canvas document owns. Sorted. */
export function canvasForwards(actions: readonly ActionDef[] = ACTIONS): Record<Chord, ActionId> {
  const out: Record<Chord, ActionId> = {};
  for (const a of actions) {
    if (!a.fromCanvas) continue;
    for (const b of a.keys ?? []) {
      if (!bindingInDocument(b, 'canvas')) continue;
      if (out[b.chord] && out[b.chord] !== a.id)
        throw new Error(
          `actions/forward: ${b.chord} is forwarded for both ${out[b.chord]} and ${a.id}`
        );
      out[b.chord] = a.id;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}

/**
 * The injected script's chord normaliser — plain ES5, no imports (it runs before the canvas
 * bundle). It is the part of keys.ts › chordFromEvent the forwarded chords need: ⌃ folds into ⌘,
 * ⌥, ⇧ kept on letters, a letter / digit / ASCII symbol from `e.key`, else the physical key from
 * `e.code`. `actions-forward.test.ts` proves it agrees with chordFromEvent on every forwarded
 * chord. No backslashes on purpose: the string is interpolated into a template literal.
 */
export const CHORD_OF_EVENT_JS = `function (e) {
    var k = e.key || '';
    if (!/^[!-~]$/.test(k)) {
      var m = /^Key([A-Z])$/.exec(e.code || '') || /^Digit([0-9])$/.exec(e.code || '');
      if (m) k = m[1];
    }
    if (/^[a-z]$/.test(k)) k = k.toUpperCase();
    return (e.altKey ? '⌥' : '') + (e.shiftKey && /^[A-Z]$/.test(k) ? '⇧' : '') + (e.metaKey || e.ctrlKey ? '⌘' : '') + k;
  }`;
