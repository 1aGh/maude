// client/v2/assets/describe-client.js — search in pictures, the Assets tab's half (S8.20; 12 · ia-assets-find,
// 05 · es-search-more; contract V2-1.17 §5.9, CONTRACT §7).
//
// The studio holds the answer and the words (`/_api/describe`, routes/describe.ts); this file only reads them, sends
// the person's answer, and words the lines. It never decides alone: consent is asked once per project, per person, on
// this Mac, and a studio that does not serve the route (a cloud tab, an older studio) is simply "names and tags".
//
// What AI saw is a model's words: the studio validated them (length caps, no markup, no control characters), and they
// are drawn as plain text — never as HTML, never as a link.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Poll while pictures are being described (the studio announces nothing for it). */
export const DESCRIBE_POLL_MS = 4000;
export const DESCRIBE_EVENT = 'maude:describe-changed';

/** @returns {Promise<{ status: object, hits: object[] } | null>} null = the studio does not describe here */
export async function readDescribe(get, q = '') {
  try {
    const r = await get(`/_api/describe${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.ok || !j.status) return null;
    return { status: j.status, hits: Array.isArray(j.hits) ? j.hits : [] };
  } catch {
    return null;
  }
}

async function post(get, path, body) {
  try {
    const r = await get(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return r.ok && j?.ok ? j.status : null;
  } catch {
    return null;
  }
}

const announce = () => {
  try {
    window.dispatchEvent(new CustomEvent(DESCRIBE_EVENT));
  } catch {
    /* no window (a test) */
  }
};

/** The person's answer to "Describe the pictures in <project>?" (Describe pictures = true, Cancel / off = false). */
export async function sendConsent(on, get = (...a) => fetch(...a)) {
  const s = await post(get, '/_api/describe/consent', { on });
  announce();
  return s;
}

/** Stop / Resume in the progress line. */
export async function sendStop(stopped, get = (...a) => fetch(...a)) {
  const s = await post(get, '/_api/describe/stop', { stopped });
  announce();
  return s;
}

/**
 * Which line search offers, if any.
 *   'turn-on'  never asked here, AI connected — "Search what's in the pictures too?" · Turn on…
 *   'connect'  AI is not connected — "Connect your Claude account to search what's in pictures, too." · Connect…
 *   null       asked already (yes or no), or this studio does not describe
 */
export function offerOf(status, canAsk) {
  if (!status || status.consent?.asked) return null;
  return canAsk ? 'turn-on' : 'connect';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Describing 12 of 193 pictures" while on and not done; "" otherwise. */
export function progressWords(status) {
  if (!status?.consent?.on || !status.total || status.done >= status.total) return '';
  if (status.paused === 'stopped')
    return `Stopped at ${status.done} of ${plural(status.total, 'picture', 'pictures')}`;
  return `Describing ${status.done} of ${plural(status.total, 'picture', 'pictures')}`;
}

/**
 * The foot under a search (12 · ia-assets-find):
 *   off, AI connected   "Searched 247 assets — names and tags"
 *   no AI               "Searched 247 assets — names only"
 *   on, still going     "5 results · 35 pictures still being described"
 *   on, all described   "5 results in 247 assets"
 */
export function searchFootWords({ count, results, status, canAsk }) {
  if (status?.consent?.on) {
    const left = Math.max(0, (status.total || 0) - (status.done || 0));
    const res = plural(results, 'result', 'results');
    return left
      ? `${res} · ${plural(left, 'picture', 'pictures')} still being described`
      : `${res} in ${count} assets`;
  }
  return canAsk
    ? `Searched ${count} assets — names and tags`
    : `Searched ${count} assets — names only`;
}

/** The describe state for the Assets tab: status always, hits for the live query. */
export function useDescribe({ fetchImpl, query = '' } = {}) {
  const [state, setState] = useState({ status: null, hits: [], q: '' });
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const alive = useRef(true);
  const want = useRef(query);
  want.current = query;

  const reload = useCallback(async () => {
    const q = want.current.trim();
    const got = await readDescribe((...a) => fetchRef.current(...a), q);
    if (!alive.current || want.current.trim() !== q) return;
    setState(got ? { status: got.status, hits: got.hits, q } : { status: null, hits: [], q });
  }, []);

  // the query changing IS the trigger (debounced while typing)
  useEffect(() => {
    const t = setTimeout(reload, query ? 150 : 0);
    return () => clearTimeout(t);
  }, [query, reload]);

  useEffect(() => {
    alive.current = true;
    const on = () => void reload();
    window.addEventListener(DESCRIBE_EVENT, on);
    return () => {
      alive.current = false;
      window.removeEventListener(DESCRIBE_EVENT, on);
    };
  }, [reload]);

  const s = state.status;
  const going = !!s?.consent?.on && !s.paused && s.total > s.done;
  useEffect(() => {
    if (!going) return;
    const t = setInterval(() => void reload(), DESCRIBE_POLL_MS);
    return () => clearInterval(t);
  }, [going, reload]);

  return {
    status: s,
    hits: state.q === query.trim() ? state.hits : [],
    reload,
    consent: (on) => sendConsent(on, (...a) => fetchRef.current(...a)).then(reload),
    stop: (stopped) => sendStop(stopped, (...a) => fetchRef.current(...a)).then(reload),
  };
}
