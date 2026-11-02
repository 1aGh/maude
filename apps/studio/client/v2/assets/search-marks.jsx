// client/v2/assets/search-marks.jsx — where a search word was seen in a picture (S8.20; 12 · ia-assets-find col 3).
//
// Under a "Seen in the picture" tile: the words AI saw, the matched ones marked — the caption when the word is there,
// else the words visible in the picture, else the tags. Ranges come from the one matcher (index/match.ts `seenMarks`,
// computed by the studio over the UNFOLDED text). The text is a model's words: plain text nodes only, never markup.

/** Split `text` into plain and marked runs by sorted, non-overlapping [from, to) ranges. */
export function markRuns(text, ranges) {
  const s = String(text ?? '');
  const out = [];
  let at = 0;
  for (const r of Array.isArray(ranges) ? ranges : []) {
    const a = Math.max(at, Math.min(s.length, Number(r?.[0]) || 0));
    const b = Math.max(a, Math.min(s.length, Number(r?.[1]) || 0));
    if (a > at) out.push({ t: s.slice(at, a), on: false });
    if (b > a) out.push({ t: s.slice(a, b), on: true });
    at = b;
  }
  if (at < s.length) out.push({ t: s.slice(at), on: false });
  return out;
}

/** The field a hit's line shows, with its ranges. */
export function seenLineOf(hit) {
  const m = hit?.marks ?? {};
  if (m.caption?.length) return { field: 'caption', text: hit.caption, ranges: m.caption };
  if (m.text?.length) return { field: 'text', text: hit.text, ranges: m.text };
  const tags = Array.isArray(hit?.tags) ? hit.tags : [];
  if (m.tags?.length) {
    // "touchdown · night game": the marked tags first, whole
    const picked = m.tags.map((i) => tags[i]).filter(Boolean);
    let at = 0;
    const ranges = picked.map((t) => {
      const r = [at, at + t.length];
      at += t.length + 3;
      return r;
    });
    return { field: 'tags', text: picked.join(' · '), ranges };
  }
  return { field: 'caption', text: hit?.caption ?? '', ranges: [] };
}

/** One line of marked text. */
export function Marked({ text, ranges, className = 'lp-seen-t' }) {
  return (
    <span className={className}>
      {markRuns(text, ranges).map((r, i) =>
        r.on ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional and never reorder
          <mark key={i} className="lp-seen-m">
            {r.t}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs are positional and never reorder
          <span key={i}>{r.t}</span>
        )
      )}
    </span>
  );
}

/** Under a tile in "Seen in the picture". */
export function SeenLine({ hit }) {
  const line = seenLineOf(hit);
  return (
    <span
      className="lp-seen-line"
      data-testid="assets-seen-line"
      data-field={line.field}
      title={line.text}
    >
      <Marked text={line.text} ranges={line.ranges} />
    </span>
  );
}
