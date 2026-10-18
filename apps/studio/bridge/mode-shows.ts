// bridge/mode-shows.ts — S3.12: "what each mode shows", as DATA (V2-1.2 §5.4 table, 04 md-model, A8 applied).
//
// PURE (no DOM, no React). One row per line of the contract's table, one cell per mode. A consumer asks
// `modeCell(row, mode, present)` / `modeShows(mode, item)` instead of comparing a mode itself; the shell and
// the canvas both read it, so the two cannot disagree (test/mode-shows.test.ts also fails when a listed
// consumer branches on a mode literal outside this table).
//
// The five columns are `ModeKey`: Present splits by its spec (Artboards · Canvas) because the table does.
//
// `null` mode is an ungoverned canvas (no `set-mode` yet — a standalone canvas, a DS specimen): it keeps v1's
// behaviour (see `modeShows`), the table does not apply.

import type { CanvasModeV2, ModeCaps, PresentSpec } from './canvas-modes.ts';

export const MODE_KEYS = [
  'edit',
  'preview',
  'present-artboards',
  'present-canvas',
  'viewing',
] as const;
export type ModeKey = (typeof MODE_KEYS)[number];

/** The table column a (mode, Present spec) pair lands in. Present without a spec is Present · Canvas. */
export function modeKey(
  mode: CanvasModeV2,
  present?: Pick<PresentSpec, 'kind'> | null | undefined
): ModeKey {
  if (mode === 'present')
    return present?.kind === 'artboards' ? 'present-artboards' : 'present-canvas';
  return mode;
}

type Row<V extends string> = Readonly<Record<ModeKey, V>>;
const row = <V extends string>(
  edit: V,
  preview: V,
  presentArtboards: V,
  presentCanvas: V,
  viewing: V
): Row<V> =>
  Object.freeze({
    edit,
    preview,
    'present-artboards': presentArtboards,
    'present-canvas': presentCanvas,
    viewing,
  });

/**
 * The table. Cell words are the contract's (V2-1.2 §5.4 "What each mode shows" + 04 md-model's extra rows).
 * Order here is the order of the rows on the canvas.
 */
export const MODE_SHOWS = Object.freeze({
  /** What a click on the design does. */
  clicks: row('tool', 'live', 'next-artboard', 'pan-zoom', 'specs'),
  /** Which toolbar: Edit's, Preview's (annotation tools only), none, or Viewing's (Hand + Comment). */
  toolbar: row('edit', 'preview', 'none', 'none', 'viewing'),
  /** The annotation layer: quiet (faded paper, click-through), drawn (editable), hidden, read-only. */
  annotations: row('quiet', 'drawn', 'hidden', 'hidden', 'read-only'),
  'comment-pins': row('shown', 'shown', 'hidden', 'hidden', 'shown'),
  /** ⌥-hover distance. */
  measure: row('on', 'on', 'off', 'off', 'on'),
  /** A8 — what an AI write does on the canvas: `held` only in Present · Artboards. */
  'ai-changes': row('live', 'live', 'held', 'live-unmarked', 'live'),
  /** Shell: the Canvases (left) panel. */
  'left-panels': row('shown', 'folded', 'hidden', 'hidden', 'shown'),
  /** Shell: the AI chat panel (C30: a viewing role has none). */
  'ai-panel': row('shown', 'folded', 'hidden', 'hidden', 'none'),
  /** Shell: the Share cluster. `compact` = faces + status step aside; `full-access` = full, with the access word. */
  'share-cluster': row('full', 'compact', 'hidden', 'hidden', 'full-access'),
  /** The specs surface: the docked Inspector on a selection (Edit), the read-only Inspect panel on a ⌘-click /
   *  click, none in Present. */
  inspect: row('inspector', 'panel-on-cmd-click', 'hidden', 'hidden', 'panel-on-click'),
  /** The project menu's form. Present reaches it with esc first. */
  'project-menu': row('pill', 'folded-pill', 'esc-first', 'esc-first', 'pill'),
  /** What esc does (the ladder itself is `esc-ladder.ts`; this is the table's last line). */
  esc: row('steps-back', 'back-to-edit', 'settles-back', 'same-view', 'deselect'),
} as const);

