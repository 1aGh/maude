// edit-ops/insert-preset.ts — S7.20 `artboard.insert-preset` (08 `ak-picker`: "Pick a tile and the artboard lands on
// the dashed outline"). The F size picker's tile, ⌘K "New video" and an agent's "add an A5 print" all end here: ONE
// write that adds a whole artboard of the preset's KIND, so the kind is never a second step.
//
//   params { presetId: string, at?: { x, y }, custom?: { widthMm, heightMm, bleedMm? } }
//
//   presetId   a row of kinds/presets.ts (the one catalogue). `print-custom` takes `custom` ({ widthMm, heightMm, bleedMm?, marginMm? }) and writes
//              `print={{ paper: <nearest larger preset>, orientation, sizeMm: [w, h], bleedMm }}` — never
//              `paper: "custom"` (Q7, kinds/print-custom.ts).
//   at         where the artboard lands, in world px (the layout lane, like `artboard.draw`). Absent = the
//              runtime's default grid slot.
//
// What lands, by kind (all plain TSX a v1 peer reads as it reads any artboard):
//   digital  <DCArtboard id label kind="digital" fixed width height>
//   web      <DCArtboard id label kind="web" width height>       height is the hug floor
//   print    <DCArtboard id label kind="print" print={{…}} width height>   px = trim + 2 × bleed
//   video    <DCArtboard id label kind="video" width height> + <VideoComp component={VideoCut} …/> (30 fps, 5 s)
//
// The id is a readable slug of the label ("fb-event-cover"), the label gets " 2", " 3" when taken. `created` names
// the new artboard as its own element ref; `detail` says what it is, so a toast can say it in a line.
//
// Same result by hand: `canvas-tsx.md` § "Add an artboard of a kind".

import {
  applyInsertArtboard,
  applySetArtboardKind,
  applySetArtboardPrint,
  CanvasEditError,
} from '../canvas-edit.ts';
import { applyEnsureVideoComp } from '../clip-ops.ts';
import { walkIdElements } from '../element-ids.ts';
import {
  type ArtboardSpec,
  CUSTOM_PRINT_ID,
  customSpec,
  presetById,
  specOf,
} from '../kinds/presets.ts';
import { refuse } from './constraints.ts';
import { artboardLabels, copyName } from './duplicate-at-width.ts';
import { isCoord } from './layout-patch.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** "FB event cover" → "fb-event-cover"; must start with a letter (the artboard id rule). */
export function slugOf(label: string): string {
  const s = label
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return /^[a-z]/.test(s) ? s : `artboard-${s || 'new'}`.slice(0, 56);
}

function freshId(label: string, taken: ReadonlySet<string>): string {
  const base = slugOf(label);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The spec a request names, or a refusal in the canvas's words. */
function specFor(req: ResolvedEditOp): ArtboardSpec {
  const id = req.params.presetId;
  if (id === CUSTOM_PRINT_ID) {
    const c = req.params.custom;
    if (!isRec(c)) return refuse(req, 'Give the custom size in millimetres.', '');
    const r = customSpec({
      widthMm: Number(c.widthMm),
      heightMm: Number(c.heightMm),
      ...(c.bleedMm === undefined ? {} : { bleedMm: Number(c.bleedMm) }),
      ...(c.marginMm === undefined ? {} : { marginMm: Number(c.marginMm) }),
    });
    return r.ok ? r.spec : refuse(req, r.message, '');
  }
  const p = presetById(id);
  if (!p) return refuse(req, 'That size is not one of the presets.', '');
  return specOf(p);
}

export const artboardInsertPreset: EditOp = {
  id: 'artboard.insert-preset',
  apply(source, req) {
    const spec = specFor(req);
    let at: { x: number; y: number } | null = null;
    if (req.params.at !== undefined && req.params.at !== null) {
      const a = req.params.at;
      if (!isRec(a) || !isCoord(a.x) || !isCoord(a.y))
        return refuse(req, 'That position is not on the canvas.', '');
      at = { x: Math.round(a.x), y: Math.round(a.y) };
    }
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return refuse(req, 'This canvas does not parse; fix it before editing.', '');
    const ids = new Set(
      walk.elements
        .filter((e) => e.tag === 'DCArtboard' && e.artboard)
        .map((e) => e.artboard as string)
    );
    const labels = new Set(artboardLabels(source).values());
    const label = labels.has(spec.label) ? copyName(spec.label, labels) : spec.label;
    const id = freshId(label, ids);

    let out: string;
    try {
      out = applyInsertArtboard(req.file, source, {
        id,
        label,
        width: spec.width,
        height: spec.height,
      }).source;
      out = applySetArtboardKind(req.file, out, id, spec.kind).source;
      if (spec.fixed) {
        // `fixed`: the preset's height is the height (not a floor the content may grow past)
        const tag = new RegExp(`<DCArtboard\\b[^>]*\\bid="${id}"[^>]*?(?=>)`).exec(out);
        if (tag && !/\bfixed\b/.test(tag[0])) {
          const end = (tag.index ?? 0) + tag[0].length;
          out = `${out.slice(0, end)} fixed${out.slice(end)}`;
        }
      }
      if (spec.print) out = applySetArtboardPrint(req.file, out, id, spec.print).source;
      if (spec.kind === 'video') {
        const comp = applyEnsureVideoComp(req.file, out, id);
        if (!comp)
          return refuse(req, 'The video artboard could not be made; nothing was written.', '');
        out = comp.source;
      }
    } catch (err) {
      if (err instanceof CanvasEditError) return refuse(req, err.message, '');
      throw err;
    }
    return {
      source: out,
      created: [{ artboard: id, element: id }],
      detail: {
        artboard: id,
        kind: spec.kind,
        label,
        width: spec.width,
        height: spec.height,
      },
      ...(at ? { layout: { set: [{ id, x: at.x, y: at.y }] } } : {}),
      action: { kind: 'edit', label: `Added ${label}` },
    };
  },
};
