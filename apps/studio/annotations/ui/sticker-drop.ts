/**
 * @file       annotations/ui/sticker-drop.ts — a sticker or a stamp follows the pointer, then lands (S4.13)
 * @scope      apps/studio/annotations/ui/sticker-drop.ts
 * @purpose    Pure model behind canvas 15 `an-stk-drop` / `an-stamps` / `an-templates`. The shell sends the
 *             pick down in the messages S4.3 / S4.4 already declared (no new ones):
 *               · `insert-sticker {path, follow, sticker}` — a bundled sticker, uploaded to a project asset;
 *               · `insert-sticker {path:'', follow, sticker:{pack:'stamps', id}}` — a vote stamp (the gallery's
 *                 Stamps row; there is no picture to upload, so `pack: 'stamps'` is the discriminator);
 *               · `insert-template {id, follow}` — a template.
 *             `placementOf` reads one into a `Pending`; the layer then lets it trail the pointer until a click
 *             (`dropSticker` / `stampElement` / `expandTemplate` make what lands). Without `follow` the old
 *             behaviour stays: it lands mid-view at once.
 *             Replace… and Flip are patches on the selected sticker (the spot, the size and the alt text stay).
 */

import { type ImageStroke, STICKER_DROP_SIZE } from '../../annotations-model.ts';

export const STAMPS_PACK = 'stamps';

export type StickerRef = { pack: string; id: string; flip?: boolean };

export type Pending =
  | { kind: 'sticker'; path: string; sticker?: StickerRef; follow: boolean }
  | { kind: 'stamp'; stampKind: string }
  | { kind: 'template'; id: string; follow: boolean };

const WORD = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A sticker identity off the wire / the file (`{pack, id, flip?}`), or undefined when it is not one. */
export function stickerRefOf(v: unknown): StickerRef | undefined {
  const s = v as { pack?: unknown; id?: unknown; flip?: unknown } | null | undefined;
  if (!s || typeof s.pack !== 'string' || typeof s.id !== 'string') return undefined;
  // the gallery names a sticker by its file ("group-46.png"); the board's `sticker.id` is the dot-free stem
  const id = s.id.replace(/\.[A-Za-z0-9]{2,5}$/, '');
  if (!WORD.test(s.pack) || !WORD.test(id)) return undefined;
  return { pack: s.pack, id, ...(s.flip === true ? { flip: true } : {}) };
}

/** What the shell's `insert-sticker` / `insert-template` asks for, or null for anything else. */
export function placementOf(m: unknown): Pending | null {
  const o = m as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (o.dgn === 'insert-template' && typeof o.id === 'string')
    return { kind: 'template', id: o.id, follow: o.follow === true };
  if (o.dgn !== 'insert-sticker') return null;
  const sticker = stickerRefOf(o.sticker);
  if (sticker?.pack === STAMPS_PACK) return { kind: 'stamp', stampKind: sticker.id };
  if (typeof o.path !== 'string' || !o.path) return null;
  return {
    kind: 'sticker',
    path: o.path,
    ...(sticker ? { sticker } : {}),
    follow: o.follow === true,
  };
}

/** The picture a pick makes, STICKER_DROP_SIZE square and centred on `at` (world). */
export function dropSticker(
  pick: { path: string; sticker?: StickerRef },
  at: { x: number; y: number },
  id: string,
  who?: { name?: string; id?: string }
): ImageStroke {
  const size = STICKER_DROP_SIZE;
  return {
    id,
    tool: 'image',
    x: at.x - size / 2,
    y: at.y - size / 2,
    w: size,
    h: size,
    href: pick.path,
    ...(pick.sticker ? { sticker: pick.sticker } : {}),
    ...(who?.name ? { authorName: who.name, ...(who.id ? { authorId: who.id } : {}) } : {}),
  };
}

/** A sticker from the gallery (not a pasted picture): the only kind Replace… and Flip are offered on. */
export function isGallerySticker(s: unknown): s is ImageStroke & { sticker: StickerRef } {
  const i = s as ImageStroke | null | undefined;
  return !!i && i.tool === 'image' && !!stickerRefOf(i.sticker);
}

/** Replace…: another picture in the same place at the same size; a mirrored sticker stays mirrored. */
export function replacePatch(
  old: ImageStroke,
  pick: { path: string; sticker?: StickerRef }
): Partial<ImageStroke> {
  const flip = old.sticker?.flip === true;
  const sticker = pick.sticker ? { ...pick.sticker, ...(flip ? { flip: true } : {}) } : undefined;
  return { href: pick.path, sticker } as Partial<ImageStroke>;
}

/** Flip: mirror about its own centre; null when it has no gallery identity to carry the flag. */
export function flipPatch(old: ImageStroke): Partial<ImageStroke> | null {
  if (!isGallerySticker(old)) return null;
  const { flip, ...rest } = old.sticker;
  return { sticker: flip ? rest : { ...rest, flip: true } } as Partial<ImageStroke>;
}

/** "160 × 160" - the chip under a selected sticker. */
export function sizeLabel(s: { w: number; h: number }): string {
  return `${Math.round(Math.abs(s.w))} × ${Math.round(Math.abs(s.h))}`;
}
