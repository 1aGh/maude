// client/v2/inspector/kinds/image.jsx — S2.15: a picture in the inspector (14 Editing, ed-img · ed-edge-paste).
//
//   Image    the picture's thumb, its file and its size ("4032 × 3024"), Replace… · Fit  Fill · Fit · Crop · Tile · Zoom
//            (Crop only). A picture pasted from Figma says where it came from and offers only Fill · Fit: it is Figma's
//            exact picture, not something to crop or tile.
//   Adjust   Adjust… and ✦ Remove background hand off to Photo. Drawn only when the panel can open Photo (`ctx.onOpenPhoto`);
//            the line "Edits apply to this use only" is drawn only when Photo really edits one use (`ctx.photoPerUse`,
//            S8.15) — until then it would be untrue.
//
// Every change is ONE `image.crop` edit-op, asked of the canvas through `run-action` (`ctx.onRunAction`): the canvas holds the
// undo record, the studio writes plain TSX (object-fit / object-position / transform on the `<img>`), and a v1 peer reads it
// as it always did. Replace… opens the asset picker (`ctx.onReplaceMedia`); its answer is the `image.replace` op.
// The kind chip says "Image" for an `<img>` and for a tile (kinds/index.js).

import { useEffect, useState } from 'react';
import { Segmented } from '../../../inspector-controls.jsx';
import { NumberField } from '../../../inspector-controls.jsx';
import { StIcon } from '../../../shell/icons.jsx';
import { registerSlot } from '../slots.js';
import { Quiet, Row } from '../sections/row.jsx';

export const FITS = Object.freeze([
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'crop', label: 'Crop' },
  { value: 'tile', label: 'Tile' },
]);
/** A picture pasted from Figma is Figma's exact picture: Fill and Fit only. */
export const FIGMA_FITS = Object.freeze(FITS.slice(0, 2));

export const CROP_HINT = 'Double-click the picture to move it inside the frame.';
export const PHOTO_LINE = 'Both open Photo. Edits apply to this use only.';
export const PHOTO_LINE_QUIET = 'Both open Photo.';

const TILE_ATTR = 'data-image-tile';

/** The file an element shows: its `src`, or a tile's `data-image-tile`. */
export const srcOf = (el) => el?.attrs?.src || el?.attrs?.[TILE_ATTR] || '';

/** Fill · Fit · Crop · Tile as the file says it. */
export function fitOf(el) {
  if (el?.attrs?.[TILE_ATTR] !== undefined) return 'tile';
  if (el?.attrs?.['data-image-fit'] === 'crop') return 'crop';
  return String(el?.authored?.['object-fit'] ?? '').trim() === 'contain' ? 'fit' : 'fill';
}

/** The crop's zoom (1 – 8) from `transform: scale(Z)`; 1 when there is none. */
export function zoomOf(el) {
  const m = /^scale\(([\d.]+)\)$/.exec(String(el?.authored?.transform ?? '').trim());
  const z = m ? Number(m[1]) : 1;
  return Number.isFinite(z) && z >= 1 ? z : 1;
}

export const isFromFigma = (el) => el?.attrs?.['data-source'] === 'figma';
export const fileNameOf = (src) => String(src).split('/').pop() || '';

const refOf = (el) => (Array.isArray(el?.refs) ? el.refs[0] : null);

/** Ask the canvas to run `image.crop` over this picture. true = asked. */
export function askCrop(ctx, el, params) {
  const ref = refOf(el);
  if (!ctx?.onRunAction || !ref) return false;
  ctx.onRunAction({
    dgn: 'run-action',
    v: 1,
    id: 'image.crop',
    params: { targets: [ref], ...params },
  });
  return true;
}

