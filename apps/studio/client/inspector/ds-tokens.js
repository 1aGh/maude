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

/** Split at top-level commas (never inside `(…)`). */
function topCommas(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Which themes a rule's selector writes: `dark`, `light`, or `default` (`:root`, `.ds`, … with no theme named). */
function themesOfSelector(sel) {
  const out = new Set();
  for (const part of topCommas(sel)) {
    if (/data-theme\s*=\s*["']?dark|\.dark\b|\.theme-dark\b/i.test(part)) out.add('dark');
    else if (/data-theme\s*=\s*["']?light|\.light\b|\.theme-light\b/i.test(part)) out.add('light');
    else out.add('default');
  }
  return out;
}

/** Every rule that declares custom properties: `{ selector, media, body }`, comments stripped, @media kept as context. */
function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = []; // the open blocks' preludes
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      stack.push(text.slice(start, i).trim());
      start = i + 1;
    } else if (ch === '}') {
      const prelude = stack.pop() ?? '';
      const body = text.slice(start, i);
      if (!prelude.startsWith('@') && /--[a-z0-9-]+\s*:/i.test(body)) {
        rules.push({ selector: prelude, media: stack.filter((p) => p.startsWith('@')), body });
      }
      start = i + 1;
    } else if (ch === ';' && stack.length === 0) start = i + 1;
  }
  return rules;
}

// Parse a DS tokens CSS body → token names grouped by family + a name→value map, per theme. Phase 12.3 (W2.1/W3
// multi-DS); P6 T1 (inspector-ux-rules M2): both themes are read (a `[data-theme="dark"]` block, a
// `prefers-color-scheme: dark` media block, `light-dark(a, b)`), every `var()` inside a value is resolved in its own
// theme (so a `color-mix(…var(--fg-0)…)` paints in the shell), and a `color-mix()` / `light-dark()` token is a colour —
// the old parser dropped `--scrim`, `--selection` and the `--status-*-soft` tints. `vals` is the default theme (the one
// `:root` wears), as before.
export function parseTokensCss(css) {
  const raw = { light: {}, dark: {} };
  const dflt = { light: {}, dark: {} };
  const named = { light: {}, dark: {} };
  const seen = []; // names in declaration order
  const explicit = new Set(); // themes the file names on its own
  let defaultTheme = null;
  for (const rule of rulesOf(css)) {
    const media = rule.media.join(' ');
    if (/@media/i.test(media) && !/prefers-color-scheme/i.test(media)) continue; // reduced motion, print, widths
    let themes = themesOfSelector(rule.selector);
    if (/prefers-color-scheme\s*:\s*dark/i.test(media)) themes = new Set(['dark']);
    else if (/prefers-color-scheme\s*:\s*light/i.test(media)) themes = new Set(['light']);
    for (const t of themes) if (t !== 'default') explicit.add(t);
    // `:root, .ds[data-theme="dark"]` says the default theme is dark
    if (!defaultTheme && themes.has('default')) {
      const named = [...themes].filter((t) => t !== 'default');
      if (named.length === 1) defaultTheme = named[0];
    }
    for (const m of rule.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) {
      const name = m[1];
      const value = m[2].trim();
      if (!seen.includes(name)) seen.push(name);
      const ld = /^light-dark\(([\s\S]*)\)$/i.exec(value);
      const pair = ld ? topCommas(ld[1]) : null;
      if (pair?.length === 2) {
        explicit.add('light');
        explicit.add('dark');
      }
      for (const t of themes) {
        // a theme-named declaration wins over a default one, whichever comes first; last wins within each
        const into = t === 'default' ? dflt : named;
        for (const tt of t === 'default' ? ['light', 'dark'] : [t]) {
          into[tt][name] = pair?.length === 2 ? (tt === 'dark' ? pair[1] : pair[0]) : value;
        }
      }
    }
  }
  for (const tt of ['light', 'dark']) raw[tt] = { ...dflt[tt], ...named[tt] };
  defaultTheme = defaultTheme || 'light';
  const resolveIn = (theme) => {
    const out = {};
    const other = theme === 'dark' ? 'light' : 'dark';
    const res = (name, depth) => {
      const v = raw[theme][name] ?? raw[other][name];
      if (v == null) return null;
      if (depth > 8) return v;
      return v.replace(
        /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/gi,
        (all, ref, fb) => {
          const r = res(ref, depth + 1);
          return r ?? (fb ? fb.trim() : all);
        }
      );
    };
    for (const name of seen) out[name] = res(name, 0);
    return out;
  };
  const themes = {};
  const both = explicit.has('light') || explicit.has('dark');
  if (both) {
    themes.light = resolveIn('light');
    themes.dark = resolveIn('dark');
  } else themes[defaultTheme] = resolveIn(defaultTheme);
  const vals = themes[defaultTheme] || resolveIn(defaultTheme);
  const names = seen;
  const g = (re) => names.filter((n) => re.test(n));
  // Colours detected by VALUE, not name — so EVERY colour token a DS defines is
  // offered (the name-prefix list dropped many). A token is a colour if its
  // resolved value reads as one. (#3 — "see all tokens the DS has".)
  const isColor = (v) =>
    /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color\(|color-mix\(|light-dark\()/i.test(
      v ?? ''
    ) ||
    /^(transparent|currentcolor|white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|cyan|magenta|teal|navy|maroon|olive|lime|aqua|silver|gold)$/i.test(
      v ?? ''
    );
  return {
    themes,
    defaultTheme,
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
