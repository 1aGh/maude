// client/v2/photo/photo-section.jsx — S8.15: the Inspector's Photo tab for ONE use of a picture (12 Import and Assets,
// ia-photo-inspector · ia-photo-steps; CONTRACT §7 "edits apply to this use").
//
//   Look       Original · Brighter · Warmer · Cooler · Punchy · Mono · Club green · Night (looks.js)
//   Light · Colour, ✦ Remove background → "Background removed" switch, Replace…, Reset
//   Only this use changes   "<file> is in N more canvases — they keep the original. Reset brings this one back too."
//                           + "Apply to every use…" (apply-every-use-sheet.jsx, driven by GET /_api/photo-every-use)
//   › Advanced (sliders · grain · mask)   every D16 knob: the v1 PhotoKnobs, controlled — its changes land here too.
//
// Seed: the use's own edit (`GET /_api/photo-edit?asset&edit=<data-photo-edit>`), else the every-use edit
// (`GET ?asset`), so the panel starts from what the use shows. A change previews on THIS use at once
// (`onPreview(edit, use)` → dgn `photo-preview {use}`) and, when committed, lands in two writes: the content-addressed
// per-use file (`PUT /_api/photo-edit?asset&perUse=1`, which answers its name) and then registry `photo.use-edit`
// through its server, `POST /_api/edit-op` (one undo step: `data-photo-edit="<edit8>"` on the picture). Reset is the
// same op with `edit: null` — the use shows the every-use look again. Nothing here writes the every-use file: that is
// the sheet's explicit choice. Every file written is a plain v1 PhotoEdit, so a v1 peer renders the every-use look and
// keeps the attribute.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Segmented, Slider, Toggle } from '../../inspector-controls.jsx';
import { PhotoKnobs } from '../../photo-knobs.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { bindInspectorActions } from '../inspector/inspector-actions.js';
import { askCrop, fitOf } from '../inspector/kinds/image.jsx';
import { ApplyEveryUseSheet } from './apply-every-use-sheet.jsx';
import { sameCanvas } from './canvas-rel.js';
import {
  cutOutOn,
  LOOKS,
  lookOf,
  signed,
  sliderOf,
  withCutOut,
  withLook,
  withSlider,
} from './looks.js';

export const PHOTO_WORDS = Object.freeze({
  chip: 'Photo',
  placement: 'Placement',
  cropLine: 'The whole photo stays — only the frame moves.',
  look: 'Look',
  light: 'Light',
  colour: 'Colour',
  removeBg: 'Remove background',
  removing: 'Removing background…',
  removed: 'Background removed',
  removeFailed: 'Background not removed; try again.',
  replace: 'Replace…',
  reset: 'Reset',
  scopeHead: 'Only this use changes',
  everyUse: 'Apply to every use…',
  advancedHint: 'sliders · grain · mask',
  failed: 'Not changed; try again.',
});

const PLACEMENTS = Object.freeze([
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'crop', label: 'Crop' },
]);

/**
 * Placement · Fill · Fit · Crop (12 · ia-photo-inspector: the first row under the file's name). The same `image.crop`
 * edit-op as the Image tab's Fit row, asked of the canvas through `run-action`; Crop says what it does to the photo.
 */
