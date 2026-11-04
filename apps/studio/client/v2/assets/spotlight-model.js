// client/v2/assets/spotlight-model.js — the pure half of the asset spotlight (2.0.4, issue #191).
//
// A double-click on an Assets tile opens its picture, clip or sound large. Which tiles ← → walks, what the window says
// about the file and which rows it offers are decided here; the window itself is spotlight.jsx.

import { GROUP_CAP } from './library-foot.js';
import { sizeWords } from './tile.jsx';

/** The words the window uses (CONTRACT §3/§4: what happened · what is safe · one verb). */
export const SPOTLIGHT_WORDS = {
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
  noPreview: 'This file has no preview.',
  failed: 'This picture could not be shown.',
  /** "3 of 12" — a screen reader hears it as the position. */
  position: (i, n) => `${i + 1} of ${n}`,
  /** the dialog's name for a screen reader when the file has none */
  fallbackName: 'Asset',
};

/** @returns {'image' | 'video' | 'audio' | 'file'} how the window draws it */
export function previewKind(asset) {
  const k = asset?.kind;
  return k === 'image' || k === 'video' || k === 'audio' ? k : 'file';
}

/** Step `delta` along a list of `n`: stops at the ends (the arrows disable there), never wraps. */
export function stepIndex(index, delta, n) {
  if (!(n > 0)) return -1;
  const to = index + delta;
  return to < 0 || to >= n ? index : to;
}

/** The file's own folder + name, with no leading slash ("assets/9f2a.jpg"; a design-system file is "…/system/club/…"). */
export function pathWords(asset) {
  return String(asset?.rel || asset?.path || '').replace(/^\/+/, '');
}

/** One line under the picture: its size ("2.3 MB"), or nothing when the studio did not say. */
export function sizeLine(asset) {
  return Number(asset?.size) > 0 ? sizeWords(asset.size) : '';
}

/**
 * The rows the tile already offers (tile-menu.jsx `tileMenuItems`) that fit a window over the picture. Move to trash is
 * left in the menu: a bigger look is not the place to remove a file.
 */
export function spotlightRows(menuItems) {
  return (menuItems || []).filter((it) => !it.separator && it.id !== 'trash');
}

/**
 * Which tiles of a group the narrow tab draws: all of them for Just added, Generated and a search, the first `GROUP_CAP`
 * for a plain Photos / Video / Sound group — unless the Not used view lists everything to tidy.
 */
export function groupShown(group, { uncapped = false } = {}) {
  if (group.kind === 'added' || group.kind === 'generated' || group.kind === 'found' || uncapped)
    return group.items;
  return group.items.slice(0, GROUP_CAP);
}

/** The paths ← → walks in the narrow tab, in the order the tab draws them (the "Seen in the picture" group first). */
export function narrowOrder(groups, seen, { uncapped = false } = {}) {
  const out = [];
  const take = (p) => {
    if (!out.includes(p)) out.push(p);
  };
  for (const s of seen || []) take(s.asset.path);
  for (const g of groups || []) for (const a of groupShown(g, { uncapped })) take(a.path);
  return out;
}
