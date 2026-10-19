// client/v2/ds/update-model.js — S10.8: what a canvas that was left out of an update is missing (13 · ds-edit-instance).
//
// Pure. Three jobs: (1) is this canvas left out (`leftOutOf`: its `dsRev` differs from its system's head, V2-1.6
// §5.10); (2) what changed between that revision and head (`diffRevisions`, read from the two immutable revision
// bodies — the same two files the studio serves at GET /_api/ds/revision); (3) the one line the block prints
// ("Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update.").
//
// The diff here is for WORDS and for placing the update dot. It is not the engine's `tokenDiff` (server, drives the
// publish): a client-side scan of the two stylesheets by declaration, comment- and string-aware (ds/css-scan.ts).

import {
  ownCustomProperties,
  ownDeclarations,
  scanCssRules,
  splitSelectorList,
} from '../../../ds/css-scan.ts';
import { canvasDsSystem } from '../../canvas-url.js';

const REV_ID = /^[0-9a-f]{64}$/;
const COMPONENTS_KEY = 'preview/_components.css';

// ── is this canvas left out? ───────────────────────────────────────────────────────────────

const designRelOf = (cfg) => (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');

/** The canvas's key in the index maps: designRoot-relative, with or without the `.design/` prefix. */
export function relOf(path, cfg) {
  const d = designRelOf(cfg);
  return path.startsWith(`${d}/`) ? path.slice(d.length + 1) : path;
}

/**
 * `{ ds, dsRev, head, folder }` when the canvas is left out of its (converted) system's current revision, else
 * null. `path` is the tree path or the design-root-relative one.
 */
export function leftOutOf(path, cfg) {
  if (typeof path !== 'string' || !path.endsWith('.tsx')) return null;
  const rel = relOf(path, cfg);
  const ds = canvasDsSystem(path, cfg);
  if (!ds?.name || cfg?.dsConverted?.[ds.name] !== true) return null;
  const head = cfg?.systemHeads?.[ds.name];
  const maps = cfg?.canvasDsRevs;
  const dsRev = maps && typeof maps === 'object' ? (maps[rel] ?? maps[path]) : null;
  if (typeof head !== 'string' || !REV_ID.test(head)) return null;
  if (typeof dsRev !== 'string' || !REV_ID.test(dsRev) || dsRev === head) return null;
  return {
    ds: ds.name,
    dsRev,
    head,
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
  };
}

/** Every left-out canvas, `{ [rel]: info }` — the Canvases rows' dots. */
export function leftOutMap(cfg) {
  const out = {};
  for (const rel of Object.keys(cfg?.canvasDsRevs ?? {})) {
    const info = leftOutOf(rel, cfg);
    if (info) out[rel] = info;
  }
  return out;
}

// ── the diff between two revisions ─────────────────────────────────────────────────────────

const textOf = (body, key) => {
  const f = body?.files?.[key];
  return f && typeof f.text === 'string' ? f.text : null;
};
const tokensKeyOf = (body) => {
  const keys = Object.keys(body?.files ?? {}).filter(
    (k) => k.endsWith('.css') && k !== COMPONENTS_KEY
  );
  return keys.find((k) => k === 'colors_and_type.css') ?? keys[0] ?? null;
};

/** `{ "<at-rule chain>|<selector>|<--name>": value }` for every custom property. */
function tokenValues(css) {
  const out = new Map();
  if (css == null) return out;
  const rules = scanCssRules(css);
  rules.forEach((rule, i) => {
    for (const d of ownCustomProperties(css, rules, i))
      for (const sel of splitSelectorList(rule.selector))
        out.set(`${rule.atRuleChain.join('>')}|${sel.trim()}|${d.name}`, d.rawValue.trim());
  });
  return out;
}

/** `{ "<selector>|<prop>": value }` for every plain declaration of a plain rule. */
function declValues(css) {
  const out = new Map();
  if (css == null) return out;
  const rules = scanCssRules(css);
  rules.forEach((rule, i) => {
    if (rule.atRule || rule.nestedInAtRule) return;
    for (const d of ownDeclarations(css, rules, i))
      if (!d.prop.startsWith('--'))
        for (const sel of splitSelectorList(rule.selector))
          out.set(`${sel.trim()}|${d.prop}`, d.rawValue.trim());
  });
  return out;
}

function tokenLabels(body) {
  const labels = new Map();
  let doc;
  try {
    doc = JSON.parse(textOf(body, 'tokens.json') ?? 'null');
  } catch {
    doc = null;
  }
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    const ext = n.$extensions?.['sh.maude'];
    if (ext && typeof ext.css === 'string' && typeof ext.label === 'string')
      labels.set(ext.css, ext.label);
    for (const k of Object.keys(n)) if (!k.startsWith('$')) walk(n[k]);
  };
  walk(doc);
  return labels;
}