function PlacementRow({ el, editable, onRunAction }) {
  const [asked, setAsked] = useState(null);
  const fresh = `${el?.id ?? ''}#${el?.index ?? 0}~${JSON.stringify(el?.authored ?? null)}~${JSON.stringify(el?.attrs ?? null)}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a fresh selection payload only
  useEffect(() => setAsked(null), [fresh]);
  // a refused write never re-posts: give the control back to the file after a moment
  useEffect(() => {
    if (!asked) return undefined;
    const t = setTimeout(() => setAsked(null), 2500);
    return () => clearTimeout(t);
  }, [asked]);
  const fit = asked ?? fitOf(el);
  const can = editable && !!el?.id && typeof onRunAction === 'function';
  return (
    <>
      <div className="ph-row ph-place" data-testid="photo-placement">
        <span>{PHOTO_WORDS.placement}</span>
        <span data-testid="photo-ctl-placement">
          <Segmented
            value={fit}
            ariaLabel={PHOTO_WORDS.placement}
            options={PLACEMENTS}
            onChange={(next) => {
              if (can && next !== fit && askCrop({ onRunAction }, el, { fit: next }))
                setAsked(next);
            }}
          />
        </span>
      </div>
      {fit === 'crop' ? (
        <p className="ph-quiet" data-testid="photo-crop-line">
          {PHOTO_WORDS.cropLine}
        </p>
      ) : null}
    </>
  );
}

/** The scope line under "Only this use changes". */
export function scopeLine(name, more) {
  if (more > 0)
    return `${name} is in ${more} more ${more === 1 ? 'canvas' : 'canvases'} — they keep the original. Reset brings this one back too.`;
  return `Other uses of ${name} keep the original. Reset brings this one back too.`;
}

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This object is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
};

/** dgn `photo-preview`: `use` (the picture's `data-cd-id`) previews that one use; without it, every use. */
export const photoPreviewMessage = (asset, edit, use) => ({
  dgn: 'photo-preview',
  asset,
  edit: edit ?? null,
  ...(typeof use === 'string' && use ? { use } : {}),
});

const EDIT8 = /^[0-9a-f]{8,16}$/;
const clone = (o) => (o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : {});
export const fileNameOf = (asset) =>
  String(asset ?? '')
    .split('/')
    .pop() || '';
/** The use's own edit name (`data-photo-edit`), when it is one this project keeps. */
export const ownEditOf = (el) => {
  const v = el?.attrs?.['data-photo-edit'];
  return typeof v === 'string' && EDIT8.test(v) ? v : null;
};

/** Drop empty sections so a neutral edit serializes back to `{}` (the same rule as PhotoKnobs). */
function prune(edit) {
  const out = {};
  for (const [k, v] of Object.entries(edit ?? {})) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = {};
      for (const [ik, iv] of Object.entries(v)) if (iv != null && iv !== '') inner[ik] = iv;
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return out;
}

const q = (asset) => `asset=${encodeURIComponent(asset)}`;

/** The edit a use starts from: its own, else the every-use edit, else `{}`. */
export async function readSeed(asset, edit8, fetchImpl = globalThis.fetch) {
  const get = async (url) => {
    try {
      const r = await fetchImpl(url);
      const j = r.ok ? await r.json() : null;
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  };
  if (edit8) {
    const own = await get(`/_api/photo-edit?${q(asset)}&edit=${encodeURIComponent(edit8)}`);
    if (own && Object.keys(own).length) return own;
  }
  return (await get(`/_api/photo-edit?${q(asset)}`)) ?? {};
}

/** The picture as an edit-op target. */
const targetOf = (el) => ({
  artboard: el.artboardId,
  element: el.id,
  ...(Number.isInteger(el.index) && el.index > 0 ? { occurrence: el.index } : {}),
});

/**
 * `photo.use-edit` through its server: point the use at `edit8`, or (null) back at every use.
 * @returns {Promise<{ ok: true, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export async function writeUseEdit({ canvas, el, edit8 }, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: canvas,
        op: 'photo.use-edit',
        targets: [targetOf(el)],
        params: { edit: edit8 },
      }),
    });
  } catch {
    return { ok: false, message: PHOTO_WORDS.failed };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (body?.ok) return { ok: true, writeId: body.writeId, actionId: body.actionId ?? null };
  return { ok: false, message: SAID[body?.code] ?? body?.message ?? PHOTO_WORDS.failed };
}

/**
 * Write the use's own edit file, then point the use at it. `current` is the name the use carries now: the same
 * name (identical bytes) writes nothing more.
 * @returns {Promise<{ ok: true, edit8: string, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export async function saveUseEdit(
  { asset, canvas, el, edit, current },
  fetchImpl = globalThis.fetch
) {
  let j = null;
  try {
    const r = await fetchImpl(`/_api/photo-edit?${q(asset)}&perUse=1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prune(edit)),
    });
    j = await r.json().catch(() => null);
    if (!r.ok) j = null;
  } catch {
    j = null;
  }
  const edit8 = typeof j?.edit === 'string' && EDIT8.test(j.edit) ? j.edit : null;
  if (!j?.ok || !edit8) return { ok: false, message: PHOTO_WORDS.failed };
  if (edit8 === current) return { ok: true, edit8 };
  const w = await writeUseEdit({ canvas, el, edit8 }, fetchImpl);
  return w.ok ? { ...w, edit8 } : w;
}

