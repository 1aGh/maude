// client/v2/ai/video/card-model.js — S7.15: the words of the AI cut's chat cards (07 · ve-ai-watch, ve-ai-cut,
// ve-ai-scrub, ve-ai-proposal, ve-ai-adjust). Pure: every line is built from the run's derived `progress`
// (ai/watch-progress.ts, ai/run-progress.ts) — its numbers, the clips' names and the notes of their footage —
// never from what the model said. The components (ClipsAttached, WatchProgress, LeftOut) only draw these.

/** 3 → "0:03", 65 → "1:05", 4210 → "1:10:10". */
export function mmss(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** How many found lines the card shows. */
export const FOUND_SHOWN = 3;

/** "A", "A and B", "A, B and C". */
export function nameList(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/**
 * The line under your ask: "12 clips · 1:20 of footage · from Assets". Null when the run has no attached
 * footage (a progress without clips, or no progress at all).
 */
export function clipsAttachedModel(progress) {
  const count = Array.isArray(progress?.clips)
    ? progress.clips.length
    : Number(progress?.watched) || 0;
  if (!count) return null;
  const assets = (progress.clips ?? []).map((c) => c.asset).slice(0, 3);
  return {
    count,
    assets,
    title: `${count} ${count === 1 ? 'clip' : 'clips'}`,
    meta: `${progress.footageSec ? `${mmss(progress.footageSec)} of footage · ` : ''}from Assets`,
  };
}

/** The watch card: the title, one tile per clip and the last few found lines. Null unless the run is watching. */
export function watchModel(progress) {
  if (progress?.kind !== 'watch' || !Array.isArray(progress.clips)) return null;
  const done = Number(progress.done) || 0;
  const total = Number(progress.total) || progress.clips.length;
  const found = (progress.found ?? []).slice(-FOUND_SHOWN).map((f) => ({
    asset: f.asset,
    at: mmss(f.at),
    line: f.line,
  }));
  return {
    title: progress.label || `Watching ${total} clips… ${done} done`,
    done,
    total,
    allDone: total > 0 && done >= total,
    tiles: progress.clips.map((c) => ({ asset: c.asset, name: c.name, state: c.state })),
    found,
  };
}

/**
 * "archiv-orange-nastup and promo-kabina are too dark; dron-areal-klesani is shaky" — the clips left out, grouped
 * by the note of their footage, in the order they were dropped. A clip whose footage gave no reason says so.
 */
export function leftOutSentence(leftOut) {
  const groups = [];
  for (const c of leftOut ?? []) {
    const why = (c.why || '').trim();
    const g = groups.find((x) => x.why === why);
    if (g) g.names.push(c.name);
    else groups.push({ why, names: [c.name] });
  }
  return groups
    .map((g) => {
      const list = nameList(g.names);
      if (!g.why) return `${list} had no usable shot`;
      return `${list} ${g.names.length === 1 ? 'is' : 'are'} ${g.why}`;
    })
    .join('; ');
}

/**
 * The left-out lines of a cut. While shots are still landing: "Watched all 12. Left out 3: …" as a message from
 * AI. Once the run has ended: "Left out: …." with Use them anyway. Null when nothing is left out (or known).
 */
export function leftOutModel(progress, { ended }) {
  if (progress?.kind !== 'place') return null;
  const left = progress.leftOut ?? [];
  const watched = Number(progress.watched) || 0;
  if (!ended) {
    if (!watched) return null;
    const head = `Watched all ${watched}.`;
    if (!left.length) return { text: head, left: [] };
    return { text: `${head} Left out ${left.length}: ${leftOutSentence(left)}.`, left };
  }
  if (!left.length) return null;
  return { text: `Left out: ${leftOutSentence(left)}.`, left };
}

/** Use them anyway is a new ask, in the person's own register. */
export function anywayAsk(left) {
  const names = (left ?? []).map((c) => c.name);
  if (!names.length) return '';
  return `Use ${nameList(names)} anyway.`;
}
