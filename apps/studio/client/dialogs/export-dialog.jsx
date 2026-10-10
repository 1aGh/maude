// dialogs/export-dialog.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useState } from 'react';
import {
  BROWSER_CAPTURE_FORMATS,
  BROWSER_SERVABLE_FORMATS,
  browserCaptureEligible,
  captureDeckViaBrowser,
  captureScale,
  recordBrowserExport,
  sanitizeCapturedItems,
} from '../export-lane.js';
import {
  defaultScopeForFormat,
  isScopeValidForFormat,
  validScopesForFormat,
} from '../../exporters/format-scopes.ts';
import { activeComp, resolveCompTarget } from '../panels/timeline-comp-target.js';
import { SYSTEM_TAB } from '../shell/constants.js';
import { basename, displayName } from '../shell/util.js';
import { StIcon } from '../shell/icons.jsx';

// T5 (Plan C) — shell-level Export & Handoff dialog (maude `.st-dialog`), per
// `.design/ui/Studio.tsx` HandoffBoard. Wired to the privileged main-origin
// `POST /_api/export` (7 real formats × scopes). The shadcn card is HANDOFF —
// a privileged disk-write kept off HTTP routes (DDR-054), so it surfaces the
// `/design:handoff` command instead. PPTX/Canva kept reachable (no silent cap).
export const EXPORT_CARDS = [
  {
    id: 'png',
    label: 'PNG',
    sub: 'raster · 2×',
    icon: 'image',
    format: 'png',
    options: { scale: 2 },
  },
  { id: 'pdf', label: 'PDF', sub: 'vector · print', icon: 'file', format: 'pdf' },
  { id: 'svg', label: 'SVG', sub: 'per artboard', icon: 'vector', format: 'svg' },
  { id: 'html', label: 'HTML', sub: 'self-contained', icon: 'code', format: 'html' },
  { id: 'pptx', label: 'PPTX', sub: 'slides', icon: 'presentation', format: 'pptx' },
  // DDR-148 — temporal formats. Shown only when the active canvas has a
  // video-comp (`temporal: true` + the hasComps gate in ExportDialog); the
  // capture engine renders the artboard frame-by-frame.
  {
    id: 'mp4',
    label: 'MP4',
    sub: 'video · H.264',
    icon: 'presentation',
    format: 'mp4',
    temporal: true,
  },
  { id: 'gif', label: 'GIF', sub: 'animated', icon: 'image', format: 'gif', temporal: true },
  { id: 'canva', label: 'Canva', sub: 'handoff bundle', icon: 'external', format: 'canva' },
  { id: 'zip', label: 'ZIP', sub: 'project bundle', icon: 'archive', format: 'zip' },
  { id: 'shadcn', label: 'AI handoff', sub: 'production drop', icon: 'sparkle', handoff: true },
];

// Mirrors export-dialog.tsx (the in-canvas dialog) so both entry points offer
// the same settings. Scope validity + PNG scale presets are ported verbatim.
export const EXPORT_SCOPE_LABELS = {
  selection: 'Current selection',
  artboard: 'Active artboard',
  'canvas-as-separate': 'Canvas · artboards separate',
  'canvas-whole': 'Whole canvas · one image',
  'selection-bounds': 'Selection area · one image',
  'project-raw': 'Whole project (raw)',
};

// Issue #125 — scopes that capture a world-plane region as one unit; the only
// ones that can carry the annotation layer.
export const EXPORT_REGION_SCOPES = new Set(['canvas-whole', 'selection-bounds']);

export const PNG_SCALES = [
  { value: 1, label: '1× (native)' },
  { value: 2, label: '2× (retina)' },
  { value: 3, label: '3× (max)' },
];

