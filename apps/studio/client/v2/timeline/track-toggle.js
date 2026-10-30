// client/v2/timeline/track-toggle.js — P8 C8: the per-track view / volume button in the Full timeline's gutter
// (07 · `.ve-lab-b`: an eye on Text and Graphics, a speaker on Video and Music; the speaker turns to "mute" when every
// clip on the track is muted).
//
// Pure: the Timeline hands in the members of one track, it gets back what the button shows and the ONE `clip.track`
// edit op it sends (a single write → a single undo step, edit-ops/clip/track.ts). Hide is the clip menu's Hide
// (`{false && (…)}`, the clip keeps its slot and is never exported); mute is the bare `muted` attribute.

export const TRACK_BUTTON = {
  text: 'view',
  gfx: 'view',
  video: 'volume',
  video2: 'volume',
  music: 'volume',
  music2: 'volume',
};

/**
 * @param {string} id the track id ('text' | 'gfx' | 'video' | 'video2' | 'music' | 'music2')
 * @param {string} label the track's name as the chip draws it
 * @param {{ seqs?: object[], beds?: object[] }} members parsed sequences on the track, and the media entries of its loose beds
 * @returns {{ kind: 'view'|'volume', ids: string[], off: boolean, glyph: string, label: string,
 *   params: { ids: string[], hidden?: boolean, muted?: boolean } }}
 */
export function trackToggle(id, label, { seqs = [], beds = [] } = {}) {
  const kind = TRACK_BUTTON[id] ?? 'view';
  if (kind === 'view') {
    const rows = seqs.filter((s) => s?.stableId);
    const ids = rows.map((s) => s.stableId);
    const off = rows.length > 0 && rows.every((s) => s.hidden);
    return {
      kind,
      ids,
      off,
      glyph: 'view',
      label: off ? `Show ${label}` : `Hide ${label}`,
      params: { ids, hidden: !off },
    };
  }
  const rows = [
    ...seqs
      .filter((s) => s?.stableId && s.mediaProps)
      .map((s) => ({ id: s.stableId, muted: !!s.mediaProps.muted })),
    ...beds.filter((b) => b?.stableId).map((b) => ({ id: b.stableId, muted: !!b.muted })),
  ];
  const ids = rows.map((r) => r.id);
  const off = rows.length > 0 && rows.every((r) => r.muted);
  return {
    kind,
    ids,
    off,
    glyph: off ? 'mute' : 'volume',
    label: off ? `Unmute ${label}` : `Mute ${label}`,
    params: { ids, muted: !off },
  };
}
