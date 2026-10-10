// design-open.mjs — `maude design open <canvas>[#artboard][@element] [--mode edit|preview|present]
// [--select all|none|annotations]` (contract V2-1.11 §5.3).
//
// Shows a canvas, an artboard or an element in the user's Maude window. The studio relays it to
// the shells of this project (`POST /_api/ui/open` → bus `ui-open` → ws), which run the same
// registry actions the UI does (view.zoom-to-artboard, select-by-id, present.canvas, select.*).
// Effect none (it moves the user's view, never a file) → auto tier in the AI chat.
//
// Exit 0 shown · 1 no such canvas / studio error · 2 usage · 3 "No Maude window is showing this
// project" (no studio for this root, or one with no shell attached).
//
// Leaf-ish: node built-ins + studio-locate.mjs.

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DESIGN_REL, findProjectRoot, locateStudio, postStudio } from './studio-locate.mjs';

export const OPEN_USAGE = `usage: maude design open <canvas>[#artboard][@element] [--mode edit|preview|present]
                         [--select all|none|annotations] [--root <project>] [--json]
  <canvas> is the design-root-relative .tsx (ui/Pricing.tsx); .design/… and absolute paths work too.
`;

const MODES = new Set(['edit', 'preview', 'present']);
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
    else if (flag === '--root') out.root = value();
    else if (flag.startsWith('--')) return { error: `unknown flag ${flag}` };
    else pos.push(w);
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
  const canvas = toDesignRel(root, a.target.canvas);
  if (!canvas) {
    err.write(`maude design open: ${a.target.canvas} is not inside ${DESIGN_REL}/\n`);
    return 2;
  }
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
      ? `${JSON.stringify({ ok: true, open: r.body?.open ?? payload })}\n`
      : `→ showing ${where} in Maude\n`
  );
  return 0;
}
