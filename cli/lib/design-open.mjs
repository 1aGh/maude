// design-open.mjs — `maude design open <canvas>[#artboard][@element] [--mode edit|preview|present]
// [--select all|none|annotations]` (contract V2-1.11 §5.3).
//
// Shows a canvas, an artboard or an element in the user's Maude window. The studio relays it to
// the shells of this project (`POST /_api/ui/open` → bus `ui-open` → ws), which run the same
// registry actions the UI does (view.zoom-to-artboard, select-by-id, present.canvas, select.*).
// Effect none (it moves the user's view, never a file) → auto tier in the AI chat.
//
// `maude design open --panel <id>` (S12.8, D11) opens a panel or sheet instead (trash · design-system ·
// layers-panel · layers · inspector · settings · shortcuts · whats-new), with no canvas.
//
// Exit 0 shown · 1 no such canvas / studio error · 2 usage · 3 "No Maude window is showing this
// project" (no studio for this root, or one with no shell attached).
//
// Leaf-ish: node built-ins + studio-locate.mjs.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DESIGN_REL, findProjectRoot, locateStudio, postStudio } from './studio-locate.mjs';

export const OPEN_USAGE = `usage: maude design open <canvas>[#artboard][@element] [--mode edit|preview|present]
                         [--select all|none|annotations] [--root <project>] [--json]
       maude design open --panel trash|design-system|layers-panel|layers|inspector|settings|shortcuts|whats-new
  <canvas> is the design-root-relative .tsx (ui/Pricing.tsx); .design/… and absolute paths work too.
  --panel opens that panel or sheet in the Maude window and takes no canvas.
`;

