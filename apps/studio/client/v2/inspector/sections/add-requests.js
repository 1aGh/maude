// client/v2/inspector/sections/add-requests.js — S2.4: the "+" in a section header reaches the body.
//
// The frame calls a slot's `add({ el, ctx })` from the header, outside the body's render, where there is no write lane.
// The slot posts a request here; the body of that section for that element picks it up once and acts (adds the default
// border, the first elevation …). A request nobody takes is dropped by the next one.

import { useEffect, useRef, useSyncExternalStore } from 'react';

let pending = null;
let seq = 0;
const subs = new Set();
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const elementKey = (el) => `${el?.id ?? ''}#${el?.index ?? 0}`;

/** From the header's "+": ask this section's body, for this element, to add. */
export function requestAdd(section, el) {
  pending = { section, key: elementKey(el), n: ++seq };
  for (const f of subs) f();
}

/** In a body: run `handler` once per request for (section, el). */
export function useAddRequest(section, el, handler) {
  const p = useSyncExternalStore(subscribe, () => pending);
  const latest = useRef(handler);
  latest.current = handler;
  const key = elementKey(el);
  useEffect(() => {
    if (!p || p.section !== section || p.key !== key || pending !== p) return;
    pending = null; // taken
    latest.current();
  }, [p, section, key]);
}