/** GET /_api/photo-every-use — who else shows the picture, and whether Apply is this session's to make. */
export async function readEveryUse(asset, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(`/_api/photo-every-use?${q(asset)}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok || !Array.isArray(j.uses)) return null;
    return { uses: j.uses, canApply: j.canApply === true, reason: j.reason ?? '' };
  } catch {
    return null;
  }
}

/**
 * @param {object} p
 * @param {string} p.asset          `assets/<sha8>.<ext>`
 * @param {object} p.el             the selected picture (id, artboardId, index, file, attrs)
 * @param {string} [p.canvasFile]   the open canvas (designRoot-relative), when `el.file` is absent
 * @param {string} [p.designRel]    the design root (default `.design`); the shell hands the canvas repo-relative
 * @param {boolean} [p.editable]
 * @param {Function} [p.onPreview]  (edit, use) => void — live preview on this use (dgn `photo-preview`)
 * @param {Function} [p.onRemoveBackground]  async (asset) => { maskAsset } | null
 * @param {Function} [p.onReplaceMedia]      (el) => void — the asset picker
 * @param {Function} [p.onRecordEdit]        an edit-op undo record `{ op: 'edit-op', writeId, label }`
 * @param {string} [p.intent]       'remove-background' — the Image section's ✦ asked for it on the way in
 * @param {Function} [p.onIntentUsed]  the intent was acted on (the panel forgets it)
 * @param {Function} [p.fetchImpl]  tests
 */
export function PhotoSection({
  asset,
  el,
  canvasFile,
  designRel,
  editable = true,
  onPreview,
  onRemoveBackground,
  onReplaceMedia,
  onRecordEdit,
  onRunAction,
  intent,
  onIntentUsed,
  ColorPicker,
  StIcon,
  fetchImpl = globalThis.fetch,
}) {
  const canvas = el?.file ?? canvasFile;
  const use = el?.id;
  const [edit, setEdit] = useState(null);
  const [current, setCurrent] = useState(() => ownEditOf(el));
  const [everyUse, setEveryUse] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [line, setLine] = useState('');
  const editRef = useRef(null);
  editRef.current = edit;
  const currentRef = useRef(current);
  currentRef.current = current;
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());
  const live = useRef(true);
  const attr = ownEditOf(el);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on a new picture or a new edit on it only
  useEffect(() => {
    live.current = true;
    // the canvas re-posting the name this panel just wrote is not news: keep what is on screen
    if (attr && attr === currentRef.current && editRef.current) return undefined;
    let dead = false;
    setCurrent(attr);
    readSeed(asset, attr, fetchImpl).then((e) => {
      if (!dead) setEdit(e);
    });
    return () => {
      dead = true;
    };
  }, [asset, use, attr]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: who else shows it changes with the picture only
  useEffect(() => {
    let dead = false;
    readEveryUse(asset, fetchImpl).then((r) => {
      if (!dead) setEveryUse(r);
    });
    return () => {
      dead = true;
    };
  }, [asset]);

  useEffect(
    () => () => {
      live.current = false;
      clearTimeout(timer.current);
    },
    []
  );

  const persist = useCallback(
    (next) => {
      chain.current = chain.current.then(async () => {
        const r = await saveUseEdit(
          { asset, canvas, el, edit: next, current: currentRef.current },
          fetchImpl
        );
        if (!live.current) return;
        if (!r.ok) {
          setLine(r.message);
          return;
        }
        setLine('');
        currentRef.current = r.edit8;
        setCurrent(r.edit8);
        if (r.writeId && r.actionId == null)
          onRecordEdit?.({
            op: 'edit-op',
            writeId: r.writeId,
            label: 'Edited this use of a photo',
          });
      });
    },
    [asset, canvas, el, fetchImpl, onRecordEdit]
  );
  /** Show `next` on this use now; with `commit`, write it (debounced: a burst of knob commits is one write). */
  const change = useCallback(
    (next, { commit = true } = {}) => {
      if (!editable || !use) return;
      editRef.current = next;
      setEdit(next);
      onPreview?.(next, use);
      if (!commit) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => persist(editRef.current), 160);
    },
    [editable, use, onPreview, persist]
  );

  const reset = useCallback(async () => {
    if (!editable || !use) return;
    clearTimeout(timer.current);
    // the every-use look is what the use shows again
    const every = await readSeed(asset, null, fetchImpl);
    if (!live.current) return;
    setEdit(every);
    onPreview?.(every, use);
    if (!currentRef.current) return;
    chain.current = chain.current.then(async () => {
      const r = await writeUseEdit({ canvas, el, edit8: null }, fetchImpl);
      if (!live.current) return;
      if (!r.ok) {
        setLine(r.message);
        return;
      }
      setLine('');
      currentRef.current = null;
      setCurrent(null);
      if (r.writeId && r.actionId == null)
        onRecordEdit?.({ op: 'edit-op', writeId: r.writeId, label: 'Edited this use of a photo' });
    });
  }, [editable, use, asset, canvas, el, fetchImpl, onPreview, onRecordEdit]);

  const removeBackground = useCallback(async () => {
    if (!editable || !onRemoveBackground || bgBusy) return;
    setBgBusy(true);
    setLine('');
    try {
      const res = await onRemoveBackground(asset);
      if (!live.current) return;
      if (res?.maskAsset) change(withCutOut(editRef.current ?? {}, true, res.maskAsset));
      else setLine(PHOTO_WORDS.removeFailed);
    } catch {
      if (live.current) setLine(PHOTO_WORDS.removeFailed);
    } finally {
      if (live.current) setBgBusy(false);
    }
  }, [editable, onRemoveBackground, bgBusy, asset, change]);

  // ⌘K "Apply to every use…" opens this sheet while the section shows a picture (registry photo.apply-every-use)
  useEffect(
    () =>
      bindInspectorActions({
        'photo.apply-every-use': () => {
          setSheet(true);
          return null;
        },
      }),
    []
  );

  // the Image section's ✦ Remove background opens Photo and asks for the cut-out once
  const asked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per mount, when the seed has landed
  useEffect(() => {
    if (intent !== 'remove-background' || asked.current || edit === null) return;
    asked.current = true;
    onIntentUsed?.();
    if (!cutOutOn(edit)) void removeBackground();
  }, [intent, edit === null]);

  if (edit === null)
    return (
      <div className="ph-sec" data-testid="photo-section" aria-busy="true">
        <p className="ph-quiet">Loading photo…</p>
      </div>
    );

  const name = fileNameOf(asset);
  const look = lookOf(edit);
  const light = sliderOf(edit, 'light');
  const colour = sliderOf(edit, 'colour');
  const cut = edit.backgroundRemoved?.maskAsset ? cutOutOn(edit) : null;
  const more = everyUse
    ? everyUse.uses.filter((u) => !sameCanvas(u.canvas, canvas, designRel)).length
    : 0;
  const thumb = `/${String(asset).replace(/^\/+/, '')}`;

  return (
    <div
      className="ph-sec"
      data-testid="photo-section"
      data-use={use}
      data-edit={current ?? undefined}
    >
      <div className="ph-hd">
        <strong data-testid="photo-file">{name}</strong>
        <span className="ph-chip">{PHOTO_WORDS.chip}</span>
      </div>
      <fieldset className="ph-fs" disabled={!editable}>
        <PlacementRow el={el} editable={editable} onRunAction={onRunAction} />
        <p className="ph-l" id="photo-look-l">
          {PHOTO_WORDS.look}
        </p>
        <div className="ph-looks" role="radiogroup" aria-labelledby="photo-look-l">
          {LOOKS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={look === l.id}
              className="ph-look"
              data-on={look === l.id ? 'true' : undefined}
              data-look={l.id}
              data-testid={`photo-look-${l.id}`}
              onClick={() => change(withLook(editRef.current ?? {}, l.id))}
            >
              <span className={`ph-look-pic ph-tone--${l.id}`} aria-hidden="true">
                <img src={thumb} alt="" draggable={false} />
              </span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <div className="ph-sl" data-testid="photo-light">
          <span className="ph-sl-l">{PHOTO_WORDS.light}</span>
          <Slider
            value={light}
            min={-100}
            max={100}
            step={1}
            ariaLabel={PHOTO_WORDS.light}
            onInput={(v) =>
              change(withSlider(editRef.current ?? {}, 'light', v), { commit: false })
            }
            onCommit={(v) => change(withSlider(editRef.current ?? {}, 'light', v))}
          />
          <span className="ph-sl-v">{signed(light)}</span>
        </div>
        <div className="ph-sl" data-testid="photo-colour">
          <span className="ph-sl-l">{PHOTO_WORDS.colour}</span>
          <Slider
            value={colour}
            min={-100}
            max={100}
            step={1}
            ariaLabel={PHOTO_WORDS.colour}
            onInput={(v) =>
              change(withSlider(editRef.current ?? {}, 'colour', v), { commit: false })
            }
            onCommit={(v) => change(withSlider(editRef.current ?? {}, 'colour', v))}
          />
          <span className="ph-sl-v">{signed(colour)}</span>
        </div>
        {cut === null ? (
          <button
            type="button"
            className="st-btn ph-ai"
            data-testid="photo-ai-remove-bg"
            disabled={bgBusy || !onRemoveBackground}
            aria-busy={bgBusy || undefined}
            onClick={() => void removeBackground()}
          >
            {StIcon ? <StIcon name="sparkle" size={12} /> : <span aria-hidden="true">✦</span>}
            {bgBusy ? PHOTO_WORDS.removing : PHOTO_WORDS.removeBg}
          </button>
        ) : (
          <div className="ph-row ph-bg" data-testid="photo-cutout-switch">
            <span>
              {StIcon ? <StIcon name="sparkle" size={11} /> : <span aria-hidden="true">✦</span>}
              {PHOTO_WORDS.removed}
            </span>
            <Toggle
              checked={cut}
              ariaLabel={PHOTO_WORDS.removed}
              onChange={(on) => change(withCutOut(editRef.current ?? {}, on))}
            />
          </div>
        )}
        <span className="ph-acts">
          <button
            type="button"
            className="st-btn"
            data-testid="photo-replace"
            disabled={!onReplaceMedia}
            onClick={() => onReplaceMedia?.(el)}
          >
            {PHOTO_WORDS.replace}
          </button>
          <button
            type="button"
            className="st-btn ph-ghost"
            data-testid="photo-reset"
            onClick={() => void reset()}
          >
            {PHOTO_WORDS.reset}
          </button>
        </span>
      </fieldset>
      {line ? (
        <p className="ph-err" role="alert" data-testid="photo-error">
          {line}
        </p>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {bgBusy ? PHOTO_WORDS.removing : ''}
      </span>
      <div className="ph-scope" data-testid="photo-scope">
        <p className="ph-scope-h">
          {StIcon ? <StIcon name="check" size={12} /> : null}
          {PHOTO_WORDS.scopeHead}
        </p>
        <p className="ph-scope-t" data-testid="photo-scope-line">
          {scopeLine(name, more)}
        </p>
        <button
          type="button"
          className="st-btn ph-wide"
          data-testid="photo-every-use-open"
          disabled={!everyUse}
          onClick={() => setSheet(true)}
        >
          {PHOTO_WORDS.everyUse}
        </button>
      </div>
      <AdvancedFold panel="inspector.photo" hint={PHOTO_WORDS.advancedHint}>
        <PhotoKnobs
          asset={asset}
          value={edit}
          onChange={(next, { commit }) => change(clone(next), { commit })}
          ColorPicker={ColorPicker}
          StIcon={StIcon}
          onRemoveBackground={editable ? onRemoveBackground : undefined}
        />
      </AdvancedFold>
      {sheet && everyUse ? (
        <ApplyEveryUseSheet
          asset={asset}
          name={name}
          canvas={canvas}
          designRel={designRel}
          edit={edit}
          answer={everyUse}
          fetchImpl={fetchImpl}
          onClose={() => setSheet(false)}
          onApplied={() => {
            setSheet(false);
            // every use shows this edit now, and this use carries none of its own
            currentRef.current = null;
            setCurrent(null);
            onPreview?.(edit, undefined);
            readEveryUse(asset, fetchImpl).then((r) => live.current && setEveryUse(r));
          }}
        />
      ) : null}
    </div>
  );
}

export default PhotoSection;