// feature-2-print-artboards T6 — the PNG card's resolution picker folds the
// legacy 1×/2×/3× multiplier and the new physical-DPI ladder (T4) into ONE
// select: `kind:'scale'` entries send `options.scale`, `kind:'dpi'` entries
// send `options.dpi` (exporters/png.ts resolveDeviceScale — dpi wins over
// scale when both could apply). Default stays 2× (unchanged UX for anyone
// not exporting for print).
export const PNG_RESOLUTIONS = [
  { id: '1x', label: '1× (native)', kind: 'scale', value: 1 },
  { id: '2x', label: '2× (retina)', kind: 'scale', value: 2 },
  { id: '3x', label: '3× (max)', kind: 'scale', value: 3 },
  { id: 'dpi150', label: '150 dpi', kind: 'dpi', value: 150 },
  { id: 'dpi300', label: '300 dpi (print)', kind: 'dpi', value: 300 },
  { id: 'dpi600', label: '600 dpi (high-res print)', kind: 'dpi', value: 600 },
];

export const PNG_RESOLUTION_DEFAULT = '2x';

// feature-2-print-artboards T5/T6 (dogfood follow-up) — the PDF page itself
// is always vector (text/shapes never rasterize), but any RASTER content ON
// the artboard — a dropped photo, a large-format piece authored at a
// fraction of its real physical size (e.g. a billboard at 1:10 scale) —
// still embeds as a bitmap whose density this controls. Default "Auto" (1×, 300 dpi on print artboards — V2-2.8 B5)
// is today's unchanged behavior; PDF has no legacy scale concept, so unlike
// PNG_RESOLUTIONS this is DPI-only.
export const PDF_DPI_OPTIONS = [
  { id: 'auto', label: 'Auto (300 dpi on print artboards)', value: undefined },
  { id: 'dpi150', label: '150 dpi', value: 150 },
  { id: 'dpi300', label: '300 dpi (print)', value: 300 },
  { id: 'dpi600', label: '600 dpi (high-res print)', value: 600 },
];

export const PDF_DPI_DEFAULT = 'auto';

// issue #116 — how the export treats text. Mirrors export-dialog.tsx's
// PDF_TEXT_OPTIONS (same mirror obligation as PDF_DPI_OPTIONS above).
//
// The list is FIXED regardless of whether Ghostscript is present on this
// machine. Hiding "Convert to outlines" when gs is missing would need a new
// capability route, and would answer the user's question ("can I send this to
// a printer?") by making the answer invisible; a refusal that names the
// one-line install is more honest and reaches them at the moment they care.
export const PDF_TEXT_OPTIONS = [
  {
    id: 'keep',
    label: 'Keep selectable (default)',
    description:
      'Text stays selectable and searchable. You are warned if a font came out unprintable.',
  },
  {
    id: 'embed',
    label: 'Verify fonts embedded',
    description:
      'Same file, but the export fails instead of shipping a font a print shop would reject.',
  },
  {
    id: 'outline',
    label: 'Convert to outlines (print-safe)',
    description:
      'Every glyph becomes a vector path — no fonts left to break. Text is no longer selectable ' +
      'and the file can grow a lot. Needs Ghostscript installed locally; cloud workspaces have it.',
  },
];

export const PDF_TEXT_DEFAULT = 'keep';

