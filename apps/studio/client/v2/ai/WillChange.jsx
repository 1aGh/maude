// client/v2/ai/WillChange.jsx — 03 `PERM_DETAIL` (`.ai-perm-list`): what a waiting permission is about, as 28 x 22
// artboard tiles and their names. There is no per-artboard picture in the index (only a canvas cover), so a
// tile is the neutral artboard shape until one exists; the names carry the meaning either way.

export function WillChange({ boards = [], more = 0 }) {
  const list = Array.isArray(boards) ? boards : boards?.boards || [];
  const extra = Array.isArray(boards) ? more : (boards?.more ?? 0);
  if (list.length === 0) return null;
  const names = list.map((b) => b.label).join(' · ');
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
