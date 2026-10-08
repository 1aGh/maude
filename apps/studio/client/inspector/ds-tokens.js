// inspector/ds-tokens.js — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useState } from 'react';

// Resolve the active canvas's DS tokens CSS path (mirrors canvas-url.js / DDR-093):
// the canvas's declared DS wins, else designSystems[0], else the legacy default.
export function cssTokensRelFor(file, cfg) {
  const ds0 = cfg?.designSystems?.[0];
  const name = file ? cfg?.canvasDesignSystems?.[file] : null;
  const ds = (name && cfg?.designSystems?.find((d) => d.name === name)) || ds0;
  return ds?.tokensCssRel || cfg?.tokensCssRel || ds0?.tokensCssRel || '';
}

// The active canvas's DS NAME (mirrors cssTokensRelFor's resolution order).
export function activeDsNameFor(file, cfg) {
  const byCanvas = file ? cfg?.canvasDesignSystems?.[file] : null;
  return byCanvas || cfg?.defaultDesignSystem || cfg?.designSystems?.[0]?.name || null;
}

// Parse a DS tokens CSS body → token names grouped by family + a name→value map
// (resolving one level of var() aliasing so the popover renders real swatches +
// values). Phase 12.3 (W2.1/W3 multi-DS).
export function parseTokensCss(css) {
  const raw = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) {
    if (!(m[1] in raw)) raw[m[1]] = m[2].trim();
  }
  const vals = {};
  for (const name of Object.keys(raw)) {
    const v = raw[name];
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(v);
    vals[name] = ref && raw[ref[1]] ? raw[ref[1]] : v;
  }
  const names = Object.keys(raw);
  const g = (re) => names.filter((n) => re.test(n));
  // Colours detected by VALUE, not name — so EVERY colour token a DS defines is
  // offered (the name-prefix list dropped many). A token is a colour if its
  // resolved value reads as one. (#3 — "see all tokens the DS has".)
  const isColor = (v) =>
    /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\()/i.test(v) ||
    /^(transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|cyan|magenta|teal|navy|maroon|olive|lime|aqua|silver|gold)$/i.test(
      v
    );
  return {
    color: names.filter((n) => isColor(vals[n])),
    space: g(/^--space-/),
    radius: g(/^--radius-/),
    type: g(/^--type-/),
    shadow: g(/^--shadow-/),
    lh: g(/^--lh-/),
    vals,
  };
}

// Fetch + parse the tokens CSS of EVERY design system in the config (main
// origin), so the token popover can offer tokens grouped per DS (W3 multi-DS
// feedback). The active canvas's DS is ordered first. Returns
// `[{ name, color, space, radius, type, shadow, lh, vals }]`.
export function useAllDsTokens(cfg, designRel, activeName) {
  const list = cfg?.designSystems || [];
  // A stable key so the effect only re-fetches when the DS set / paths change.
  const sig = list.map((d) => `${d.name}:${d.tokensCssRel}`).join('|');
  const [byDs, setByDs] = useState([]);
  useEffect(() => {
    if (!list.length) return undefined;
    let cancelled = false;
    Promise.all(
      list.map(async (ds) => {
        if (!ds.tokensCssRel) return null;
        try {
          const r = await fetch(`/${designRel}/${ds.tokensCssRel}`);
          const css = r.ok ? await r.text() : '';
          return { name: ds.name, ...parseTokensCss(css) };
        } catch {
          return null;
        }
      })
    ).then((res) => {
      if (cancelled) return;
      const got = res.filter(Boolean);
      // Active DS first, rest in config order.
      got.sort((a, b) => (a.name === activeName ? -1 : b.name === activeName ? 1 : 0));
      setByDs(got);
    });
    return () => {
      cancelled = true;
    };
  }, [sig, designRel, activeName]);
  return byDs;
}