export type ShowRow = keyof typeof MODE_SHOWS;
export type ShowCell<R extends ShowRow> = (typeof MODE_SHOWS)[R][ModeKey];

/** One cell. Viewing's base differs for an editor (their base is Edit): ask with the mode the canvas is in. */
export function modeCell<R extends ShowRow>(
  row: R,
  mode: CanvasModeV2,
  present?: Pick<PresentSpec, 'kind'> | null
): ShowCell<R> {
  return MODE_SHOWS[row][modeKey(mode, present)] as ShowCell<R>;
}

/**
 * Viewing's toolbar is Hand (+ Comment with `caps.comment`); Can view sees none (04 md-edge-viewer).
 * Everything else is the table's cell.
 */
export function toolbarOf(
  mode: CanvasModeV2,
  caps: Pick<ModeCaps, 'comment'>,
  present?: Pick<PresentSpec, 'kind'> | null
): 'edit' | 'preview' | 'viewing' | 'none' {
  const cell = modeCell('toolbar', mode, present);
  return cell === 'viewing' && !caps.comment ? 'none' : cell;
}

// ─── boolean questions, the shape consumers actually ask ─────────────────────────────────────────
//
//   measure        ⌥-hover distance (Edit, Preview, Viewing; never Present).
//   inspect-panel  the read-only specs panel (client/v2/inspect): Preview after a ⌘-click, Viewing on a click.
//   comment-pins   pins on the canvas.
//   object-tools   Edit's object gestures: select/move/resize, the link chip, ⌘G ⌘D ] [ … (the OBJECT's chords).
//   live-design    the design behaves as itself — Preview follows links, plays video, runs hovers.
//   annotations-editable  the annotation layer takes new marks (Preview).
//   chrome         any shell chrome at all (Present hides it all, DDR-117).

export type ModeShowItem =
  | 'measure'
  | 'inspect-panel'
  | 'comment-pins'
  | 'object-tools'
  | 'live-design'
  | 'annotations-editable'
  | 'chrome';

const ITEMS: Readonly<
  Record<ModeShowItem, (mode: CanvasModeV2, present?: Pick<PresentSpec, 'kind'> | null) => boolean>
> = Object.freeze({
  measure: (m, p) => modeCell('measure', m, p) === 'on',
  'inspect-panel': (m, p) => modeCell('inspect', m, p).startsWith('panel'),
  'comment-pins': (m, p) => modeCell('comment-pins', m, p) === 'shown',
  'object-tools': (m, p) => modeCell('clicks', m, p) === 'tool',
  'live-design': (m, p) => modeCell('clicks', m, p) === 'live',
  'annotations-editable': (m, p) => modeCell('annotations', m, p) === 'drawn',
  chrome: (m, p) => modeCell('share-cluster', m, p) !== 'hidden',
});

/**
 * Does `mode` show `item`? `null`/`undefined` is an ungoverned canvas — v1's behaviour: measure, pins, live
 * design and object tools are on (a standalone canvas never had a mode), the shell-only panel is not a canvas
 * matter.
 */
export function modeShows(
  mode: CanvasModeV2 | null | undefined,
  item: ModeShowItem,
  present?: Pick<PresentSpec, 'kind'> | null
): boolean {
  if (!mode) return item === 'measure' || item === 'comment-pins' || item === 'object-tools';
  return ITEMS[item](mode, present);
}

/**
 * A8 — is an AI write held right now? (`holdsModuleUpdates` in canvas-modes.ts is this, for the HMR
 * applier's inline copy to be pinned against.)
 */
export const holdsAiChanges = (
  mode: CanvasModeV2,
  present?: Pick<PresentSpec, 'kind'> | null
): boolean => modeCell('ai-changes', mode, present) === 'held';

/** Preview folds the Canvases / AI chat panels to their corner icons; no other mode does (Present hides). */
export const foldsPanels = (
  mode: CanvasModeV2,
  present?: Pick<PresentSpec, 'kind'> | null
): boolean => modeCell('left-panels', mode, present) === 'folded';
