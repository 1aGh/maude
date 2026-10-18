// client/v2/export/run-export.js — S8.2: the sheet's ONE submit path (the Export button, a Recent row's
// Export again, and the handoff copy all end here).
//
// Ported from the v1 dialog's `runExport` (V2-2.8, DDR-231) with the same order of decisions:
//   1. the lane gate        a format this workspace cannot render is refused before any request;
//   2. the browser lane     png/svg of one known artboard, and the PowerPoint deck, are captured by the
//                           member's OWN browser in a workspace (no fleet wake) — `legacy` below;
//   3. the jobs lane        everything else posts to /_api/export-jobs and the sheet closes on enqueue:
//                           a v2 spec as `{v:2, spec}` (the ONE shape), a replayed history row exactly as
//                           it was stored (`{v:2, spec}` when the row kept its spec, else the v1 job).
// The sheet passes its callbacks in; nothing here touches React.

import {
  BROWSER_CAPTURE_FORMATS,
  BROWSER_SERVABLE_FORMATS,
  browserCaptureEligible,
  captureDeckViaBrowser,
  captureScale,
  recordBrowserExport,
  sanitizeCapturedItems,
} from '../../export-lane.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { basename } from '../../shell/util.js';
import { REFUSED_BROWSER_ONLY, REFUSED_NO_RENDER } from './export-copy.js';

/** Direct download for a browser-lane capture (a capture has no job, just the Blob). */
export function downloadCapturedBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'export';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay — an immediate revoke can race the download start in some engines.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Is `format` unrenderable in this workspace lane? (on a cell with no render service, `lane === 'none'`) */
export function laneBlocked(format, exportLane) {
  if (!format) return false;
  return (
    (exportLane === 'none' && format !== 'zip' && !BROWSER_SERVABLE_FORMATS.has(format)) ||
    // Canva bundles project files the render service can't reach — desktop only in every workspace lane
    (exportLane !== 'local' && format === 'canva')
  );
}

/** The body a history row re-submits: its own spec when it kept one, else the v1 job (scope fallback). */
export function replayBody(h, { isScopeValidForFormat, defaultScopeForFormat }) {
  if (h?.spec && typeof h.spec === 'object' && h.spec.v === 2) return { v: 2, spec: h.spec };
  const format = String(h?.format || '');
  const scope = isScopeValidForFormat(format, h?.scope) ? h.scope : defaultScopeForFormat(format);
  return { format, scope, options: { ...(h?.options ?? {}) } };
}

/**
 * @param o.body        what goes to /_api/export-jobs if no browser lane takes it
 * @param o.legacy      { format, scope, options } when the browser lane may take it, else null
 * @param o.exportLane  'local' | 'remote' | 'none'
 * @param o.ui          { setStatus, setBusy, onClose }
 */
export async function runExport({
  body,
  format,
  legacy,
  exportLane,
  onBrowserCapture,
  activePath,
  ui,
  fetchImpl = globalThis.fetch,
}) {
  const { setStatus, setBusy, onClose } = ui;
  if (laneBlocked(format, exportLane)) {
    setStatus({ ok: false, msg: REFUSED_NO_RENDER });
    return;
  }
  setBusy(true);
  setStatus(null);

  if (legacy && typeof onBrowserCapture === 'function') {
    const { scope, options } = legacy;
    const browserEligible =
      BROWSER_CAPTURE_FORMATS.has(legacy.format) &&
      browserCaptureEligible({
        exportLane,
        format: legacy.format,
        scope,
        artboardId: options.artboardId,
      });
    if (browserEligible) {
      try {
        setStatus({ ok: true, msg: 'Capturing…' });
        const items = await onBrowserCapture({
          format: legacy.format,
          artboardIds: [options.artboardId],
          scale: captureScale(options),
          onProgress: (current, total) =>
            setStatus({ ok: true, msg: `Capturing ${current}/${total}…` }),
        });
        // Validate before writing to disk — the capture bridge shares a window with tenant TSX, which can
        // forge a reply (DDR-231 security pass, F1): caps count/bytes, sniffs magic, forces name+MIME.
        const safeItems = await sanitizeCapturedItems(items, legacy.format);
        for (const it of safeItems) downloadCapturedBlob(it.name, it.blob);
        for (const it of safeItems)
          await recordBrowserExport({ format: legacy.format, scope, filename: it.name });
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
        // A render service exists — degrade to the jobs lane instead of a dead end.
      }
    }
    // DDR-231 — the pptx deck: capture every artboard as PNG in THIS browser, compose in-cell.
    if (
      legacy.format === 'pptx' &&
      browserCaptureEligible({ exportLane, format: 'pptx', scope })
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
          // Composition happens in-cell AFTER the last capture and is not instant for a 10-slide deck.
          onAssemble: () => setStatus({ ok: true, msg: 'Assembling deck…' }),
        });
        downloadCapturedBlob(filename, blob);
        await recordBrowserExport({ format: 'pptx', scope, filename });
        setBusy(false);
        setStatus({ ok: true, msg: `Saved ${filename} to your downloads.` });
        return;
      } catch (err) {
        if (exportLane !== 'remote') {
          setStatus({ ok: false, msg: `Deck export failed: ${(err && err.message) || err}` });
          setBusy(false);
          return;
        }
      }
    }
  }

  if (exportLane === 'none' && BROWSER_CAPTURE_FORMATS.has(format)) {
    // Without a render service the browser can only capture what it renders: one known artboard.
    setStatus({ ok: false, msg: REFUSED_BROWSER_ONLY });
    setBusy(false);
    return;
  }
  try {
    // feature-background-export-notification-center — enqueue and close; the Exports panel owns status,
    // progress and completion from here on.
    const r = await fetchImpl('/_api/export-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
