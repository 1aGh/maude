// editing/kind-dim.tsx — S7.24b: the kind filter's canvas half (08 · ak-mixed-fit, 05 · es-filter).
//
//   shell `dim-artboards { ids }`   → the artboards named there go quiet (the whole artboard, name included, at .45 - 08 `.k-ab--dim`);
//                                     the rest of the canvas is untouched. `{ ids: null }` puts them back.
//
// The shell does the counting (the index knows each canvas's artboard kinds) and sends ids; this file only
// draws. The dim is a LOOK, not a lock: a dimmed artboard still selects, edits and exports exactly as before
// ("the artboards stay on the canvas, only dimmed" — 05). It is one declarative <style> over the ids, so it
// survives an artboard re-mounting under a hot reload and leaves nothing behind in the DOM when cleared.
// Never persisted, never synced: it is this person's own view of the canvas.

import { useEffect, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';

/** The strength a dimmed artboard keeps. */
export const DIM_OPACITY = 0.45;

const esc = (id: string): string => id.replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, ' ');

/** The stylesheet that dims `ids` ('' for none). Pure. */
export function dimCss(ids: readonly string[] | null | undefined): string {
  if (!ids || ids.length === 0) return '';
  const sel = ids.map((id) => `.dc-canvas [data-dc-screen="${esc(id)}"]`).join(',\n');
  return `${sel} {
  opacity: ${DIM_OPACITY};
  transition: opacity var(--dur-flip, 120ms) var(--ease-out, ease-out);
}
@media (prefers-reduced-motion: reduce) {
${sel} { transition-duration: 1ms; }
}`;
}

export function KindDim() {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      // Only the shell may say it (DDR-054: the canvas is the untrusted side); the table then parses the
      // payload — a capped list of short strings, or null.
      if (e.source !== window.parent) return;
      if ((e.data as { dgn?: string } | null)?.dgn !== 'dim-artboards') return;
      const m = acceptFromShell(e, window);
      if (m && m.dgn === 'dim-artboards') setIds(m.ids);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const css = dimCss(ids);
  if (!css) return null;
  return <style data-ed-kind-dim="">{css}</style>;
}
