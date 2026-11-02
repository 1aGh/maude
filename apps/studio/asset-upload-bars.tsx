// asset-upload-bars.tsx — S8.14 (L1): the thin bar along the foot of a picture whose bytes this Mac still owes the cloud
// (12 · ia-placed: "still going up to the cloud"). The picture is on the artboard at once; the bar says it is not everywhere yet,
// and goes away by itself when the last byte lands.
//
// Data flow is asset-placeholder.tsx's: the shell posts `{ dgn: 'asset-state', items }` (a state per rel the canvas FILE names);
// this layer only draws what it is told and never asks a route. An `uploading` item draws nothing else: the picture is here.
// Outside a shell (an export capture, a headless screenshot) nothing is ever sent, so no bar is ever drawn — exports carry none.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { AssetStateItem } from './bridge/dgn-protocol.ts';

/** rel → progress (0..1, or null when the Mac does not know how far it is) for every `uploading` item. */
export function uploadingOf(
  items: ReadonlyMap<string, AssetStateItem>
): ReadonlyMap<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [rel, it] of items) {
    if (it.state !== 'uploading') continue;
    const p = (it as { progress?: unknown }).progress;
    out.set(rel, typeof p === 'number' && Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : null);
  }
  return out;
}

const BAR_PX = 3;

const CSS = `
.dc-upbar-layer { position: fixed; inset: 0; z-index: 6; pointer-events: none; }
.dc-upbar { position: fixed; height: ${BAR_PX}px; overflow: hidden; display: none; box-sizing: border-box;
  background: color-mix(in oklab, var(--maude-hud-accent, #4a7bff) 22%, transparent); }
.dc-upbar > b { display: block; height: 100%; background: var(--maude-hud-accent, #4a7bff);
  transition: width var(--dur-soft, 200ms) ease-out; }
.dc-upbar[data-known="false"] > b { width: 40%; animation: dc-upbar-slide 1.2s ease-in-out infinite; }
@keyframes dc-upbar-slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@media (prefers-reduced-motion: reduce) {
  .dc-upbar > b { transition-duration: 1ms; }
  .dc-upbar[data-known="false"] > b { animation: none; width: 100%; opacity: 0.5; }
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('dc-upbar-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-upbar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

interface Bar {
  key: string;
  rel: string;
  el: Element;
  progress: number | null;
}

const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

export function UploadBars({
  items,
  relOf,
}: {
  items: ReadonlyMap<string, AssetStateItem>;
  /** the placeholder layer's own matcher (a src → the rel the shell named), passed in so the two files do not import each other */
  relOf: (raw: string | null, resolved: string, known: ReadonlySet<string>) => string | null;
}) {
  const going = useMemo(() => uploadingOf(items), [items]);
  const [bars, setBars] = useState<Bar[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (going.size === 0) {
      setBars((b) => (b.length ? [] : b));
      return;
    }
    ensureStyles();
    const known = new Set(going.keys());
    const scan = () => {
      const next: Bar[] = [];
      document.querySelectorAll('img, video').forEach((el, i) => {
        if (el.closest('.dc-upbar-layer') || el.closest('.dc-absent-layer')) return;
        const rel = relOf(
          el.getAttribute('src'),
          (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || '',
          known
        );
        if (rel) next.push({ key: `${rel}#${i}`, rel, el, progress: going.get(rel) ?? null });
      });
      setBars((prev) =>
        prev.length === next.length &&
        prev.every(
          (p, i) =>
            p.key === next[i]?.key && p.el === next[i]?.el && p.progress === next[i]?.progress
        )
          ? prev
          : next
      );
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    return () => mo.disconnect();
  }, [going, relOf]);

  // One animation-frame loop while any bar exists: follow each picture's on-screen foot.
  useEffect(() => {
    if (bars.length === 0) return;
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      for (const b of bars) {
        const div = nodes.current.get(b.key);
        if (!div) continue;
        const r = b.el.isConnected ? b.el.getBoundingClientRect() : null;
        if (!r || r.width < 8 || r.height < 8) {
          div.style.display = 'none';
          continue;
        }
        div.style.display = 'block';
        div.style.left = `${Math.round(r.left)}px`;
        div.style.top = `${Math.round(r.bottom - BAR_PX)}px`;
        div.style.width = `${Math.round(r.width)}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [bars]);

  if (bars.length === 0 || typeof document === 'undefined') return null;
  return createPortal(
    <div className="dc-upbar-layer" data-testid="asset-upload-bars">
      {bars.map((b) => (
        <div
          key={b.key}
          ref={(el) => {
            if (el) nodes.current.set(b.key, el);
            else nodes.current.delete(b.key);
          }}
          className="dc-upbar"
          data-testid="asset-upload-bar"
          data-rel={b.rel}
          data-known={b.progress === null ? 'false' : 'true'}
          role="progressbar"
          aria-label={`Uploading ${baseName(b.rel)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={b.progress === null ? undefined : Math.round(b.progress * 100)}
        >
          <b
            style={b.progress === null ? undefined : { width: `${Math.round(b.progress * 100)}%` }}
          />
        </div>
      ))}
    </div>,
    document.body
  );
}