/** `/<designRel>/assets/…` — where the studio serves a project file. */
export function assetUrl(ctx, src) {
  const rel = (ctx?.cfg?.designRel || ctx?.cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  return src ? `/${rel}/${String(src).replace(/^\/+/, '')}` : '';
}

const sizes = new Map();
/** Tests only. */
export const clearSizes = () => sizes.clear();

/** A picture's natural size, once it has loaded: `{ w, h }` or null. */
export function useNaturalSize(url) {
  const [size, setSize] = useState(() => sizes.get(url) ?? null);
  useEffect(() => {
    if (!url) {
      setSize(null);
      return undefined;
    }
    const known = sizes.get(url);
    if (known) {
      setSize(known);
      return undefined;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const s = { w: img.naturalWidth, h: img.naturalHeight };
      sizes.set(url, s);
      if (live) setSize(s);
    };
    img.src = url;
    return () => {
      live = false;
      img.onload = null;
    };
  }, [url]);
  return size;
}

export const sizeLine = (s) => (s ? `${s.w} × ${s.h}` : '');

function ImageBody({ el, ctx }) {
  const src = srcOf(el);
  const url = assetUrl(ctx, src);
  const size = useNaturalSize(url);
  const editable = ctx?.editable !== false && !!el?.id;
  const fit = fitOf(el);
  const figma = isFromFigma(el);
  const options = figma ? FIGMA_FITS : FITS;
  const zoom = zoomOf(el);
  return (
    <>
      <div className="insp-img-row" data-testid="insp-image-file">
        <span className="insp-img-thumb" data-testid="insp-image-thumb">
          {url ? <img src={url} alt="" draggable={false} /> : null}
        </span>
        <span className="insp-img-name">
          <span data-testid="insp-image-name">{fileNameOf(src)}</span>
          <em data-testid="insp-image-size">{sizeLine(size)}</em>
        </span>
        <button
          type="button"
          className="st-btn"
          data-testid="insp-image-replace"
          disabled={!editable || !ctx?.onReplaceMedia}
          onClick={() => ctx?.onReplaceMedia?.(el)}
        >
          Replace…
        </button>
      </div>
      {figma ? (
        <Row k="From" name="image-source">
          <span data-testid="insp-image-source">
            Figma{el?.attrs?.['data-source-name'] ? ` · ${el.attrs['data-source-name']}` : ''}
          </span>
        </Row>
      ) : null}
      <Row k="Fit" name="image-fit">
        <span data-testid="insp-ctl-image-fit">
          <Segmented
            value={fit}
            ariaLabel="Picture fit"
            options={options}
            onChange={(next) => editable && next !== fit && askCrop(ctx, el, { fit: next })}
          />
        </span>
      </Row>
      {fit === 'crop' ? (
        <>
          <Row k="Zoom" name="image-zoom">
            <span data-testid="insp-image-zoom" className="insp-nf">
              <NumberField
                value={Math.round(zoom * 100)}
                min={100}
                max={800}
                step={1}
                steppers={false}
                scrub={false}
                ariaLabel="Zoom"
                unitSlot={<span className="insp-unit">%</span>}
                onCommit={(n) => {
                  const z = Math.min(800, Math.max(100, Number(n) || 100)) / 100;
                  if (editable && z !== zoom) askCrop(ctx, el, { zoom: z });
                }}
              />
            </span>
          </Row>
          <Quiet testid="insp-image-crop-hint">{CROP_HINT}</Quiet>
        </>
      ) : null}
    </>
  );
}

function AdjustBody({ el, ctx }) {
  const editable = ctx?.editable !== false && !!el?.id;
  return (
    <>
      <Row k="Look" name="image-adjust">
        <button
          type="button"
          className="st-btn"
          data-testid="insp-image-adjust"
          disabled={!editable}
          onClick={() => ctx?.onOpenPhoto?.('adjust')}
        >
          Adjust…
        </button>
      </Row>
      <Row k="Background" name="image-remove-bg">
        <button
          type="button"
          className="st-btn"
          data-testid="insp-image-remove-bg"
          disabled={!editable}
          onClick={() => ctx?.onOpenPhoto?.('remove-background')}
        >
          <StIcon name="sparkle" size={12} /> Remove background
        </button>
      </Row>
      <Quiet testid="insp-image-photo-line">
        {ctx?.photoPerUse === true ? PHOTO_LINE : PHOTO_LINE_QUIET}
      </Quiet>
    </>
  );
}

let offs = [];

/** Register the two bodies (idempotent; tests that unregistered call it again). */
export function registerImageKind() {
  if (offs.length) return;
  offs = [
    registerSlot('image', { id: 'image.body', order: 10, kinds: ['image'], Body: ImageBody }),
    registerSlot('adjust', {
      id: 'adjust.photo',
      order: 10,
      kinds: ['image'],
      // Photo is the existing editor; a panel that cannot open it draws no Adjust at all
      when: ({ ctx }) => typeof ctx?.onOpenPhoto === 'function',
      Body: AdjustBody,
    }),
  ];
}

export const offImage = () => {
  for (const off of offs) off();
  offs = [];
};

registerImageKind();