// Direct download for a browser-lane capture. export-center's autoDownloadBlob
// fetches a JOB's bytes — a browser capture has no job, just the Blob.
export function downloadCapturedBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'export';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay — an immediate revoke can race the download start in
  // some engines (the click only queues the fetch of the object URL).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportDialog({
  mode,
  initialScope,
  activePath,
  hasComps = false,
  comps = [],
  activeArtboardId = null,
  selection = null,
  exportLane = 'local',
  onBrowserCapture = null,
  onQuerySelection = null,
  onClose,
}) {
  // feature-cloud-export-render-workers — on a cell with no render service
  // (`lane === 'none'`), formats that render through a browser are offered
  // disabled-with-a-reason instead of firing a request the proxy 404s. ZIP
  // (JSZip over project files) and the AI-handoff card (clipboard copy) need
  // no browser — and DDR-231's browser lane keeps png/svg live in every
  // workspace lane too (captured by the member's own browser, no service).
  const laneBlocked = useCallback(
    (c) =>
      (exportLane === 'none' &&
        !c.handoff &&
        c.format !== 'zip' &&
        !BROWSER_SERVABLE_FORMATS.has(c.format)) ||
      // Canva bundles project files the render service can't reach — desktop only
      // in every workspace lane (exporters/remote.ts REMOTE_UNSUPPORTED_FORMATS).
      (exportLane !== 'local' && c.format === 'canva'),
    [exportLane]
  );
  const [sel, setSel] = useState(mode === 'handoff' ? 'shadcn' : 'png');
  // DDR-231 Phase 2 T4 — seed from the shared table, and only honour an
  // incoming hint the CHOSEN FORMAT can actually render. A hint the format
  // can't take (a context menu's `project-raw`, a re-run of a zip history
  // entry) used to survive into the request and reach the render service as
  // an unrenderable file-tree target: "invalid render job".
  // The dialog opens on the PNG card; the format-change effect below re-seeds
  // the scope whenever the member picks another one.
  const [scope, setScope] = useState(() =>
    initialScope && isScopeValidForFormat('png', initialScope)
      ? initialScope
      : defaultScopeForFormat('png')
  );
  const [scale, setScale] = useState(2);
  // feature-2-print-artboards T4/T6 — PNG resolution (folds scale + dpi, see
  // PNG_RESOLUTIONS above).
  const [pngResId, setPngResId] = useState(PNG_RESOLUTION_DEFAULT);
  // feature-2-print-artboards T5/T6 — PDF print options. Sent unconditionally
  // on every PDF export; the server no-ops them for a non-print artboard (no
  // `print` JSX prop → applyPrintBoxesAndMarks never runs), so there's no
  // need to detect the artboard's kind client-side before showing these.
  const [pdfIncludeBleed, setPdfIncludeBleed] = useState(true);
  const [pdfMarksOpen, setPdfMarksOpen] = useState(false);
  const [pdfMarksCrop, setPdfMarksCrop] = useState(false);
  const [pdfMarksRegistration, setPdfMarksRegistration] = useState(false);
  const [pdfDpiId, setPdfDpiId] = useState(PDF_DPI_DEFAULT);
  const [pdfTextId, setPdfTextId] = useState(PDF_TEXT_DEFAULT);
  // Issue #125 — opt-in, region scopes only. Comment pins never export.
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  // DDR-148 addendum — mp4/webm of a registered video-comp render through
  // renderMediaOnWeb, which produces real audio (Remotion owns the
  // TransitionSeries/volume-closure timeline). gif has no audio track at all
  // (format limitation, not a toggle), so this only applies to mp4/webm.
  const [audio, setAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }
  const [recent, setRecent] = useState([]);
  const card = EXPORT_CARDS.find((c) => c.id === sel) || EXPORT_CARDS[0];
  const validScopes = card.handoff ? [] : validScopesForFormat(card.format);
  // Long-comp tiers (feature-enhanced-video-editing Task 1). 900 frames is the
  // safe tier (the frame-step fallback runs ~2.5 s/frame and 1080p captures
  // have died from memory pressure above it); 3600 is the server's default cap
  // (exporters/video.ts DEFAULT_MAX_FRAMES). Above the cap the dialog raises it
  // EXPLICITLY for this export, with the notice below as the informed consent —
  // never a silent truncation, never a surprise refusal.
  const EXPORT_SAFE_FRAMES = 900;
  const EXPORT_DEFAULT_CAP = 3600;
  // The comp being exported — resolved to the artboard this dialog targets, not
  // to whichever comp mounted first (#75). It drives the long-comp consent
  // notice AND `options.maxFrames`, so a wrong pick both misstates the frame
  // count to the user and raises the server-side cap on behalf of a comp that
  // isn't the one leaving the machine.
  const exportComp = activeComp(comps, resolveCompTarget(comps, { artboardId: activeArtboardId }));
  const exportCompFrames = exportComp?.durationInFrames || 0;
  const exportCompFps = exportComp?.fps || 30;
  const exportIsHeavy = card.temporal && exportCompFrames > EXPORT_SAFE_FRAMES;
  const exportOverCap = card.temporal && exportCompFrames > EXPORT_DEFAULT_CAP;

  // Keep the scope valid for the chosen format (pptx/zip etc. only allow a
  // subset). Both dialogs and the server now read one table
  // (exporters/format-scopes.ts) — see DDR-231 Phase 2 T4.
  useEffect(() => {
    if (validScopes.length && !validScopes.includes(scope)) {
      setScope(defaultScopeForFormat(card.format));
    }
  }, [validScopes, scope, card.format]);

  // DDR-231 T7 — wake the render service the moment the dialog opens on a
  // remote-lane workspace: the multi-GB Chromium container starts booting
  // while the member is still picking format/scope, so a video/PDF job lands
  // on a warm (or at least warming) service instead of a cold one.
  useEffect(() => {
    if (exportLane !== 'remote') return;
    fetch('/_api/export-warmup').catch(() => {});
  }, [exportLane]);

  const loadRecent = useCallback(() => {
    fetch('/_api/export-history')
      .then((r) => r.json())
      .then((d) => setRecent(Array.isArray(d?.history) ? d.history.slice(0, 6) : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The sheet's controls → the options bag for the card being exported. Pulled out of the submit so
  // a history replay (below) can skip it: a replay carries the entry's own options.
  async function sheetOptions(card, scope) {
    // `scale` drives video resolution (deviceScaleFactor → encoder dims);
    // temporal formats were previously fixed at the tiny native size. PNG's
    // resolution now comes from pngResId (T4/T6 — scale OR dpi).
    const options = card.temporal ? { scale } : {};
    if (card.format === 'png') {
      const res = PNG_RESOLUTIONS.find((r) => r.id === pngResId) || PNG_RESOLUTIONS[1];
      if (res.kind === 'dpi') options.dpi = res.value;
      else options.scale = res.value;
    }
    // Export-with-audio (DDR-148 addendum) — mp4/webm only; gif is silent by
    // format, so the checkbox never renders for it (see hasAudioToggle below).
    if (card.format === 'mp4' || card.format === 'webm') options.audio = audio;
    // Long-comp cap raise — the visible notice above the button is the consent.
    if (exportOverCap) options.maxFrames = exportCompFrames;
    // feature-2-print-artboards T5/T6 — always sent on a PDF export; the
    // adapter no-ops includeBleed/marks for a non-print artboard (T5).
    if (card.format === 'pdf') {
      options.pdfPrint = {
        includeBleed: pdfIncludeBleed,
        marks: { crop: pdfMarksCrop, registration: pdfMarksRegistration },
      };
      // Dogfood follow-up — raster CONTENT on the artboard (a dropped photo,
      // large-format art) still needs a real capture density; the page
      // itself stays vector regardless of this.
      const pdfDpi = PDF_DPI_OPTIONS.find((d) => d.id === pdfDpiId)?.value;
      if (pdfDpi !== undefined) options.dpi = pdfDpi;
      // issue #116 — omitted for `keep` rather than sent explicitly: the
      // adapter's default IS keep, so an untouched dialog produces the exact
      // request body it did before this feature existed.
      if (pdfTextId !== 'keep') options.text = pdfTextId;
    }
    // Scope targeting hints (resolveScope reads these): `artboardId` makes
    // "Active artboard" export the right screen instead of `:first-of-type`;
    // `selection` makes "Current selection" export the selected element. Mirrors
    // the in-canvas dialog's captureScopeHints.
    if (activeArtboardId) options.artboardId = activeArtboardId;
    if (selection?.selector) options.selection = selection;
    if (EXPORT_REGION_SCOPES.has(scope) && includeAnnotations) options.includeAnnotations = true;
    if (scope === 'selection-bounds' && typeof onQuerySelection === 'function') {
      const all = await onQuerySelection();
      if (all?.length) options.selectionAll = all;
    }
    // Which canvas FILE this dialog is exporting — the server's `_active.json`
    // lags a tab switch, and a job resolved against the stale file renders the
    // wrong canvas (with this dialog's artboardId, which then never matches).
    if (activePath && activePath !== SYSTEM_TAB) options.canvasFile = activePath;
    return options;
  }

  // V2-2.8 (decision:maude/v2-2.8-shift-cmd-e-one-sheet, Gate 0 D3) — ONE submit path for the
  // Export button and for the Recent rows' "Export again". `card` / `scope` are what is exported:
  // the sheet's own selection, or the history entry's. `replay` is that history entry; its options
  // go out verbatim instead of being built from the sheet's controls.
  async function runExport(card, scope, replay) {
    if (card.handoff) {
      const p = activePath && activePath !== SYSTEM_TAB ? activePath : '<canvas>.tsx';
      const cmd = `/design:handoff ${p}`;
      try {
        await navigator.clipboard?.writeText(cmd);
      } catch {}
      setStatus({ ok: true, msg: `Copied: ${cmd} — run it in Claude Code.` });
      return;
    }
    if (laneBlocked(card)) {
      // Belt to the disabled-card braces — a stale selection can't submit a
      // format this workspace cannot render.
      setStatus({
        ok: false,
        msg: 'This format needs the render service, which this workspace doesn’t have configured.',
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    const options = replay ? { ...(replay.options ?? {}) } : await sheetOptions(card, scope);
    // DDR-231 — the browser lane: in a workspace, png/svg of the active
    // artboard is captured by the member's OWN browser (the canvas already
    // renders here) — instant, no fleet wake. Everything else continues to
    // the jobs lane below.
    // NOTE the format gate. `browserCaptureEligible` answers for the whole
    // browser lane, pptx included — but this branch is the SINGLE-ARTBOARD
    // capture that downloads what the bridge returns verbatim. Without the
    // gate, a pptx export fell in here, asked the bridge for a "pptx" (which it
    // renders as PNG), and died in `sanitizeCapturedItems` on "not a valid
    // pptx" — silently degrading to the worker lane, which is why the deck
    // arrived minutes later with none of the browser lane's fixes in it. The
    // dedicated deck branch below was unreachable. Found by the T7 export E2E.
    const browserEligible =
      BROWSER_CAPTURE_FORMATS.has(card.format) &&
      browserCaptureEligible({
        exportLane,
        format: card.format,
        scope,
        artboardId: options.artboardId,
      }) &&
      typeof onBrowserCapture === 'function';
    if (browserEligible) {
      try {
        const capScale = captureScale(options);
        setStatus({ ok: true, msg: 'Capturing…' });
        const items = await onBrowserCapture({
          format: card.format,
          artboardIds: [options.artboardId],
          scale: capScale,
          onProgress: (current, total) =>
            setStatus({ ok: true, msg: `Capturing ${current}/${total}…` }),
        });
        // Validate before writing to disk — the capture bridge shares a window
        // with tenant TSX, which can forge a reply (DDR-231 security pass, F1):
        // caps count/bytes, sniffs magic, forces name+MIME.
        const safeItems = await sanitizeCapturedItems(items, card.format);
        for (const it of safeItems) downloadCapturedBlob(it.name, it.blob);
        // DDR-231 Phase 2 T6 — the export is DONE and the member should see
        // that, in the dialog and in the ledger. Phase 1 closed the modal the
        // instant the download was handed off, so a browser-lane export left
        // no trace anywhere ("v exports dialog nic nevidim").
        for (const it of safeItems) {
          await recordBrowserExport({ format: card.format, scope, filename: it.name });
        }
        setBusy(false);
        setStatus({
          ok: true,
          msg: `Saved ${safeItems.map((it) => it.name).join(', ')} to your downloads.`,
        });
        return;
      } catch (err) {
        if (exportLane !== 'remote') {
          setStatus({ ok: false, msg: `Capture failed: ${(err && err.message) || err}` });
          setBusy(false);
          return;
        }
        // A render service exists — degrade to the slower jobs lane instead of
        // a dead end (and the fallback keeps the worker path exercised).
      }
    }
    // DDR-231 — the pptx deck: capture every artboard as PNG in THIS browser,
    // compose in-cell (/_api/export-assemble — the zip containment class).
    if (
      browserCaptureEligible({ exportLane, format: card.format, scope }) &&
      card.format === 'pptx' &&
      typeof onBrowserCapture === 'function'
    ) {
      try {
        setStatus({ ok: true, msg: 'Capturing artboards…' });
        const deckName =
          activePath && activePath !== SYSTEM_TAB
            ? basename(activePath).replace(/\.[^.]+$/, '')
            : 'export';
        const { filename, blob } = await captureDeckViaBrowser({
          capture: onBrowserCapture,
          name: deckName,
          onProgress: (current, total) =>
            setStatus({ ok: true, msg: `Capturing ${current}/${total}…` }),
          // Composition happens in-cell AFTER the last capture, and it is not
          // instant for a 10-slide deck. Without this the status sat on
          // "Capturing 10/10…" through the whole assemble step and the deck
          // then appeared out of nowhere — the reported "modal closes, nothing
          // happens, and after a while it downloads by itself".
          onAssemble: () => setStatus({ ok: true, msg: 'Assembling deck…' }),
        });
        downloadCapturedBlob(filename, blob);
        await recordBrowserExport({ format: card.format, scope, filename });
        setBusy(false);
        setStatus({ ok: true, msg: `Saved ${filename} to your downloads.` });
        return;
      } catch (err) {
        if (exportLane !== 'remote') {
          setStatus({ ok: false, msg: `Deck export failed: ${(err && err.message) || err}` });
          setBusy(false);
          return;
        }
        // Render service available — degrade to the jobs lane below.
      }
    }
    if (exportLane === 'none' && BROWSER_CAPTURE_FORMATS.has(card.format)) {
      // Without a render service the browser can only capture what it renders:
      // the active artboard. Other scopes have nowhere to run.
      setStatus({
        ok: false,
        msg: 'Without the render service this workspace exports PNG/SVG of the active artboard only — switch Scope to “Active artboard”, or ask your admin to add maude-render.',
      });
      setBusy(false);
      return;
    }
    try {
      // feature-background-export-notification-center — enqueue and close
      // immediately; the menubar notification center owns status, progress,
      // and completion (download / native Save…) from here on.
      const r = await fetch('/_api/export-jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: card.format, scope, options }),
      });
      if (!r.ok) {
        setStatus({ ok: false, msg: (await r.text()) || `Export failed (${r.status})` });
        setBusy(false);
        return;
      }
      onClose();
    } catch (err) {
      setStatus({ ok: false, msg: err && err.message ? err.message : String(err) });
      setBusy(false);
    }
  }

  const doExport = () => runExport(card, scope, null);

  // "Export again" on a Recent row (D3). A (format, scope) pair that is not legal — or never was —
  // would otherwise go out as an unrenderable job: fall back to that format's default scope, the
  // rule the in-canvas dialog's rerunLast() had. A format with no card (webm, from the CLI) still
  // replays — the lane gate and the server judge it.
  function exportAgain(h) {
    const format = String(h.format || '');
    const replayCard = EXPORT_CARDS.find((c) => c.format === format && !c.handoff) || {
      id: format,
      label: format.toUpperCase(),
      format,
    };
    const replayScope = isScopeValidForFormat(format, h.scope)
      ? h.scope
      : defaultScopeForFormat(format);
    return runExport(replayCard, replayScope, h);
  }

  return (
    <div
      className="st-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="st-dialog" role="dialog" aria-modal="true" aria-label="Export and handoff">
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Export &amp; handoff</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <StIcon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <div className="st-rp-hd">
            {activePath && activePath !== SYSTEM_TAB
              ? `Format · ${displayName(basename(activePath))}`
              : 'Format'}
          </div>
          <div className="st-fmt-grid">
            {EXPORT_CARDS.filter((c) => !c.temporal || hasComps).map((c) => (
              <button
                type="button"
                key={c.id}
                // Stable hooks for the export E2E harnesses (agent-browser web
                // + desktop-e2e native) — data-testid convention, DDR-231
                // Phase 2 T7/T8.
                data-testid={`export-format-${c.id}`}
                className={'st-fmt' + (c.id === sel ? ' is-on' : '')}
                disabled={laneBlocked(c)}
                title={
                  laneBlocked(c)
                    ? 'Needs the render service — not configured on this workspace'
                    : undefined
                }
                onClick={() => {
                  setSel(c.id);
                  setStatus(null);
                }}
              >
                <StIcon name={c.icon} size={16} />
                <span className="st-fmt-name">{c.label}</span>
                <span className="st-fmt-sub">{c.sub}</span>
              </button>
            ))}
          </div>
          {exportLane === 'none' && (
            <div className="st-dialog-note" data-testid="export-lane-note">
              PNG and SVG of the active artboard — and the PPTX deck — export right here in your
              browser; ZIP and AI handoff work too. PDF, video and other multi-artboard exports need
              the render service, which this workspace doesn&apos;t have configured — use the
              desktop app, or ask your admin to add the <code> maude-render</code> service (see the
              self-hosting docs).
            </div>
          )}
          {!card.handoff && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-scope">
                Scope
              </label>
              <select
                id="st-export-scope"
                data-testid="export-scope"
                className="st-select"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                {validScopes.map((s) => (
                  <option key={s} value={s}>
                    {EXPORT_SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!card.handoff && EXPORT_REGION_SCOPES.has(scope) && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-annotations">
                Annotations
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  id="st-export-annotations"
                  type="checkbox"
                  data-testid="export-include-annotations"
                  checked={includeAnnotations}
                  onChange={(e) => setIncludeAnnotations(e.target.checked)}
                />
                Include annotations
              </label>
            </div>
          )}
          {!card.handoff && card.format === 'png' && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-size">
                Resolution
              </label>
              <select
                id="st-export-size"
                className="st-select"
                value={pngResId}
                onChange={(e) => setPngResId(e.target.value)}
              >
                {PNG_RESOLUTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!card.handoff && card.format === 'png' && (
            <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              {(() => {
                const res = PNG_RESOLUTIONS.find((r) => r.id === pngResId) || PNG_RESOLUTIONS[1];
                const factor = res.kind === 'dpi' ? res.value / 96 : res.value;
                return `${res.label} ≈ ${Math.round(1440 * factor)}×${Math.round(900 * factor)} for a 1440×900 artboard.`;
              })()}
            </div>
          )}
          {!card.handoff && card.temporal && (
            <div className="st-dialog-row">
              <label className="st-dialog-lbl" htmlFor="st-export-temporal-size">
                Resolution
              </label>
              <select
                id="st-export-temporal-size"
                className="st-select"
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                {PNG_SCALES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!card.handoff && card.temporal && (
            <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              {scale}× the artboard's native resolution (e.g. 960×540 → {960 * scale}×{540 * scale}
              ).
            </div>
          )}
          {exportIsHeavy && (
            <div
              className="st-mono st-export-long-notice"
              data-testid="export-long-comp-notice"
              style={{ fontSize: 11, color: 'var(--accent)', lineHeight: 1.5 }}
            >
              ⚠ Long comp: {exportCompFrames} frames (≈
              {Math.round(exportCompFrames / exportCompFps)}s).
              {exportOverCap
                ? ` Exceeds the default ${EXPORT_DEFAULT_CAP}-frame export cap — exporting raises the cap to the full length for this run.`
                : ''}{' '}
              If the fast renderer falls back to frame-by-frame capture this can take several
              minutes; 2× resolution (≈720–1080p) is recommended for memory headroom.
            </div>
          )}
          {!card.handoff && card.format === 'pdf' && (
            <>
              <div className="st-dialog-row">
                <label className="st-dialog-lbl" htmlFor="st-export-pdf-dpi">
                  Image quality
                </label>
                <select
                  id="st-export-pdf-dpi"
                  className="st-select"
                  value={pdfDpiId}
                  onChange={(e) => setPdfDpiId(e.target.value)}
                >
                  {PDF_DPI_OPTIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                The page stays vector; this only sets the capture density for raster content on it
                (dropped photos, large-format art).
              </div>
              <div className="st-dialog-row">
                <label className="st-dialog-lbl" htmlFor="st-export-pdf-text">
                  Text
                </label>
                <select
                  id="st-export-pdf-text"
                  className="st-select"
                  data-testid="export-pdf-text"
                  value={pdfTextId}
                  onChange={(e) => setPdfTextId(e.target.value)}
                >
                  {PDF_TEXT_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                {PDF_TEXT_OPTIONS.find((t) => t.id === pdfTextId)?.description}
              </div>
              <div className="st-dialog-row">
                <label
                  className="st-dialog-lbl"
                  htmlFor="st-export-pdf-bleed"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                >
                  <input
                    id="st-export-pdf-bleed"
                    type="checkbox"
                    checked={pdfIncludeBleed}
                    onChange={(e) => setPdfIncludeBleed(e.target.checked)}
                  />
                  Include bleed
                </label>
              </div>
              <div className="st-dialog-row">
                <button
                  type="button"
                  className="st-dialog-lbl"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  onClick={() => setPdfMarksOpen((v) => !v)}
                  aria-expanded={pdfMarksOpen}
                >
                  {pdfMarksOpen ? '▾' : '▸'} Marks
                </button>
              </div>
              {pdfMarksOpen && (
                <div
                  style={{
                    padding: '0 12px 4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pdfMarksCrop}
                      onChange={(e) => setPdfMarksCrop(e.target.checked)}
                    />
                    Crop marks
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pdfMarksRegistration}
                      onChange={(e) => setPdfMarksRegistration(e.target.checked)}
                    />
                    Registration marks
                  </label>
                </div>
              )}
              <div className="st-mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                Bleed and marks apply to print (<code>kind="print"</code>) artboards only.
                {scope === 'canvas-as-separate' ? ' One PDF page per artboard.' : ''}
              </div>
            </>
          )}
          {!card.handoff && (card.format === 'mp4' || card.format === 'webm') && (
            <div className="st-dialog-row">
              <label
                className="st-dialog-lbl"
                htmlFor="st-export-audio"
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <input
                  id="st-export-audio"
                  type="checkbox"
                  checked={audio}
                  onChange={(e) => setAudio(e.target.checked)}
                />
                Export with audio
              </label>
            </div>
          )}
          {card.handoff && (
            <div className="callout callout--info" style={{ fontSize: 12 }}>
              Hands the active canvas off to production. Copies{' '}
              <span className="st-mono">/design:handoff &lt;path&gt;</span> — run it in Claude Code
              to emit a ready-to-drop production component next to the canvas.
            </div>
          )}
          {status && (
            <div
              className={'callout ' + (status.ok ? 'callout--success' : 'callout--error')}
              style={{ fontSize: 12 }}
              data-testid="export-status"
              data-ok={status.ok ? '1' : '0'}
            >
              {status.msg}
            </div>
          )}
          {recent.length > 0 && (
            <div className="st-export-recent" data-testid="export-recent">
              <div className="st-rp-hd">Recent</div>
              {recent.map((h, i) => (
                <div className="st-export-recent-row" key={i}>
                  <span>
                    {String(h.format || '').toUpperCase()} ·{' '}
                    {EXPORT_SCOPE_LABELS[h.scope] || h.scope}
                  </span>
                  <span className="st-mono">{h.filename}</span>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid={`export-recent-again-${i}`}
                    disabled={busy}
                    onClick={() => exportAgain(h)}
                  >
                    Export again
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="st-dialog-ft">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="export-submit"
            disabled={busy}
            onClick={doExport}
          >
            <StIcon name="download" size={14} />
            {card.handoff ? 'Copy handoff command' : busy ? 'Exporting…' : `Export ${card.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
