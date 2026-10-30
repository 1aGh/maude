// client/v2/export/video-content.js — S8.6 / S7.19: what the Export sheet's video part offers for a video artboard
// (contract S7 ↔ S8: `videoExportContent(canvas, artboardIds, known) → { formats, soundOnly, captions, maxFrames }`).
//
//   formats    [{ artboardId, label, size, linked, ticked }] — the selected artboards and the formats around them
//              (S7 Q4: video artboards whose `<VideoComp component={X}>` name the same comp), each ticked by
//              default; an unlinked copy ("its own cut") arrives unticked, unless it is the artboard asked for
//   soundOnly  'shared' — Sound only is the same mix as the video, so the formats share their sound
//   captions   { available, defaultMode: 'off' } — Off by default (C19); `available` = the cut has speech
//   maxFrames  the artboard's own stored ceiling (`artboardMeta[id].maxFrames`), else null
//
// The numbers come from the SERVER's estimate rows (`exporters/video-cap.ts videoInfo` — each row carries the
// formats of its artboard as `video/linked-formats.ts` derives them), so this module has no parser and does no
// IO. A row that carries no `formats` (an older server, a comp whose source did not parse) is read as "the
// artboard only" — the S8.6 fallback — and the export never depends on this: the ticks become the spec's
// `selection.artboards`, so the server runs what the sheet shows.

/**
 * @param {string|null} canvas designRoot-relative canvas
 * @param {string[]} artboardIds the selected video artboards (empty = every video artboard of the canvas)
 * @param {Array<object>} known the estimate's video rows: `{ canvas?, artboard, label, w, h, stored?, speech?, formats? }`
 */
export function videoExportContent(canvas, artboardIds = [], known = []) {
  const mine = known.filter((r) => !canvas || !r.canvas || r.canvas === canvas);
  const want = new Set(artboardIds);
  const rows = mine.filter((r) => want.size === 0 || want.has(r.artboard));
  const byId = new Map(mine.map((r) => [r.artboard, r]));

  const merged = new Map();
  const put = (id, f) => {
    const old = merged.get(id);
    if (!old) merged.set(id, f);
    // one reader says "unlinked copy" and another does not (the copy's own row): the copy wins
    else merged.set(id, { ...old, linked: old.linked || f.linked, copy: old.copy || f.copy });
  };
  for (const r of rows) {
    const own = Array.isArray(r.formats) && r.formats.length > 0 ? r.formats : null;
    if (!own) {
      put(r.artboard, {
        label: r.label,
        size: r.w && r.h ? `${r.w} × ${r.h}` : '',
        linked: false,
        copy: false,
      });
      continue;
    }
    for (const f of own) {
      const row = byId.get(f.artboard);
      put(f.artboard, {
        label: row?.label ?? f.label ?? f.name ?? f.artboard,
        size: f.size || (row?.w && row?.h ? `${row.w} × ${row.h}` : ''),
        linked: f.linked === true,
        copy: f.copy === true,
      });
    }
  }

  const formats = [...merged.entries()].map(([artboardId, f]) => ({
    artboardId,
    label: f.label,
    size: f.size,
    linked: f.linked && !f.copy,
    // an unlinked copy has its own cut, so it arrives unticked — unless it is the very artboard asked for
    ticked: !f.copy || want.has(artboardId),
  }));

  const stored = rows
    .map((r) => r.stored)
    .filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  return {
    formats,
    soundOnly: 'shared',
    captions: { available: rows.some((r) => r.speech === true), defaultMode: 'off' },
    maxFrames: stored.length ? Math.max(...stored) : null,
  };
}
