// client/v2/export/video-content.js — S8.6: what the Export sheet's video part offers for a video artboard
// (contract S7 ↔ S8: `videoExportContent(canvas, artboardIds) → { formats, soundOnly, captions, maxFrames }`).
//
//   formats    [{ artboardId, label, size, linked, ticked }] — the selected artboards, and their linked
//              formats (S7 Q4: video artboards whose `<VideoComp component={X}>` name the same comp), each
//              ticked by default; an unlinked copy arrives unticked
//   soundOnly  'shared' — Sound only is the same mix as the video, so it follows the ticks
//   captions   { available, defaultMode: 'off' } — Off by default (C19); `available` = the comp has speech
//   maxFrames  the artboard's own cap with Allow longer (`artboardMeta[id].maxFrames`), else null
//
// S7.19 replaces the body below with the real derivation. Until then ("if S7's selectors are absent,
// fall back to the artboard only") the sheet offers exactly the artboards the estimate says the spec
// reaches — `known` — each ticked, none linked, no captions to burn in. The export itself never depends
// on this: the ticks become the spec's `selection.artboards`, so the server runs what the sheet shows.

/**
 * @param {string|null} _canvas designRoot-relative canvas
 * @param {string[]} artboardIds the selected video artboards
 * @param {Array<{artboard:string,label:string,w:number|null,h:number|null}>} known the estimate's video rows
 */
export function videoExportContent(_canvas, artboardIds = [], known = []) {
  const want = new Set(artboardIds);
  const rows = known.filter((r) => want.size === 0 || want.has(r.artboard));
  return {
    formats: rows.map((r) => ({
      artboardId: r.artboard,
      label: r.label,
      size: r.w && r.h ? `${r.w} × ${r.h}` : '',
      linked: false,
      ticked: true,
    })),
    soundOnly: 'shared',
    captions: { available: false, defaultMode: 'off' },
    maxFrames: null,
  };
}
