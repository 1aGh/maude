// client/v2/photo/looks.js — S8.15: the Photo section's words over a v1 PhotoEdit (12 · ia-photo-inspector).
//
//   Looks     Original · Brighter · Warmer · Cooler · Punchy · Mono · Club green · Night — each a fixed set of
//             look-owned fields (adjustments brightness / contrast / hue / sepia / grayscale, and duotone).
//   Light     −100 … +100 ↔ adjustments.exposure (−1 … 1).
//   Colour    −100 … +100 ↔ adjustments.saturation (−1 … 1).
//
// The three never share a field, so a slider never moves the look away and a look never resets a slider:
// `lookOf(edit)` reads the look-owned fields only. Everything else on the edit (grain, pattern, mask, the
// background cut-out, version, source) belongs to Advanced and passes through untouched. Every edit these
// functions return is a plain v1 PhotoEdit (photo/schema.ts) — no new keys, so a v1 peer reads it as-is.
// Pure: no DOM, no fetch.

/** The adjustment fields a look owns. */
const LOOK_ADJ = Object.freeze(['brightness', 'contrast', 'hue', 'sepia', 'grayscale']);
/** Slider → the adjustment it owns. */
const SLIDER_FIELD = Object.freeze({ light: 'exposure', colour: 'saturation' });

/** The eight looks, in the order the grid shows them (CONTRACT words). `edit` holds only look-owned fields. */
export const LOOKS = Object.freeze([
  { id: 'original', label: 'Original', edit: {} },
  { id: 'brighter', label: 'Brighter', edit: { adjustments: { brightness: 0.18 } } },
  { id: 'warmer', label: 'Warmer', edit: { adjustments: { sepia: 0.35 } } },
  { id: 'cooler', label: 'Cooler', edit: { adjustments: { hue: 18, brightness: 0.02 } } },
  { id: 'punchy', label: 'Punchy', edit: { adjustments: { contrast: 0.25, brightness: 0.04 } } },
  { id: 'mono', label: 'Mono', edit: { adjustments: { grayscale: 1 } } },
  {
    id: 'club-green',
    label: 'Club green',
    edit: { duotone: { enabled: true, colorA: '#0b2418', colorB: '#a8f0c0', intensity: 1 } },
  },
  { id: 'night', label: 'Night', edit: { adjustments: { brightness: -0.3, contrast: 0.15 } } },
]);

const EPS = 1e-6;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clone = (o) => (o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : {});

/** A duotone that draws anything (enabled and with intensity above zero). */
const duoOn = (d) => !!d?.enabled && (isNum(d.intensity) ? d.intensity : 1) > EPS;

function sameDuo(a, b) {
  const on = duoOn(a);
  if (on !== duoOn(b)) return false;
  if (!on) return true;
  const hex = (v) => String(v ?? '').toLowerCase();
  return (
    hex(a.colorA) === hex(b.colorA) &&
    hex(a.colorB) === hex(b.colorB) &&
    Math.abs((isNum(a.intensity) ? a.intensity : 1) - (isNum(b.intensity) ? b.intensity : 1)) < EPS
  );
}

/** The look whose fields the edit carries: its id, or null when the edit is one of its own ("custom"). */
export function lookOf(edit) {
  const adj = edit?.adjustments ?? {};
  for (const look of LOOKS) {
    const want = look.edit.adjustments ?? {};
    const adjOk = LOOK_ADJ.every((k) => {
      const have = isNum(adj[k]) ? adj[k] : 0;
      const need = isNum(want[k]) ? want[k] : 0;
      return Math.abs(have - need) < EPS;
    });
    if (adjOk && sameDuo(edit?.duotone, look.edit.duotone)) return look.id;
  }
  return null;
}

/** Drop empty `adjustments` / `duotone` so a neutral edit serializes back to `{}`. */
function tidy(e) {
  if (e.adjustments) {
    for (const [k, v] of Object.entries(e.adjustments))
      if (!isNum(v) || v === 0) delete e.adjustments[k];
    if (!Object.keys(e.adjustments).length) delete e.adjustments;
  }
  if (e.duotone && !Object.keys(e.duotone).length) delete e.duotone;
  return e;
}

/** `edit` with look `id` applied: its look-owned fields replaced, sliders and Advanced kept. */
export function withLook(edit, id) {
  const look = LOOKS.find((l) => l.id === id);
  if (!look) return clone(edit);
  const next = clone(edit);
  const adj = next.adjustments ?? {};
  for (const k of LOOK_ADJ) delete adj[k];
  Object.assign(adj, look.edit.adjustments ?? {});
  next.adjustments = adj;
  if (look.edit.duotone) next.duotone = { ...look.edit.duotone };
  else delete next.duotone;
  return tidy(next);
}

/** A slider's value, −100 … +100 (whole numbers). */
export function sliderOf(edit, slider) {
  const v = edit?.adjustments?.[SLIDER_FIELD[slider]];
  return isNum(v) ? Math.round(Math.max(-1, Math.min(1, v)) * 100) : 0;
}

/** `edit` with a slider set to `n` (−100 … +100); 0 removes the field. */
export function withSlider(edit, slider, n) {
  const field = SLIDER_FIELD[slider];
  const next = clone(edit);
  if (!field) return next;
  const v = Math.max(-100, Math.min(100, Math.round(Number(n) || 0)));
  next.adjustments = { ...(next.adjustments ?? {}) };
  if (v === 0) delete next.adjustments[field];
  else next.adjustments[field] = v / 100;
  return tidy(next);
}

/** "+12", "−8", "0" — the slider's value as the inspector says it. */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Is the background cut-out on? (`backgroundRemoved.enabled` with a mask). */
export const cutOutOn = (edit) =>
  !!edit?.backgroundRemoved?.enabled && !!edit?.backgroundRemoved?.maskAsset;

/** `edit` with the cut-out switched; a mask that was made stays so On brings it back. */
export function withCutOut(edit, on, maskAsset) {
  const next = clone(edit);
  const mask = maskAsset ?? next.backgroundRemoved?.maskAsset;
  if (!mask) {
    delete next.backgroundRemoved;
    return next;
  }
  next.backgroundRemoved = { enabled: !!on, maskAsset: mask };
  return next;
}
