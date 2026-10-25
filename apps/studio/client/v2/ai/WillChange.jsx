// client/v2/ai/WillChange.jsx — 03 `PERM_DETAIL` (`.ai-perm-list`): what a waiting permission is about, as 28 x 22
// artboard tiles and their names. There is no per-artboard picture in the index (only a canvas cover), so a
// tile is the neutral artboard shape until one exists; the names carry the meaning either way.

/**
 * The names under the tiles. Artboards of one family share a lead ("Foto · obrana", "Foto · útok"): the lead is said
 * once by the tiles' neighbours' context, so the names read "Obrana, útok, speciální týmy, trenéři" (03 PERM_DETAIL).
 * Names with nothing in common keep the " · " the strip always used.
 */
export function willNames(labels) {
  const list = (labels || []).map((l) => String(l ?? ''));
  const lead = (l) => (l.includes(' · ') ? l.slice(0, l.indexOf(' · ')) : null);
  const first = lead(list[0] ?? '');
  if (list.length > 1 && first && list.every((l) => lead(l) === first)) {
    const rest = list.map((l) => l.slice(first.length + 3));
    const joined = rest.join(', ');
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  }
  return list.join(' · ');
}

export function WillChange({ boards = [], more = 0 }) {
  const list = Array.isArray(boards) ? boards : boards?.boards || [];
  const extra = Array.isArray(boards) ? more : (boards?.more ?? 0);
  if (list.length === 0) return null;
  const names = willNames(list.map((b) => b.label));
  return (
    <div className="ai-nc-will" data-testid="ai-permission-will">
      {list.map((b) => (
        <span key={b.id} className="ai-nc-will-th" aria-hidden="true" data-art={b.id}>
          {b.thumb ? <img src={b.thumb} alt="" draggable={false} /> : null}
        </span>
      ))}
      <span className="ai-nc-will-names">
        {names}
        {extra > 0 ? ` · +${extra}` : ''}
      </span>
    </div>
  );
}
