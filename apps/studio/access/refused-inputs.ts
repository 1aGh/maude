// access/refused-inputs.ts — 2.0.5 (#205): why a canvas's built module was refused, for the person who can fix it.
//
// The inputs gate (access/frame.ts `inputsRefusal`, http.ts `canvasInputsGate`) refuses a built canvas module
// when it inlined a design-root file the frame's closure does not admit — typically a file that belongs to
// another canvas. The canvas origin answers the bare not-in-scope 403 and must keep doing so: canvas code reads
// that body. So the refusal's reason is kept HERE, on the server, per canvas, and reported only on the main
// origin (`/_index-data` `canvasRefusedInputs`, filtered per reader like `canvasImportsCanvases` — a name the
// reader cannot see is left out, and an entry with no visible name is dropped).
//
// Bounded: at most MAX_CANVASES canvases (oldest dropped first) × MAX_NAMES names each. A later build of the
// same canvas that passes the gate forgets its entry.

import { relative, resolve, sep } from 'node:path';
import { isUnderOrEqualPath } from './frame.ts';

export const MAX_CANVASES = 200;
export const MAX_NAMES = 20;

/** The design-root files (design-root-relative, `/`-separated) among `inputs` that `sees` does not admit. */
export function refusedDesignInputs(
  inputs: readonly string[],
  roots: readonly string[],
  sees: (rel: string) => boolean
): string[] {
  const out = new Set<string>();
  for (const abs of inputs) {
    for (const root of roots) {
      if (!isUnderOrEqualPath(abs, root)) continue;
      const rel = relative(root, abs).split(sep).join('/');
      if (rel && !sees(rel)) out.add(rel);
      break;
    }
  }
  return [...out].sort().slice(0, MAX_NAMES);
}

/** `entry` (absolute) → its design-root-relative name, or null outside every root. */
export function entryRel(entry: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    const rel = relative(root, resolve(entry)).split(sep).join('/');
    if (rel && !rel.startsWith('..')) return rel;
  }
  return null;
}

export interface RefusedInputs {
  /** Keep `names` as the reason `canvas` was refused. @returns whether the entry changed */
  record(canvas: string, names: readonly string[]): boolean;
  /** The gate passed for `canvas`: forget its reason. @returns whether there was one */
  clear(canvas: string): boolean;
  /** canvas (design-root-relative) → the files it was refused for. */
  report(): Map<string, string[]>;
}

export function createRefusedInputs(max = MAX_CANVASES): RefusedInputs {
  const byCanvas = new Map<string, string[]>();
  return {
    record(canvas, names) {
      const list = [...new Set(names)].sort().slice(0, MAX_NAMES);
      const was = byCanvas.get(canvas);
      if (was && was.length === list.length && was.every((n, i) => n === list[i])) return false;
      byCanvas.delete(canvas); // re-insert: the newest is last
      byCanvas.set(canvas, list);
      while (byCanvas.size > max) {
        const oldest = byCanvas.keys().next().value;
        if (oldest === undefined) break;
        byCanvas.delete(oldest);
      }
      return true;
    },
    clear(canvas) {
      return byCanvas.delete(canvas);
    },
    report() {
      return new Map([...byCanvas].map(([k, v]) => [k, [...v]]));
    },
  };
}

// One store per server context (the http layer records, the index reports).
const stores = new WeakMap<object, RefusedInputs>();
export function refusedInputsFor(ctx: object): RefusedInputs {
  let s = stores.get(ctx);
  if (!s) {
    s = createRefusedInputs();
    stores.set(ctx, s);
  }
  return s;
}
