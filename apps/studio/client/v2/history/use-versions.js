// client/v2/history/use-versions.js — S1.14: Version history's data (11 · pn-history, V2-1.9 §5.11).
//
//   useVersions({ path, filter, refreshKey }) → { status, rows, now, offline, hasMore, loadMore, retry }
//   dayGroups(rows, nowMs)       Today / Yesterday / "4 Oct" (+ year when it is not this one), newest first
//   mergeFresh(prev, fresh)      a re-read of page one replaces its rows and keeps the older pages already loaded
//   wantsPictures(rows)          is any row's picture still being drawn (the panel looks again, softly)
//   restoreLine(row, answer)     the toast's words: the server's `line`, else "Restored “name”" / "Restored 5 Oct, 18:40"
//   viewingWords(row)            the words the Viewing bar and the shell's hold carry
//
// The server (`GET /_api/project/versions`, S1.12b) judges access and derives the rows (rule G, S1.12); the
// panel only reads them. Rows come newest first; `next` pages back (`before=<rev>`). A failed read is
// "Couldn't load versions" + "Retry versions" — pressed by hand, never automatic (CONTRACT §4, C20).

import { useCallback, useEffect, useRef, useState } from 'react';

export const FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'named', label: 'Named' },
  { id: 'ai', label: 'Made by AI' },
  { id: 'people', label: 'People' },
]);