const MODES = new Set(['edit', 'preview', 'present']);
// twin of OPEN_PANELS in apps/studio/routes/agent.ts (maude-design-open.test.ts holds them equal)
const PANELS = new Set([
  'trash',
  'design-system',
  'layers-panel',
  'layers',
  'inspector',
  'settings',
  'shortcuts',
  'whats-new',
]);
const SELECTS = new Set(['all', 'none', 'annotations']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** Parse the words after `open`. `{ target, mode?, select?, root?, json }` or `{ error }`. Pure. */
export function parseOpenArgs(words) {
  const out = { json: false };
  const pos = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const [flag, inline] = w.startsWith('--') ? w.split(/=(.*)/s) : [w];
    const value = () => (inline !== undefined ? inline : words[++i]);
    if (flag === '--json') out.json = true;
    else if (flag === '--mode') out.mode = value();
    else if (flag === '--select') out.select = value();
    else if (flag === '--panel') out.panel = value();
    else if (flag === '--root') out.root = value();
    else if (flag.startsWith('--')) return { error: `unknown flag ${flag}` };
    else pos.push(w);
  }
  if (out.panel !== undefined) {
    if (!PANELS.has(out.panel)) return { error: `--panel is ${[...PANELS].join(' | ')}` };
    if (pos.length || out.mode !== undefined || out.select !== undefined)
      return { error: '--panel takes no canvas, --mode or --select' };
    return out;
  }
  if (pos.length !== 1) return { error: 'name one canvas' };
  if (out.mode !== undefined && !MODES.has(out.mode))
    return { error: `--mode is edit | preview | present` };
  if (out.select !== undefined && !SELECTS.has(out.select))
    return { error: `--select is all | none | annotations` };
  const raw = pos[0];
  const at = raw.lastIndexOf('.tsx');
  if (at < 0) return { error: 'the canvas is a .tsx file' };
  const canvas = raw.slice(0, at + 4);
  const m = /^(?:#([^#@]+))?(?:@([^#@]+))?$/.exec(raw.slice(at + 4));
  if (!m) return { error: 'write the target as <canvas>[#artboard][@element]' };
  const [, artboard, element] = m;
  for (const [k, v] of [
    ['artboard', artboard],
    ['element', element],
  ])
    if (v !== undefined && !ID.test(v))
      return { error: `the ${k} id ${JSON.stringify(v)} is not an id` };
  if (element && out.select) return { error: '--select and an @element are exclusive' };
  out.target = { canvas, artboard, element };
  return out;
}

/**
 * S3.7b — the presentation link for a canvas of a cloud-linked project:
 * `<hub>/present/<rel without .tsx>`, each segment encoded. Twin of
 * `presentationLinkFor` in apps/studio/client/v2/present/copy-link.js (a test
 * holds them equal). Null for a non-http(s) or loopback hub (never a public link).
 */
export function presentationLinkFor(rel, hubUrl) {
  if (typeof rel !== 'string' || !rel.endsWith('.tsx') || rel.length <= 4) return null;
  let url;
  try {
    url = new URL(String(hubUrl ?? ''));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (/^(localhost|127\.[\d.]+|\[::1\])$/.test(url.hostname) || url.hostname.endsWith('.localhost'))
    return null;
  return `${url.origin}/present/${rel.slice(0, -4).split('/').map(encodeURIComponent).join('/')}`;
}

/** The project's linked hub URL (`.design/config.json` → `linkedHub.url`), or null. */
function linkedHubUrlOf(root) {
  try {
    const cfg = JSON.parse(readFileSync(join(root, DESIGN_REL, 'config.json'), 'utf8'));
    return typeof cfg?.linkedHub?.url === 'string' ? cfg.linkedHub.url : null;
  } catch {
    return null;
  }
}

/** The designRoot-relative POSIX path of `canvas`, or null when it is outside the design root. */
export function toDesignRel(root, canvas) {
  const designRoot = resolve(root, DESIGN_REL);
  const abs = isAbsolute(canvas)
    ? canvas
    : canvas.startsWith(`${DESIGN_REL}/`)
      ? resolve(root, canvas)
      : resolve(designRoot, canvas); // design-root-relative: what every verb prints
  const rel = relative(designRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

const noWindowError = () =>
  'maude design open: No Maude window is showing this project. Open it in Maude (or `maude design serve`) and try again.\n';

/** `--panel <id>`: no canvas to check, so the studio is the only thing that can say no. */
async function openPanel({ root, panel, json, out, err }) {
  const studio = await locateStudio(root, { timeoutMs: 1500 });
  if (!studio) {
    err.write(noWindowError());
    return 3;
  }
  const r = await postStudio(studio, '/_api/ui/open', { panel });
  if (!r) {
    err.write('maude design open: the studio did not answer\n');
    return 1;
  }
  if (r.status === 409) {
    err.write(noWindowError());
    return 3;
  }
  if (r.status === 400) {
    err.write(`maude design open: ${r.body?.error ?? 'refused'}\n`);
    return 2;
  }
  if (r.status !== 200) {
    err.write(`maude design open: the studio refused (${r.status} ${r.body?.error ?? ''})\n`);
    return 1;
  }
  out.write(
    json ? `${JSON.stringify({ ok: true, open: { panel } })}\n` : `→ showing ${panel} in Maude\n`
  );
  return 0;
}

export async function runOpen({
  words,
  env = process.env,
  cwd = process.cwd(),
  out = process.stdout,
  err = process.stderr,
}) {
  if (words.includes('--help') || words.includes('-h')) {
    out.write(OPEN_USAGE);
    return 0;
  }
  const a = parseOpenArgs(words);
  if (a.error) {
    err.write(`maude design open: ${a.error}\n${OPEN_USAGE}`);
    return 2;
  }
  const root = a.root ? resolve(a.root) : findProjectRoot(env.CLAUDE_PROJECT_DIR || cwd);
  if (!root) {
    err.write(
      'maude design open: no .design/config.json here or above — run it inside a Maude project\n'
    );
    return 2;
  }
  if (a.panel) return openPanel({ root, panel: a.panel, json: a.json, out, err });
  const canvas = toDesignRel(root, a.target.canvas);
  if (!canvas) {
    err.write(`maude design open: ${a.target.canvas} is not inside ${DESIGN_REL}/\n`);
    return 2;
  }
  // S3.7b — `--mode present` in a cloud-linked project also prints the link
  // viewers follow (`GET /present/<canvas>` on the hub; Can view and up).
  const presentLink =
    a.mode === 'present' ? presentationLinkFor(canvas, linkedHubUrlOf(root)) : null;
  if (presentLink && !a.json) out.write(`presentation link: ${presentLink}\n`);
  const noWindow = () => {
    err.write(
      'maude design open: No Maude window is showing this project. Open it in Maude (or `maude design serve`) and try again.\n'
    );
    return 3;
  };
  const studio = await locateStudio(root, { timeoutMs: 1500 });
  if (!studio) return noWindow();
  const payload = { canvas };
  if (a.target.artboard) payload.artboard = a.target.artboard;
  if (a.target.element) payload.element = a.target.element;
  if (a.mode) payload.mode = a.mode;
  if (a.select) payload.select = a.select;
  const r = await postStudio(studio, '/_api/ui/open', payload);
  if (!r) {
    err.write('maude design open: the studio did not answer\n');
    return 1;
  }
  if (r.status === 409) return noWindow();
  if (r.status === 404) {
    err.write(
      `maude design open: no canvas ${canvas} in ${DESIGN_REL}/ — \`maude design index\` lists them\n`
    );
    return 1;
  }
  if (r.status === 400) {
    err.write(`maude design open: ${r.body?.error ?? 'refused'}\n`);
    return 2;
  }
  if (r.status !== 200) {
    err.write(`maude design open: the studio refused (${r.status} ${r.body?.error ?? ''})\n`);
    return 1;
  }
  const where = `${canvas}${payload.artboard ? `#${payload.artboard}` : ''}${payload.element ? `@${payload.element}` : ''}`;
  out.write(
    a.json
      ? `${JSON.stringify({ ok: true, open: r.body?.open ?? payload, ...(presentLink ? { presentationLink: presentLink } : {}) })}\n`
      : `→ showing ${where} in Maude\n`
  );
  return 0;
}
