// Internal shim behind reel-place.sh (S7.14; contract V2-1.10 §5.7, §5.9). Reached via
// `maude design reel-place` (DDR-062), never a raw bin path.
//
//   reel-place <edl-slug> --next [--canvas <canvas>#<artboard>] [--json] [--root <project>]
//
// Appends the first shot of `<designRoot>/<edl-slug>.edl.json` the video does not hold yet (matched by
// name) as ONE literal <TransitionSeries.Sequence>; TOTAL ends where the last shot ends (video/reel-place.ts,
// composed from the Timeline's own appliers — the bytes a person's drop makes). Before it writes, the new
// source passes the fast check (`maude design check`'s fast tier); a source that fails it is never written.
//
// Why it writes the canvas file itself (unlike captions / cut-words, which ask the studio for an edit op):
// this IS the AI's write. Inside a V2-1.15 run the studio stages a tool's file change into the run that
// holds the artboard (V2-1.5 §5.5) — so each shot lands live, Stop publishes the shots placed so far, and
// the whole cut is ONE action and one ⌘Z. A person's edit op on that artboard meanwhile answers held-by-ai.
//
// Effect project (writes one canvas in this project) → auto tier. No network, no studio needed.
// Exit 0 placed · 1 refused · 2 usage · 4 "All shots are placed".

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { CanvasEditError } from '../canvas-edit.ts';
import { checkFile } from '../check/index.ts';
import { applyOnDisk } from '../clip-ops.ts';
import { validateEdl } from '../footage/schema.ts';
import { placeNext } from '../video/reel-place.ts';
import {
  DESIGN_REL,
  field,
  parseWords,
  projectRoot,
  runVerb,
  UsageError,
} from './_studio-verb.mjs';
import { target } from './_video-verbs.mjs';
import { claimWrites } from './_write-claim.mjs';

export const USAGE = `usage: maude design reel-place <edl-slug> --next [--canvas <canvas>#<artboard>] [--json] [--root <project>]
  Places the next shot of the cut <designRoot>/<edl-slug>.edl.json on the video: the first shot the video
  does not have yet, matched by name, at the end, with the transition the cut asks for. One shot per call —
  call it again for the next one. Without --canvas the video is ui/<edl-slug>.tsx.
Exit 0 placed · 1 refused · 2 usage · 4 All shots are placed.
`;

const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const ALL_PLACED = 'All shots are placed';
export const EXIT_ALL_PLACED = 4;

/** 3 → "0:03", 4.5 → "0:04.5", 71.25 → "1:11.3" */
export function clock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rest = Math.round((s - m * 60) * 10) / 10;
  const whole = Math.floor(rest);
  const tenth = Math.round((rest - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}${tenth ? `.${tenth}` : ''}`;
}

const assetName = (clip) =>
  String(clip ?? '')
    .replace(/^assets\//, '')
    .replace(/\.[A-Za-z0-9]{1,8}$/, '');

/** Run the verb. `out`/`err` are injectable for the tests. Returns the exit code. */
export async function reelPlace(words, { out = process.stdout, err = process.stderr, env } = {}) {
  const { flags, pos } = parseWords(words, {
    bool: ['--next', '--json'],
    value: ['--root', '--canvas'],
  });
  if (pos.length !== 1) throw new UsageError('reel-place takes one <edl-slug>');
  if (!flags['--next']) throw new UsageError('--next is required (one shot per call)');
  const slug = pos[0];
  if (!SLUG_RE.test(slug)) throw new UsageError(`${field(slug, 80)} is not a cut name`);
  const root = projectRoot(flags['--root'], env);
  if (!root) {
    err.write(
      'maude design reel-place: no .design/config.json here or above — run it inside a Maude project\n'
    );
    return 2;
  }
  const designRoot = resolve(root, DESIGN_REL);
  const edlAbs = join(designRoot, `${slug}.edl.json`);
  let edl;
  try {
    if (statSync(edlAbs).size > 1024 * 1024) throw new Error('too big');
    edl = JSON.parse(readFileSync(edlAbs, 'utf8'));
  } catch {
    err.write(
      `maude design reel-place: there is no cut ${slug} (${DESIGN_REL}/${slug}.edl.json)\n`
    );
    return 1;
  }
  const v = validateEdl(edl);
  if (!v.ok) {
    err.write(
      `maude design reel-place: ${slug}.edl.json is not a cut: ${field(v.errors.slice(0, 3).join('; '), 300)}\n`
    );
    return 1;
  }
  const t = flags['--canvas']
    ? target(root, flags['--canvas'])
    : { canvas: `${DESIGN_REL}/ui/${slug}.tsx`, artboard: undefined };
  const abs = resolve(root, t.canvas);
  if (!existsSync(abs))
    throw new UsageError(
      `there is no ${field(t.canvas, 200)} — name the video with --canvas <canvas>#<artboard>`
    );
  const rel = relative(designRoot, abs).split(sep).join('/');

  let result;
  try {
    result = await applyOnDisk(
      abs,
      (source) => {
        const r = placeNext(abs, source, edl, t.artboard);
        if (r.status !== 'placed') return { source, r };
        // the fast check before anything is written (V2-1.11 fast tier)
        const check = checkFile(rel, r.source, { tier: 'fast' });
        if (!check.ok) {
          const first = check.errors
            .slice(0, 3)
            .map((e) => `${e.code}: ${e.what}`)
            .join('; ');
          throw new CanvasEditError(`the video would not pass the check (${first})`, {
            canvas: abs,
            id: '',
          });
        }
        return { source: r.source, r };
      },
      // p8-a1-claims — inside a Maude chat the shot's bytes are claimed for its run before they land
      { beforeWrite: (next) => claimWrites(root, [{ rel, content: next }]) }
    );
  } catch (e) {
    err.write(`maude design reel-place: ${field(e?.message ?? e, 400)}\n`);
    return 1;
  }
  const r = result.r;
  if (r.status === 'all-placed') {
    if (flags['--json'])
      out.write(`${JSON.stringify({ status: 'all-placed', placed: r.placed, total: r.total })}\n`);
    else out.write(`${ALL_PLACED} — ${r.placed} of ${r.total}.\n`);
    return EXIT_ALL_PLACED;
  }
  const s = r.shot;
  const fps = Number(edl.fps) > 0 ? Number(edl.fps) : 30;
  if (flags['--json']) {
    out.write(
      `${JSON.stringify({ status: 'placed', placed: r.placed, total: r.total, shot: { n: s.n, name: s.name, clip: s.clip, srcIn: s.startSec, srcOut: s.startSec + s.durationFrames / fps } })}\n`
    );
  } else {
    // the shot name is comp-safe already (letters, digits, space, ._'()-); the clip is an asset path
    out.write(
      `Placed shot ${s.n} of ${r.total} · ${s.name} — ${assetName(s.clip)}, ${clock(s.startSec)}–${clock(s.startSec + s.durationFrames / fps)}\n`
    );
  }
  return 0;
}

if (import.meta.main) await runVerb('reel-place', USAGE, (words) => reelPlace(words));
