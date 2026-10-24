// client/v2/export/inspector-export.jsx — S8.8: the inspector's Export section (09 Export › ex-inspector).
//
//   Export                                        +   (add a size — artboards only)
//   [ 1× ▾ ] [ PNG ▾ ]  −                             one row per size, kept in the canvas's meta
//   [ 2× ▾ ] [ JPG ▾ ]  −
//   [ Export 2 files ]                                one click, no sheet; the files land in Exports
//   Copy as PNG                          ⇧⌘C
//   Export… — every option               ⇧⌘E          opens the sheet, pre-filled with this selection
//
// An artboard keeps its own sizes (artboardMeta[id].exports — set once, one click from then on); an object
// shows PNG 2× and SVG and stores nothing; print and video artboards show their kind's one format and point at
// the sheet, which owns their options. Several objects get the pointer and Copy as PNG's reason.
//
// It fills S2's `export` slot (slots.js) and takes the S2.5 placeholder out (`offExportSlot()`); the placeholder's
// testids (`insp-export-presets`, `insp-export-preset`, `insp-export-more`) live on here, so the S2 specs and the
// agent's selectors keep finding them. Can view has no export at all: the section is not drawn for that role
// (the server refuses the render anyway — hidden is not refused, the routes still check).

import { Download, Minus } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Select } from '../../inspector-controls.jsx';
import { shellToast } from '../../shell/util.js';
import { advancedAccess } from '../inspector/advanced.jsx';
import { isArtboardSelection } from '../inspector/kinds/index.js';
import { exportPresets, isVideoArtboard, offExportSlot } from '../inspector/sections/export-slot.jsx';
import { Quiet, Row } from '../inspector/sections/row.jsx';
import { registerSlot } from '../inspector/slots.js';
import { copyAsPng } from './copy-png.js';
import {
  addSize,
  artboardKindOf,
  changeSize,
  defaultSizes,
  exportWord,
  FORMATS,
  getEntry,
  hasSizes,
  KIND_FORMAT,
  loadSizes,
  MAX_SIZES,
  OBJECT_SIZES,
  removeSize,
  SCALES,
  SIZES_WORDS,
  saveSizes,
  scaleWord,
  sizesVersion,
  sizeWords,
  specsFor,
  subscribeSizes,
} from './export-sizes.js';
import { openExport, quickExport } from './use-export-spec.js';

const designRelOf = (cfg) => cfg?.designRel || '.design';

/** Can view (`observer`) has no export; every other role may render and copy. */
export const canExport = (ctx) => advancedAccess(ctx?.cfg).role !== 'observer';
/** Writing the sizes into the meta needs more than reading the canvas. */
export const canStoreSizes = (ctx) => !advancedAccess(ctx?.cfg).readOnly;

const singleOf = (selection) => (Array.isArray(selection) ? selection[0] : selection);

/** The artboard this selection is, with the canvas file and its kind — or null for anything else. */
function artboardOf({ el, selection, ctx }) {
  if (Array.isArray(selection) && selection.length > 1) return null;
  const one = singleOf(selection) ?? el;
  if (!isArtboardSelection(one)) return null;
  const id = one.artboardId || one.attrs?.['data-dc-screen'];
  const file = one.file ?? ctx?.canvasFile;
  return id && file ? { id, file, kind: artboardKindOf(one), el: one } : null;
}

const MinusIcon = () => <Minus size={12} strokeWidth={1.75} />;