/** "--radius-md" → "Radius md" when the system gave no label. */
export const prettyToken = (css) => {
  const s = String(css).replace(/^--/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function componentClasses(body) {
  const out = new Map(); // class → { name, label }
  let doc;
  try {
    doc = JSON.parse(textOf(body, 'components.json') ?? 'null');
  } catch {
    doc = null;
  }
  for (const [name, c] of Object.entries(doc?.components ?? {})) {
    if (c && typeof c.class === 'string')
      out.set(c.class, {
        name: c.export ?? name,
        label: typeof c.label === 'string' ? c.label : name,
      });
  }
  return out;
}

/**
 * What moved from `oldBody` to `newBody` (revision bodies: `{ files: { [path]: { text } } }`).
 * @returns {{ tokens: Array<{css, label, before, after}>, components: Array<{component, label, selector, prop, before, after}> }}
 */
export function diffRevisions(oldBody, newBody) {
  const tk = tokensKeyOf(newBody) ?? tokensKeyOf(oldBody);
  const A = tokenValues(tk ? textOf(oldBody, tk) : null);
  const B = tokenValues(tk ? textOf(newBody, tk) : null);
  const labels = new Map([...tokenLabels(oldBody), ...tokenLabels(newBody)]);
  const seen = new Set();
  const tokens = [];
  for (const key of new Set([...A.keys(), ...B.keys()])) {
    const before = A.get(key) ?? null;
    const after = B.get(key) ?? null;
    if (before === after) continue;
    const css = key.slice(key.lastIndexOf('|') + 1);
    if (seen.has(css)) continue;
    seen.add(css);
    tokens.push({ css, label: labels.get(css) ?? prettyToken(css), before, after });
  }
  const cb = declValues(textOf(oldBody, COMPONENTS_KEY));
  const ca = declValues(textOf(newBody, COMPONENTS_KEY));
  const classes = new Map([...componentClasses(oldBody), ...componentClasses(newBody)]);
  const components = [];
  for (const key of new Set([...cb.keys(), ...ca.keys()])) {
    const before = cb.get(key) ?? null;
    const after = ca.get(key) ?? null;
    if (before === after) continue;
    const bar = key.lastIndexOf('|');
    const selector = key.slice(0, bar);
    const prop = key.slice(bar + 1);
    const cls = /^\.([\w-]+)/.exec(selector)?.[1];
    const comp = cls ? classes.get(cls) : null;
    if (!comp) continue;
    components.push({ component: comp.name, label: comp.label, selector, prop, before, after });
  }
  return { tokens, components };
}

// ── words ──────────────────────────────────────────────────────────────────────────────────

const PROP_WORDS = {
  'border-radius': 'corners',
  padding: 'padding',
  gap: 'spacing',
  background: 'fill',
  'background-color': 'fill',
  color: 'text colour',
  'font-size': 'text size',
  'font-weight': 'text weight',
  border: 'border',
  'box-shadow': 'shadow',
};
const COLOUR =
  /^(?:#[0-9a-f]{3,8}|(?:oklch|oklab|rgb|rgba|hsl|hsla|lab|lch|color|color-mix|var)\([^;{}]*\))$/i;
const unitless = (a, b) => {
  const m = (v) => /^(-?[\d.]+)px$/.exec(String(v).trim())?.[1];
  return m(a) && m(b) ? [m(a), m(b)] : [a, b];
};

/** Phrases for a diff, most visible first: "Corners 2 → 6", "Accent changed". */
export function changePhrases(diff) {
  const out = [];
  for (const c of diff.components) {
    const word = PROP_WORDS[c.prop] ?? c.prop;
    const [a, b] = unitless(c.before ?? 'none', c.after ?? 'none');
    out.push(`${word} ${a} → ${b}`);
  }
  for (const t of diff.tokens) {
    const colourish = [t.before, t.after].every((v) => v == null || COLOUR.test(v));
    if (colourish) out.push(`${t.label} changed`);
    else {
      const [a, b] = unitless(t.before ?? 'none', t.after ?? 'none');
      out.push(`${t.label} ${a} → ${b}`);
    }
  }
  return [...new Set(out)];
}

/** "Corners 2 → 6" for one, "Corners 2 → 6 and 3 more" past two. First letter capital. */
export function changeLine(diff, max = 2) {
  const all = changePhrases(diff);
  if (all.length === 0) return 'The design system changed';
  const shown = all.slice(0, max).join(', ');
  const text = all.length > max ? `${shown} and ${all.length - max} more` : shown;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** CONTRACT §4 times: relative first. */
export function agoWords(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172_800) return 'yesterday';
  const d = new Date(t);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getMonth()
  ];
  return `${d.getDate()} ${mon}`;
}

const whoWords = (by) => {
  if (!by || typeof by !== 'object') return null;
  if (by.kind === 'ai' || by.kind === 'agent') return by.name ? by.name : 'AI';
  return by.name ? by.name : 'You';
};

/**
 * The publish that moved head on from `dsRev`: in the newest-first revisions list, the row just above the
 * canvas's own revision (the first update it missed). `more` counts the later ones.
 */
export function missedUpdate(rows, dsRev) {
  const i = Array.isArray(rows) ? rows.findIndex((r) => r.id === dsRev) : -1;
  if (i <= 0) return null;
  return { row: rows[i - 1], more: i - 1 };
}

/**
 * "Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update."
 * @param {{ diff, row?: any, folder?: string, name?: string, more?: number, now?: number }} a
 */
export function whatWords({ diff, row = null, folder = '', name = 'This canvas', more = 0, now }) {
  const parts = [changeLine(diff)];
  const who = whoWords(row?.by);
  const when = row?.at ? agoWords(row.at, now) : null;
  const head = [parts[0], who ? `by ${who}` : null, when].filter(Boolean).join(', ');
  const left = `${folder || name} was left out of that update.`;
  const extra =
    more > 0 ? ` ${more === 1 ? '1 later update' : `${more} later updates`} came after.` : '';
  return `${head}. ${left}${extra}`;
}
