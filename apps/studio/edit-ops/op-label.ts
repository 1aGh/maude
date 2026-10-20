// edit-ops/op-label.ts — S2.24 G3: the words an edit-op's undo step carries.
//
// 14 `ed-edge-undo` names each step by what it did ("Headline text", "Moved See pricing 10 px"); a write the
// person made used to read "Edit canvas" for every op, because only a handful of ops (the artboard copies, the
// trash) said anything. One table, keyed by the op id (= the registry action id), builds the line from the op's
// params and its targets' names; an op without a row falls back to its registry label, never to "Edit canvas".

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { presetById } from '../kinds/presets.ts';
import { safeZonePreset } from '../kinds/safe-zones.ts';
import type { ElementRef } from './types.ts';

type Say = (n: string, p: Record<string, unknown>, count: number) => string;

/** A readable authored id ("see-pricing", "rectangle-2") as words; anything generated is "this object". */
export function nameOf(id: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(id) || /^[0-9a-f]{8}$/.test(id)) return '';
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "See pricing" for one target, "3 objects" for several, "an object" for none we can name. */
export function targetsName(targets: readonly ElementRef[]): string {
  if (targets.length > 1) return `${targets.length} objects`;
  const only = targets[0];
  return (only && nameOf(only.element)) || 'an object';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const ROWS: Readonly<Record<string, Say>> = {
  'object.frame': (n) => `Framed ${n}`,
  'object.unframe': (n) => `Unframed ${n}`,
  'object.bring-front': (n) => `Brought ${n} to front`,
  'object.bring-forward': (n) => `Brought ${n} forward`,
  'object.send-backward': (n) => `Sent ${n} backward`,
  'object.send-back': (n) => `Sent ${n} to back`,
  'object.lock': (n, p) => `${p.locked === false ? 'Unlocked' : 'Locked'} ${n}`,
  'object.hide': (n, p) => `${p.hidden === false ? 'Showed' : 'Hid'} ${n}`,
  'element.set-id': (n, p) => (str(p.id) ? `Renamed ${n} to ${str(p.id)}` : `Renamed ${n}`),
  'element.stamp': (n) => `Named ${n} so an arrow can point at it`,
  'align.left': (n) => `Aligned ${n} to the left`,
  'align.hcentre': (n) => `Centred ${n} across`,
  'align.right': (n) => `Aligned ${n} to the right`,
  'align.top': (n) => `Aligned ${n} to the top`,
  'align.vmiddle': (n) => `Centred ${n} down`,
  'align.bottom': (n) => `Aligned ${n} to the bottom`,
  'distribute.h': (n) => `Spread ${n} evenly across`,
  'distribute.v': (n) => `Spread ${n} evenly down`,
  'object.rotate': (n) => `Rotated ${n}`,
  'artboard.resize': (n, p) =>
    typeof p.width === 'number' ? `Resized ${n} to ${Math.round(p.width)} px wide` : `Resized ${n}`,
  'artboard.duplicate': (n) => `Duplicated ${n}`,
  'artboard.duplicate-at-width': (n) => `Duplicated ${n} at another width`,
  'artboard.set-safe-zones': (_n, p) => {
    const hit = safeZonePreset(p.preset);
    return hit ? `Safe zones: ${hit.label}` : 'Removed safe zones';
  },
  'artboard.convert-kind': (n, p) =>
    `Changed ${n} to ${typeof p.paper === 'string' ? p.paper.toUpperCase() : 'print'} print`,
  'artboard.set-print': (n, p) => {
    if (typeof p.paper === 'string') return `Set ${n} to ${p.paper.toUpperCase()}`;
    if (Array.isArray(p.sizeMm)) return `Resized ${n} to ${p.sizeMm[0]} × ${p.sizeMm[1]} mm`;
    if (p.orientation === 'landscape' || p.orientation === 'portrait')
      return `Turned ${n} ${p.orientation}`;
    if (p.bleedMm !== undefined) return `Set bleed on ${n} to ${p.bleedMm} mm`;
    if (p.marginMm !== undefined) return `Set safe margin on ${n} to ${p.marginMm} mm`;
    return `Changed print settings on ${n}`;
  },
  'artboard.set-print-guides': (n, p) =>
    p.visible === null
      ? `${n} follows View for print guides`
      : `Print guides ${p.visible ? 'on' : 'off'} for ${n}`,
  'artboard.set-guides': (n, p) =>
    p.guides === null ? `Removed guides from ${n}` : `Set guides on ${n}`,
  'object.place-freely': (n) => `Placed ${n} freely`,
  'object.constrain': (n) => `Pinned ${n}`,
  'object.reorder-earlier': (n) => `Moved ${n} earlier`,
  'object.reorder-later': (n) => `Moved ${n} later`,
  'object.reorder-to': (n) => `Moved ${n} to a new place`,
  'layout.set-gap': (n) => `Changed the gap in ${n}`,
  'element.set-link': (n) => `Linked ${n}`,
  'element.clear-link': (n) => `Removed the link from ${n}`,
  'artboard.trash': (n) => `Moved ${n} to the trash`,
  'text.set': (n) => `${cap(n)} text`,
  'text.set-language': (n) => `Set the language of ${n}`,
  'text.set-case': (n) => `Changed the case of ${n}`,
  'text.use-style': (n) => `Gave ${n} a text style`,
  'text.reset-style': (n) => `Reset the text style of ${n}`,
  'text.detach-style': (n) => `Detached the text style of ${n}`,
  'object.insert-shape': (_n, p) => {
    const kind = str(p.kind);
    return kind === 'frame' ? 'Drew a frame' : kind ? `Drew a ${kind}` : 'Drew a shape';
  },
  'artboard.draw': () => 'Drew an artboard',
  'artboard.insert-preset': (_n, p) => {
    const preset = presetById(p.presetId);
    return preset ? `Added ${preset.label}` : 'Added an artboard';
  },
  'object.set-corner-radius': (n) => `Rounded the corners of ${n}`,
  'object.insert-path': () => 'Drew a path',
  'path.edit': () => 'Edited a path',
  'shape.combine.union': () => 'Combined shapes (union)',
  'shape.combine.subtract': () => 'Combined shapes (subtract)',
  'shape.combine.intersect': () => 'Combined shapes (intersect)',
  'shape.combine.exclude': () => 'Combined shapes (exclude)',
  'asset.relink': () => 'Relinked a picture',
  'component.insert': () => 'Placed a component',
  'image.place': () => 'Placed a picture',
  'image.replace': () => 'Replaced a picture',
  'image.crop': () => 'Cropped a picture',
  'photo.use-edit': () => 'Edited this use of a photo',
  'photo.every-use': () => 'Applied a photo edit to every use',
  'component.swap-variant': (n) => `Swapped the variant of ${n}`,
  'component.reset': (n) => `Reset ${n} to its component`,
  'component.detach': (n) => `Detached ${n} from its component`,
};

/**
 * The history line of one op: from the op id, its params and its targets. Never empty, never "Edit canvas":
 * an op without a row says what its registry action is called.
 */
export function opLabel(
  op: string,
  params: Record<string, unknown> | undefined,
  targets: readonly ElementRef[]
): string {
  const row = ROWS[op];
  // an artboard op names its board in `params.artboard` and has no targets
  const board = typeof params?.artboard === 'string' ? params.artboard : '';
  const name =
    targets.length === 0 && board ? nameOf(board) || 'an artboard' : targetsName(targets);
  if (row) return row(name, params ?? {}, targets.length);
  const registry = ACTIONS_BY_ID.get(op as never)?.label;
  if (registry) return registry;
  const tail = op.split('.').pop() ?? op;
  return cap(tail.replace(/-/g, ' '));
}

/**
 * S2.25 G2 — the history line of a move that went through the CSS writer (a keyboard nudge, a drag of an
 * out-of-flow element): "Moved See pricing 10 px"; both axes say which way ("10 px right, 4 px down").
 * `id` is the element's authored id — a generated one reads "an object".
 */
export function moveLabel(id: string, dx: number, dy: number): string {
  const name = nameOf(id) || 'an object';
  const x = Math.round(Math.abs(dx));
  const y = Math.round(Math.abs(dy));
  if (x && y) {
    return `Moved ${name} ${x} px ${dx < 0 ? 'left' : 'right'}, ${y} px ${dy < 0 ? 'up' : 'down'}`;
  }
  return `Moved ${name} ${x || y} px`;
}