function SizeRow({ index, size, editable, onChange, onRemove, canRemove }) {
  const scales =
    SCALES.includes(size.scale) || size.format === 'svg' ? SCALES : [...SCALES, size.scale];
  return (
    <div className="insp-export-size" data-testid="insp-export-size" data-index={index}>
      <Select
        value={size.format === 'svg' ? '' : String(size.scale)}
        options={
          size.format === 'svg'
            ? [{ value: '', label: '—' }]
            : [...scales]
                .sort((a, b) => a - b)
                .map((s) => ({ value: String(s), label: scaleWord(s) }))
        }
        ariaLabel={SIZES_WORDS.scale}
        testId={`insp-export-scale-${index}`}
        mini
        onChange={(v) => editable && size.format !== 'svg' && onChange({ scale: Number(v) })}
      />
      <Select
        value={size.format}
        options={FORMATS}
        ariaLabel={SIZES_WORDS.format}
        testId={`insp-export-format-${index}`}
        mini
        onChange={(v) => editable && onChange({ format: v })}
      />
      {editable ? (
        <button
          type="button"
          className="insp-x"
          data-testid={`insp-export-remove-${index}`}
          aria-label={SIZES_WORDS.remove}
          title={canRemove ? SIZES_WORDS.remove : SIZES_WORDS.keepOne}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <MinusIcon />
        </button>
      ) : null}
    </div>
  );
}

/** The two lines under the sizes: Copy as PNG and the pointer at the sheet. */
function Tail({ onCopy, onMore, busy, copyOk }) {
  return (
    <>
      {copyOk ? (
        <button
          type="button"
          className="insp-export-line"
          data-testid="insp-export-copy-png"
          disabled={busy}
          onClick={onCopy}
        >
          <span>{SIZES_WORDS.copyPng}</span>
          <kbd className="insp-export-keys">{SIZES_WORDS.copyKeys}</kbd>
        </button>
      ) : null}
      <button
        type="button"
        className="insp-export-line"
        data-testid="insp-export-more"
        onClick={onMore}
      >
        <span>{SIZES_WORDS.more}</span>
        <kbd className="insp-export-keys">{SIZES_WORDS.moreKeys}</kbd>
      </button>
    </>
  );
}

function useStoredSizes(art) {
  useSyncExternalStore(subscribeSizes, sizesVersion, sizesVersion);
  const file = art?.file;
  const id = art?.id;
  useEffect(() => {
    if (file && id) void loadSizes(file, id);
  }, [file, id]);
  return art ? getEntry(file, id) : null;
}

