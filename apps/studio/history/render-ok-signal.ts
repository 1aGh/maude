// "This canvas just drew without an error" — the server's half of the C5 render signal (S6.12).
//
// The canvas document posts `render-ok { file }` to its shell (dgn c2s); the shell relays it as the inspector
// socket's `{ type: 'render-ok', file }` frame (ws.ts), and that lands here. The canvas is UNTRUSTED (DDR-054):
// what it says is a claim, never an authority for a write. So this takes only a canvas NAME from the frame and
// decides everything else itself:
//   • the name must be a canvas file inside the design root (no traversal, no `_*` runtime folder, no symlink
//     that leaves the root);
//   • the source is read FROM DISK here and hashed here (S1.13: never take a hash from the client);
//   • the source must still parse (`sourceError`) — a canvas that claims "ok" for broken code records nothing;
//   • the same source twice is one write, and a flood of frames is one read per canvas per interval.
// The record is `_state/render-ok.json` (history/last-good.ts), the file `history.go-back` reads.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { toDesignRel } from '../access/request.ts';
import { isUnderOrEqual } from '../path-containment.ts';
import { sourceError } from '../sync/source-validation.ts';
import { readRenderOk, recordRenderOk, srcHashOf } from './last-good.ts';

/** A canvas larger than this is not read (no canvas comes near it). */
const MAX_BYTES = 4 * 1024 * 1024;
/** One look at a canvas per this many ms: a canvas that posts in a loop costs one read. */
export const RENDER_OK_GAP_MS = 400;
const MAX_FILE = 512;

export type RenderOkAnswer =
  | { ok: true; canvas: string; wrote: boolean }
  | { ok: false; reason: 'bad-name' | 'not-canvas' | 'unreadable' | 'broken' | 'too-soon' };

export function createRenderOkSignal(deps: {
  designRoot: string;
  designRel: string;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const lastLook = new Map<string, number>();

  return function acceptRenderOk(file: unknown): RenderOkAnswer {
    if (typeof file !== 'string' || !file || file.length > MAX_FILE) {
      return { ok: false, reason: 'bad-name' };
    }
    const canvas = toDesignRel(file, deps.designRel);
    if (!canvas || canvas.split('/').some((s) => s.startsWith('_'))) {
      return { ok: false, reason: 'bad-name' };
    }
    if (!/\.tsx$/i.test(canvas)) return { ok: false, reason: 'not-canvas' };
    const abs = path.join(deps.designRoot, ...canvas.split('/'));
    if (!isUnderOrEqual(abs, deps.designRoot)) return { ok: false, reason: 'bad-name' };

    const t = now();
    const before = lastLook.get(canvas);
    if (before !== undefined && t - before < RENDER_OK_GAP_MS) {
      return { ok: false, reason: 'too-soon' };
    }
    lastLook.set(canvas, t);
    if (lastLook.size > 256) lastLook.delete(lastLook.keys().next().value as string);

    let source: string;
    try {
      // a symlink inside the root that points out of it is not a canvas of this project
      if (!isUnderOrEqual(realpathSync(abs), realpathSync(deps.designRoot))) {
        return { ok: false, reason: 'bad-name' };
      }
      if (statSync(abs).size > MAX_BYTES) return { ok: false, reason: 'unreadable' };
      source = readFileSync(abs, 'utf8');
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    if (sourceError(canvas, source) !== null) return { ok: false, reason: 'broken' };
    if (readRenderOk(deps.designRoot)[canvas]?.srcHash === srcHashOf(source)) {
      return { ok: true, canvas, wrote: false };
    }
    try {
      recordRenderOk(deps.designRoot, canvas, source, { now: t });
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    return { ok: true, canvas, wrote: true };
  };
}
