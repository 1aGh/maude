// The last canvas source this server BUILT, with the locator that build
// produced, per file (F4).
//
// The HMR broadcaster diffs a changed canvas against it to find a text-only
// edit it can hand straight to the open iframe (`HmrMessage.patches`). Seeded
// by the module route after each build — so the memo is exactly the source the
// iframe renders, and its locator names that render's `data-cd-id`s — and
// advanced by every broadcast that carried patches. Bounded: a memo miss only
// means the remount renders the change without the head start.

import type { LocatorMap } from './locator.ts';

const MAX_FILES = 256;
const MAX_BYTES = 512 * 1024;

export interface BuiltCanvas {
  source: string;
  locator: LocatorMap;
}

const memo = new Map<string, BuiltCanvas>();

export function rememberCanvasBuild(absPath: string, built: BuiltCanvas): void {
  memo.delete(absPath);
  if (built.source.length > MAX_BYTES) return;
  memo.set(absPath, built);
  if (memo.size > MAX_FILES) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
}

export function recallCanvasBuild(absPath: string): BuiltCanvas | undefined {
  return memo.get(absPath);
}

export function forgetCanvasBuilds(): void {
  memo.clear();
}