/** Every sentence the panel says (CONTRACT §3–§4: no "we", what happened · what is safe · one verb). */
export const HISTORY_WORDS = Object.freeze({
  title: 'Version history',
  close: 'Close Version history',
  filters: 'Show versions',
  now: 'Now',
  name: 'Name this version…',
  saving: 'Saving…',
  empty: 'Versions appear here as you work.',
  emptyNote: "Every change is kept on its own. There's nothing to save.",
  emptyFilter: Object.freeze({
    named: 'No named versions yet.',
    ai: 'Nothing made by AI yet.',
    people: 'Nothing made by people yet.',
  }),
  emptyFilterNote: Object.freeze({
    named: 'Name a version from the Now row and it stays at the top.',
    ai: 'Versions AI makes show here.',
    people: 'Versions people make show here.',
  }),
  failed: "Couldn't load versions",
  failedNote: 'Your work is safe.',
  retry: 'Retry versions',
  older: 'Show older versions',
  restore: 'Restore this version',
  restoring: 'Restoring…',
  compare: 'Compare',
  restoreFailed: "Couldn't restore that version. Nothing changed.",
  restoreServer: "The team server didn't take the restore.",
  retryRestore: 'Retry restore',
  restoreGone: 'That version is no longer in the list. Nothing changed.',
  undo: 'Undo',
  undone: 'Restore undone.',
  undoFailed: "Can't undo — someone changed it since.",
  viewing: 'Viewing',
  backToNow: 'back to now',
  nameTitle: 'Name this version',
  namePlaceholder: 'Name',
  nameSave: 'Name version',
  nameCancel: 'Cancel',
  nameTooLong: 'A name can be up to 80 characters.',
  nameFailed: "Couldn't name that version. Nothing changed.",
  nameNeedsHub: 'Naming versions needs the team server to be updated.',
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "5 Oct, 18:40" — CONTRACT §4 absolute time (24-hour, local). */
export function formatWhen(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** The group a row sits under: Today · Yesterday · "4 Oct" (· "4 Oct 2025" in another year). */
export function groupLabel(ms, nowMs) {
  const day = startOfDay(ms);
  const today = startOfDay(nowMs);
  if (day >= today) return 'Today'; // the future (a skewed clock) reads as today
  if (day === startOfDay(today - 12 * 3_600_000)) return 'Yesterday';
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(nowMs).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Rows (newest first) → `[{ group, rows }]`, groups in the order met. */
export function dayGroups(rows, nowMs = Date.now()) {
  const out = [];
  for (const row of rows) {
    const label = groupLabel(row.madeAt, nowMs);
    const last = out[out.length - 1];
    if (last && last.group === label) last.rows.push(row);
    else out.push({ group: label, rows: [row] });
  }
  return out;
}

/**
 * A re-read of page one (`fresh`) replaces the rows it covers; rows already loaded from older pages stay.
 * "Older" = made before the oldest fresh row, and not among the fresh ones.
 */
export function mergeFresh(prev, fresh) {
  if (!prev.length || !fresh.length) return fresh;
  const ids = new Set(fresh.map((r) => r.id));
  const oldest = fresh[fresh.length - 1].madeAt;
  return [...fresh, ...prev.filter((r) => !ids.has(r.id) && r.madeAt < oldest)];
}

/** Is any row's picture still being drawn? */
export const wantsPictures = (rows) => rows.some((r) => r.picture?.status === 'pending');

/** "Restored “name”" / "Restored 5 Oct, 18:40" — what the toast says about a restore. */
export function restoreLine(row, answer) {
  if (typeof answer?.line === 'string' && answer.line) return answer.line;
  return row.named?.name ? `Restored “${row.named.name}”` : `Restored ${formatWhen(row.madeAt)}`;
}

/** The Viewing bar's words and the shell hold's fields for one row: "Viewing “…” · 5 Oct, 18:40 · Jonas". */
export function viewingWords(row) {
  return {
    at: row.ref,
    title: row.named?.name || row.title,
    when: formatWhen(row.madeAt),
    who: row.who?.kind === 'ai' ? 'AI' : (row.who?.name ?? ''),
  };
}

/** `GET /_api/project/versions` for one page. */
export function versionsUrl({ path, filter = 'all', before = null, limit = 50 }) {
  const q = new URLSearchParams({ path, filter, limit: String(limit) });
  if (before != null) q.set('before', before);
  return `/_api/project/versions?${q}`;
}

const postJson = (fetchImpl, url, body) =>
  fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * "Restore this version": a NEW version (C5), one undo step. Success toasts the action's own line
 * ("Restored 5 Oct, 18:40") with Undo; a hub that did not take it says so with Retry restore (C20).
 * @returns { ok, actionId?, reason? }
 */
export async function restoreVersion({ path, row, toast, fetchImpl, onChanged }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  let r = null;
  let j = null;
  try {
    r = await postJson(f, '/_api/project/restore', { path, at: row.ref });
    j = await r.json().catch(() => null);
  } catch {
    /* unreachable: below */
  }
  if (r?.ok && j?.ok) {
    onChanged?.(j);
    const line = restoreLine(row, j);
    if (j.actionId && !j.queued) {
      toast?.(line, true, {
        label: HISTORY_WORDS.undo,
        onClick: async () => {
          let ur = null;
          let uj = null;
          try {
            ur = await postJson(f, '/_api/project/undo', { actionId: j.actionId });
            uj = await ur.json().catch(() => null);
          } catch {
            /* below */
          }
          if (ur?.ok && uj?.ok) {
            onChanged?.(uj);
            toast?.(HISTORY_WORDS.undone, true);
          } else toast?.(HISTORY_WORDS.undoFailed, false);
        },
      });
    } else toast?.(line, true);
    return { ok: true, actionId: j.actionId ?? null };
  }
  const reason = j?.reason ?? (r ? 'rejected' : 'unreachable');
  if (!r || r.status === 503 || reason === 'unreachable')
    toast?.(HISTORY_WORDS.restoreServer, false, {
      label: HISTORY_WORDS.retryRestore,
      onClick: () => restoreVersion({ path, row, toast, fetchImpl, onChanged }),
    });
  else toast?.(j?.line || HISTORY_WORDS.restoreFailed, false);
  return { ok: false, reason };
}

/** "Name this version…": the newest version (`at`) gets `name` (null clears). */
export async function nameVersion({ path, at, name, fetchImpl, onChanged }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  let r = null;
  let j = null;
  try {
    r = await postJson(f, '/_api/project/name', { path, at, name });
    j = await r.json().catch(() => null);
  } catch {
    /* below */
  }
  if (r?.ok && j?.ok) {
    onChanged?.(j);
    return { ok: true };
  }
  return {
    ok: false,
    error: j?.reason === 'hub-too-old' ? HISTORY_WORDS.nameNeedsHub : HISTORY_WORDS.nameFailed,
  };
}

const PICTURE_POLLS_MS = [1500, 3000, 5000, 8000, 12000, 20000];
/** The shell turns the socket's `{type:'thumb-ready'}` into this window event (app.jsx). */
export const THUMB_EVENT = 'maude:thumb-ready';

const EMPTY = { status: 'loading', rows: [], now: null, offline: null, next: null };

/**
 * @param o.path        the canvas (repo-relative); null = nothing to list
 * @param o.filter      all · named · ai · people
 * @param o.refreshKey  anything that changes when a version may have landed (the applied revision, a restore)
 * @param o.enabled     false while the panel is closed: nothing is read
 */
export function useVersions({ path, filter = 'all', refreshKey = 0, enabled = true, fetchImpl }) {
  const [state, setState] = useState(EMPTY);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0); // a manual Retry or a soft picture re-read
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const live = useRef({ path, filter, state });
  live.current = { path, filter, state };
  const polls = useRef(0);

  const read = useCallback(async (before) => {
    const { path: p, filter: f } = live.current;
    const r = await fetchRef.current(versionsUrl({ path: p, filter: f, before }), {
      cache: 'no-store',
    });
    const data = await r.json().catch(() => null);
    return data?.ok ? { ok: true, data } : { ok: false };
  }, []);

  // Another canvas or filter: the old list goes at once (never canvas A's versions under canvas B).
  const lastKey = useRef(`${path}|${filter}`);
  useEffect(() => {
    const key = `${path}|${filter}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    polls.current = 0;
    setState(EMPTY);
  }, [path, filter]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey / nonce are the "read again" signals
  useEffect(() => {
    if (!enabled || !path) return undefined;
    let cancelled = false;
    (async () => {
      let res;
      try {
        res = await read(null);
      } catch {
        res = { ok: false };
      }
      if (cancelled) return;
      if (!res.ok) {
        // With a list on screen a failed re-read changes nothing; with none it is the error state.
        setState((s) => (s.rows.length ? s : { ...EMPTY, status: 'error' }));
        return;
      }
      const d = res.data;
      setState((s) => ({
        status: 'ready',
        rows: mergeFresh(s.rows, d.rows ?? []),
        now: d.now ?? null,
        offline: d.offline?.line ?? null,
        next: s.next != null && s.rows.length > (d.rows ?? []).length ? s.next : (d.next ?? null),
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, path, filter, refreshKey, nonce, read]);

  // Pictures still being drawn: look again when the server says one landed, and on a soft schedule.
  const pending = state.status === 'ready' && wantsPictures(state.rows);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` re-arms the next poll after each read
  useEffect(() => {
    if (!enabled || !pending) return undefined;
    const again = () => setNonce((n) => n + 1);
    let timer = null;
    const wait = PICTURE_POLLS_MS[polls.current];
    if (wait !== undefined)
      timer = setTimeout(() => {
        polls.current += 1;
        again();
      }, wait);
    let debounce = null;
    const onReady = () => {
      clearTimeout(debounce);
      debounce = setTimeout(again, 250);
    };
    window.addEventListener(THUMB_EVENT, onReady);
    return () => {
      clearTimeout(timer);
      clearTimeout(debounce);
      window.removeEventListener(THUMB_EVENT, onReady);
    };
  }, [enabled, pending, nonce]);

  const loadMore = useCallback(async () => {
    const { state: s } = live.current;
    if (s.next == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await read(s.next);
      if (res.ok)
        setState((cur) => {
          const have = new Set(cur.rows.map((r) => r.id));
          return {
            ...cur,
            rows: [...cur.rows, ...(res.data.rows ?? []).filter((r) => !have.has(r.id))],
            next: res.data.next ?? null,
          };
        });
    } catch {
      /* the button stays: pressed again by hand */
    } finally {
      setLoadingMore(false);
    }
  }, [read, loadingMore]);

  const retry = useCallback(() => {
    polls.current = 0;
    setState((s) => (s.status === 'error' ? { ...s, status: 'loading' } : s));
    setNonce((n) => n + 1);
  }, []);

  return { ...state, hasMore: state.next != null, loadingMore, loadMore, retry };
}