export function ExportSectionBody({ el, selection, kind, ctx }) {
  const art = artboardOf({ el, selection, ctx });
  const entry = useStoredSizes(art);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const many = Array.isArray(selection) && selection.length > 1;
  const one = singleOf(selection) ?? el;
  const canvasFile = art?.file ?? one?.file ?? ctx?.canvasFile;
  const designRel = designRelOf(ctx?.cfg);
  const editable = !!art && hasSizes(art.kind) && canStoreSizes(ctx);

  // what the rows show: the stored sizes, else the kind's default; an object's are fixed
  const shown = art
    ? (entry?.sizes ?? defaultSizes(art.kind))
    : kind === 'multi' || many
      ? []
      : OBJECT_SIZES;

  const openSheet = () => {
    if (art && !hasSizes(art.kind)) {
      openExport({ scope: 'selection', format: KIND_FORMAT[art.kind] });
    } else openExport({ scope: 'selection' });
  };

  const run = async () => {
    if (!canvasFile || !shown.length) return;
    const target = art ? { artboardId: art.id } : one?.id ? { elementIds: [one.id] } : null;
    if (!target) return;
    setBusy(true);
    try {
      await Promise.all(
        specsFor(shown, target, { canvasFile, designRel }).map((s) => quickExport(s))
      );
      shellToast(
        `Exporting ${shown.length} ${shown.length === 1 ? 'file' : 'files'} — they land in Exports.`,
        true
      );
    } catch (e) {
      shellToast(e?.message || 'Not exported; try again.', false);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const copy = async () => {
    setBusy(true);
    const r = await copyAsPng({
      selected: selection,
      canvasFile,
      designRel,
    });
    shellToast(r.message, r.ok);
    if (alive.current) setBusy(false);
  };

  // several objects: the pointer, and Copy as PNG's reason on its own line
  if (many || kind === 'multi') {
    const n = Array.isArray(selection) ? selection.length : 1;
    return (
      <>
        <Row k={SIZES_WORDS.rowPreset} name="export-presets">
          <span className="insp-export-presets" data-testid="insp-export-presets">
            <span className="insp-export-chip" data-testid="insp-export-preset">
              {exportPresets({ el, selection, kind: 'multi' })[0] ?? `${n} files…`}
            </span>
          </span>
        </Row>
        <Tail onMore={openSheet} copyOk={false} />
      </>
    );
  }

  // print and video artboards: their kind's one format, set in the sheet
  if (art && !hasSizes(art.kind)) {
    return (
      <>
        <Row k={SIZES_WORDS.rowPreset} name="export-presets">
          <span className="insp-export-presets" data-testid="insp-export-presets">
            {exportPresets({ el: art.el, selection, kind }).map((p) => (
              <span key={p} className="insp-export-chip" data-testid="insp-export-preset">
                {p}
              </span>
            ))}
          </span>
        </Row>
        <Tail onMore={openSheet} onCopy={copy} busy={busy} copyOk />
      </>
    );
  }

  return (
    <>
      {editable ? (
        <div className="insp-export-sizes" data-testid="insp-export-sizes">
          {shown.map((s, i) => (
            <SizeRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a size has no id; the list is short and ordered
              key={i}
              index={i}
              size={s}
              editable
              canRemove={shown.length > 1}
              onChange={(patch) => saveSizes(art.file, art.id, changeSize(shown, i, patch))}
              onRemove={() => removeSize(art.file, art.id, shown, i)}
            />
          ))}
        </div>
      ) : (
        <Row k={SIZES_WORDS.rowPreset} name="export-presets">
          <span className="insp-export-presets" data-testid="insp-export-presets">
            {shown.map((s) => (
              <span
                key={sizeWords(s)}
                className="insp-export-chip"
                data-testid="insp-export-preset"
              >
                {sizeWords(s)}
              </span>
            ))}
          </span>
        </Row>
      )}
      {entry?.error ? <Quiet testid="insp-export-error">{entry.error}</Quiet> : null}
      {!art && !one?.id ? <Quiet testid="insp-export-need-id">{SIZES_WORDS.needId}</Quiet> : null}
      {shown.length && (art || one?.id) ? (
        <button
          type="button"
          className="btn insp-export-go"
          data-testid="insp-export-go"
          disabled={busy}
          onClick={run}
        >
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
          {exportWord(shown.length)}
        </button>
      ) : null}
      <Tail onMore={openSheet} onCopy={copy} busy={busy} copyOk={!!art || !!one?.id} />
    </>
  );
}

/** The "+" in the section header: only an artboard whose kind has sizes, and only for a role that may store them. */
function canAdd({ el, selection, ctx }) {
  const art = artboardOf({ el, selection, ctx });
  return !!art && hasSizes(art.kind) && canStoreSizes(ctx);
}

function add({ el, selection, ctx }) {
  const art = artboardOf({ el, selection, ctx });
  if (!art) return;
  const have = getEntry(art.file, art.id).sizes ?? defaultSizes(art.kind);
  if (have.length >= MAX_SIZES) return;
  void addSize(art.file, art.id, have);
}

// S2.5's placeholder goes; this entry is the Export section from here on (its testids are kept above).
offExportSlot();
export const offInspectorExport = registerSlot('export', {
  id: 'export.sizes',
  order: 100,
  Body: ExportSectionBody,
  // Can view sees none of it: the frame passes its ctx to `when`, so the section is not drawn at all
  // 07 VideoInspector: a video artboard's card has Export as one MP4 row (kinds/artboard-video.jsx), no section
  when: ({ ctx, selection }) => !isVideoArtboard(selection) && canExport(ctx),
  canAdd,
  add: ({ el, ctx }) => add({ el, selection: el, ctx }),
});
