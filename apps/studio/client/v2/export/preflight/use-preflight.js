// client/v2/export/preflight/use-preflight.js — S8.7: ask `POST /_api/export-preflight` what the Print PDF
// is made of (paper, the back, safe margin, fonts). Re-asked only when WHAT is exported changes (scope,
// canvas, selection) — not when a Bleed or Crop marks box is ticked, which the preview answers by itself.
// A server that cannot answer leaves `null`: the sheet then shows the paper it knows and no warnings.

import { useEffect, useMemo, useState } from 'react';

const DEBOUNCE_MS = 150;

/** The part of the spec the answer depends on: no format options, always a PDF. */
export function preflightSpec(spec) {
  const { v, scope, canvas, folder, selection, region, unit, at } = spec;
  return {
    v,
    scope,
    format: 'pdf',
    ...(canvas ? { canvas } : {}),
    ...(folder ? { folder } : {}),
    ...(selection ? { selection } : {}),
    ...(region ? { region } : {}),
    ...(unit ? { unit } : {}),
    ...(at ? { at } : {}),
  };
}

/**
 * `measure: false` asks for the paper, the back and the fonts WITHOUT the safe-margin render (a headless render of
 * the canvas, seconds long): the preview draws at once, and `usePreflight` asks again with it.
 */
export async function fetchPreflight(
  spec,
  signal,
  fetchImpl = globalThis.fetch,
  { measure = true } = {}
) {
  const r = await fetchImpl('/_api/export-preflight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spec: preflightSpec(spec), ...(measure ? {} : { measure: false }) }),
    signal,
  });
  if (!r.ok) return null;
  const body = await r.json();
  return body && typeof body === 'object' && Array.isArray(body.boards) ? body : null;
}

/** The reply for `spec`, or null until it comes (or when it cannot). */
export function usePreflight(spec, { enabled = true } = {}) {
  const [reply, setReply] = useState(null);
  const key = useMemo(() => JSON.stringify(preflightSpec(spec)), [spec]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` IS the spec's relevant part
  useEffect(() => {
    if (!enabled) return undefined;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      // the quick answer: what the page IS. A slow measurement must not keep the preview on "Drawing the page…"
      fetchPreflight(spec, ctl.signal, globalThis.fetch, { measure: false })
        .then((r) => {
          if (!ctl.signal.aborted && r) setReply((prev) => prev ?? r);
        })
        .catch(() => {});
      fetchPreflight(spec, ctl.signal)
        .then((r) => {
          if (!ctl.signal.aborted) setReply(r);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [key, enabled]);
  return reply;
}
