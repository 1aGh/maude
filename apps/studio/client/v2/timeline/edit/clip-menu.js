// client/v2/timeline/edit/clip-menu.js — S7.9: the clip right-click menu as a model (Gate 0 D15, S7-slices Q16).
//
// All 17 items the v1 menu had are kept. Six are drawn as plain rows — what a designer reaches for: comment,
// generate (an AI slate only), adjust, hide / show, remove — and the other eleven sit under Advanced ▸ (the D6
// pattern: nothing deleted, one disclosure down). `show`, `unmute`, `to-storyline` and `replace-layer` are the
// partners of rows that flip with the clip's state; a menu shows the one that applies. Each row is the registry
// action `timeline.clip-menu.<id>` so ⌘K, `?` and the agent surface name the same thing.
//
// No DOM and no handlers: `clipMenuModel` says WHICH rows this clip gets and in what state; edit/clip-menu.jsx
// binds them. The golden order is the order below — `clip-menu-rows.test.ts` pins it.

/** The 17 rows, in menu order. `drawn` = a plain row; the rest are under Advanced ▸. */
export const CLIP_MENU_ROWS = [
  { id: 'comment', drawn: true },
  { id: 'generate', drawn: true },
  { id: 'adjust', drawn: true },
  { id: 'hide', drawn: true },
  { id: 'show', drawn: true },
  { id: 'remove', drawn: true },
  { id: 'replace', drawn: false },
  { id: 'mute', drawn: false },
  { id: 'unmute', drawn: false },
  { id: 'detach-audio', drawn: false },
  { id: 'to-overlay', drawn: false },
  { id: 'to-storyline', drawn: false },
  { id: 'layer-up', drawn: false },
  { id: 'layer-down', drawn: false },
  { id: 'earlier', drawn: false },
  { id: 'later', drawn: false },
  { id: 'replace-layer', drawn: false },
];

/** The registry id of a row. */
export const clipMenuActionId = (id) => `timeline.clip-menu.${id}`;

const NOTE = (label) => ({ id: 'noop', label, disabled: true });

/**
 * The rows this clip gets.
 * @param {{
 *   seq: { series?: boolean, loose?: boolean, hidden?: boolean, mediaSrc?: string, mediaProps?: { muted?: boolean },
 *          placeholder?: { kind?: string }, replaceable?: boolean, layers?: Array<{ kind?: string, mediaCdId?: unknown, mediaArrayRef?: unknown }> },
 *   index: number,                       // the clip's row among all rows
 *   count: number,                       // how many rows there are
 *   has: { comment?: boolean, generate?: boolean, verb?: boolean, replace?: boolean, reorder?: boolean,
 *          hide?: boolean, remove?: boolean, replaceLayer?: boolean },   // which handlers the Timeline was given
 *   rowKind: string,                     // 'video' | 'audio' | 'image' | 'jsx' …
 *   zLadder: { docIdx: number, len: number } | null,   // an overlay clip's place in the layer stack
 *   layerIndex?: number | null,          // a menu opened on one layer of a stacked clip
 * }} p
 * @returns {{ plain: Row[], advanced: Row[] }}
 */
export function clipMenuModel({ seq, index, count, has, rowKind, zLadder, layerIndex = null }) {
  /** @type {Record<string, object>} */
  const rows = {};
  const put = (id, extra = {}) => {
    rows[id] = { id, ...extra };
  };

  if (seq.loose) {
    // A bare media sibling outside every <Sequence> — visible for orientation, but it has no clip identity.
    return { plain: [NOTE('Loose media (no clip wrapper) — edit via /design:edit')], advanced: [] };
  }

  if (layerIndex != null) {
    // A layer (sub-clip) of a stacked clip shares the clip's timing, so only a media replace applies.
    const ly = (Array.isArray(seq.layers) ? seq.layers : [])[layerIndex];
    if (has.replaceLayer && ly && (ly.mediaCdId || ly.mediaArrayRef))
      put('replace-layer', { label: `Replace ${ly.kind}…` });
    const advanced = order(rows).filter((r) => !r.drawn);
    return advanced.length
      ? { plain: [], advanced }
      : { plain: [NOTE('No replaceable media in this layer')], advanced: [] };
  }

  if (has.comment) put('comment', { label: 'Comment on clip…' });
  if (seq.placeholder && has.generate)
    put('generate', { label: `Generate ✨ (${seq.placeholder.kind || 'veo'})` });
  if (has.verb && seq.mediaSrc) {
    if (seq.series) put('to-overlay', { label: 'Move to overlay layer' });
    else put('to-storyline', { label: 'Move to storyline' });
  }
  if (has.verb) {
    put('adjust', { label: 'Adjust… (Speed · Audio · Crop · Grade)' });
    if (seq.mediaProps) {
      if (seq.mediaProps.muted) put('unmute', { label: 'Unmute clip' });
      else put('mute', { label: 'Mute clip' });
      if (rowKind === 'video' && seq.mediaSrc) put('detach-audio', { label: 'Detach audio' });
    }
  }
  if (has.replace && seq.replaceable && !(Array.isArray(seq.layers) && seq.layers.length >= 2))
    put('replace', { label: `Replace ${rowKind}…` });
  if (has.verb && zLadder && zLadder.docIdx >= 0) {
    put('layer-up', { label: 'Move layer up', disabled: zLadder.docIdx >= zLadder.len - 1 });
    put('layer-down', { label: 'Move layer down', disabled: zLadder.docIdx <= 0 });
  }
  if (has.reorder) {
    put('earlier', {
      label: seq.series ? 'Move earlier' : 'Bring forward',
      disabled: seq.series ? index <= 0 : index >= count - 1,
    });
    put('later', {
      label: seq.series ? 'Move later' : 'Send backward',
      disabled: seq.series ? index >= count - 1 : index <= 0,
    });
  }
  if (has.hide)
    put(seq.hidden ? 'show' : 'hide', { label: seq.hidden ? 'Show clip' : 'Hide clip' });
  if (has.remove) put('remove', { label: 'Remove clip', destructive: true });

  const all = order(rows);
  return { plain: all.filter((r) => r.drawn), advanced: all.filter((r) => !r.drawn) };
}

/** Put the rows in golden order and mark which are drawn. */
function order(rows) {
  return CLIP_MENU_ROWS.filter((r) => rows[r.id]).map((r) => ({ ...rows[r.id], drawn: r.drawn }));
}
