// editing/take-keys.ts — ← → on a generated picture with other takes (S8.16, 12 · ia-gen-placed), the canvas half.
//
// The shell knows which pictures of the open canvas have other takes (it asked `GET /_api/generate-takes/of`) and
// sends the whole set as `gen-takes {assets}` (bridge/dgn-protocol.ts, parent-gated, capped). With one of them
// selected, the registry fact `selectionHasTakes` holds: `object.nudge` yields (its `notFacts`) and ← / → become a
// `take-step {dir}` to the shell, which runs `image.next-take` / `image.prev-take` over ITS OWN selection and role —
// the canvas names a direction, never an asset or a write.

import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { chordFromEvent, type KeyEventLike } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { Mode, SelKind } from '../actions/types.ts';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';

const NUDGE_KEYS = canvasKeyIndex(['object.nudge']);
const ASSET_RE = /assets\/[0-9a-f]{8}\.[A-Za-z0-9]{1,8}/;

let takeAssets: ReadonlySet<string> = new Set();

/** The set the shell last sent (`gen-takes`). Tests set it directly. */
export function setTakeAssets(list: readonly string[]): void {
  takeAssets = new Set(list);
}

/** `assets/<sha8>.<ext>` of a src (`/.design/assets/…`, `assets/…?v=…`), or null. */
export function assetOfSrc(src: string | null | undefined): string | null {
  const m = ASSET_RE.exec(String(src ?? ''));
  return m ? m[0] : null;
}

/** The picture asset of a selected element: its own src, else its one `<img>`'s, else the stamped `photoAsset`. */
export function pictureAssetOf(
  el: Element | null,
  sel: { photoAsset?: string } | null | undefined
): string | null {
  if (el) {
    const own = el.tagName?.toLowerCase() === 'img' ? el.getAttribute('src') : null;
    const a = assetOfSrc(own);
    if (a) return a;
    const imgs = el.querySelectorAll?.('img') ?? [];
    if (imgs.length === 1) {
      const b = assetOfSrc(imgs[0]?.getAttribute('src'));
      if (b) return b;
    }
  }
  return assetOfSrc(sel?.photoAsset ?? null);
}

/** The registry fact `selectionHasTakes` for this picture. */
export function hasTakes(asset: string | null): boolean {
  return !!asset && takeAssets.has(asset);
}

export interface TakeKeyState {
  typing: boolean;
  mode: Mode;
  selection: SelKind;
  /** the selected picture's asset (pictureAssetOf), or null */
  asset: string | null;
  singleKeys?: boolean;
}

/**
 * The take step a keydown asks for, or null. The registry decides first: when `object.nudge` still wins the chord
 * (no takes, a modifier, a non-object selection, Preview) it is a nudge, never a step.
 */
export function takeStepOf(e: KeyEventLike, s: TakeKeyState): 'next' | 'prev' | null {
  if (s.typing || s.selection !== 'object' || !hasTakes(s.asset)) return null;
  const chord = chordFromEvent(e);
  if (chord !== '→' && chord !== '←') return null;
  const nudge = resolveChord(
    NUDGE_KEYS,
    chord,
    canvasKeyCtx({
      typing: s.typing,
      readOnly: false,
      mode: s.mode,
      selection: s.selection,
      singleKeys: s.singleKeys,
      selectionHasTakes: true,
    })
  );
  if (nudge) return null;
  if (s.mode !== 'edit') return null;
  return chord === '→' ? 'next' : 'prev';
}

/** Ask the shell to step the take (`take-step`). */
export function postTakeStep(win: Window, dir: 'next' | 'prev'): void {
  try {
    win.parent.postMessage({ dgn: 'take-step', dir }, '*');
  } catch {
    /* detached / cross-origin */
  }
}

/** Listen for `gen-takes` from the parent shell (through the table: parent-gated, parsed, capped). Once per window. */
export function installTakeAssetsLane(win: Window): () => void {
  const slot = win as unknown as { __maudeGenTakes?: boolean };
  if (slot.__maudeGenTakes) return () => {};
  slot.__maudeGenTakes = true;
  const parent = win.parent;
  const on = (e: MessageEvent) => {
    if (e.source !== parent) return; // only the shell says which pictures have takes
    if (e.data?.dgn !== 'gen-takes') return;
    const m = acceptFromShell(e, win);
    if (m?.dgn === 'gen-takes') setTakeAssets(m.assets);
  };
  win.addEventListener('message', on);
  return () => {
    win.removeEventListener('message', on);
    slot.__maudeGenTakes = false;
  };
}
