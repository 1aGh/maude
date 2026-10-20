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

export async function fetchPreflight(spec, signal, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl('/_api/export-preflight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spec: preflightSpec(spec) }),
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
