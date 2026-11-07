// #164 B3 — every auto-tier `maude design` verb that writes a canvas (lane) file claims its bytes
// (contract 164-hash-diff-attribution.md §7). A verb that writes a lane file without claiming leaves
// the write to the watcher, which cannot tell it from a person's save: it lands outside the AI run.
//
// Claim classes:
//   D  posts its bytes to bin/_write-claim.mjs BEFORE it writes them
//   R  writes through a studio route behind `claimingTableRoute` (or a route that claims itself),
//      sending X-Maude-Chat (bin/_studio-verb.mjs `chatWriteHeaders`)
//   T  carries a run tag in the body (annotations/run-tag.ts, MAUDE_CHAT_ID)
//   non-lane  writes no canvas file (assets, tokens, registry, sidecars, runtime state)
//   n/a  writes nothing under the project, or only an export at --out
//
// A static scan: a NEW auto-tier project-effect verb fails coverage until someone classifies it here.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAUDE_VERBS, verbTier } from '../actions/verbs.ts';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

type Claim = 'D' | 'R' | 'T' | 'non-lane' | 'n/a';
const WRITERS: Record<string, Claim> = {
  'canvas-edit': 'D',
  'reel-place': 'D',
  'ds-check': 'D',
  'captions add': 'R',
  captions: 'R',
  'cut-words': 'R',
  'cut-to-beat': 'R',
  'trash move': 'R',
  'trash restore': 'R',
  annotate: 'T',
  'photo-adjust': 'non-lane',
  handoff: 'non-lane',
  'import-asset': 'non-lane',
  'import-tokens': 'non-lane',
  'ingest-footage': 'non-lane',
  'transcribe-local': 'non-lane',
  beats: 'non-lane',
  'exports again': 'n/a',
  'captions export': 'n/a',
  'runs stop': 'n/a',
  'ds-upgrade stage': 'n/a',
  'ds-upgrade prove': 'n/a',
  'ds-upgrade discard': 'n/a',
  'ds-upgrade cancel': 'n/a',
};

/** The text between `from` and the end of the file/`to`; throws when `from` is missing. */
function after(src: string, from: string): string {
  const i = src.indexOf(from);
  if (i < 0) throw new Error(`missing: ${from}`);
  return src.slice(i);
}
/** True when `claim` appears in `src` before the first `write` that follows it is reachable. */
export function claimsBefore(src: string, claim: RegExp, write: RegExp): boolean {
  const c = claim.exec(src);
  const w = write.exec(src);
  return !!c && !!w && c.index < w.index;
}

describe('every auto-tier project verb is classified', () => {
  const auto = MAUDE_VERBS.filter(
    (v) => v.scope === 'design' && v.effect === 'project' && verbTier(v) === 'auto'
  ).map((v) => v.verb);

  test('no unclassified writer, no stale entry', () => {
    expect(auto.filter((v) => !(v in WRITERS))).toEqual([]);
    expect(Object.keys(WRITERS).filter((v) => !auto.includes(v))).toEqual([]);
  });
});

describe('D — the verb claims before it writes', () => {
  test('claimsBefore sees an unclaimed writer (the scanner itself)', () => {
    expect(claimsBefore('await write(x)', /claimWrites\(/, /write\(/)).toBe(false);
    expect(claimsBefore('await claimWrites(r); await write(x)', /claimWrites\(/, /write\(/)).toBe(
      true
    );
  });

  test('canvas-edit --invoke claims before editAttribute', () => {
    const main = after(read('canvas-edit.ts'), 'if (import.meta.main)');
    expect(main).toContain("import('./bin/_write-claim.mjs')");
    expect(claimsBefore(main, /await claimWrites\(/, /await editAttribute\(/)).toBe(true);
    // the CLI reaches no other writer: --invoke is its only mode
    expect(main).not.toMatch(/\b(moveElement|editText|deleteElement|insertElement)\(/);
  });

  test('ds-check --fix claims before the first file lands', () => {
    const fix = after(read('ds/canvas-cli.ts'), 'if (args.fix)');
    expect(read('ds/canvas-cli.ts')).toContain("from '../bin/_write-claim.mjs'");
    expect(claimsBefore(fix, /claimWritesSync\(/, /(renameSync|writeFileSync)\(/)).toBe(true);
  });

  test('reel-place claims in beforeWrite', () => {
    const src = read('bin/_reel-place.mjs');
    expect(src).toContain("from './_write-claim.mjs'");
    expect(src).toMatch(/beforeWrite:\s*\(next\)\s*=>\s*claimWrites\(/);
  });
});

describe('R — the verb writes through a claiming route', () => {
  test('the shared client names the chat on every write and none on a read', () => {
    const src = read('bin/_studio-verb.mjs');
    expect(src).toMatch(/if \(method === 'GET' \|\| method === 'HEAD'\) return \{\};/);
    expect(src).toMatch(/\.\.\.chatWriteHeaders\(method\)/);
  });

  test('captions / cut-words / cut-to-beat go through call() to /_api/edit-op (a table route)', () => {
    const src = read('bin/_video-verbs.mjs');
    expect(src).toMatch(/from '\.\/_studio-verb\.mjs'/);
    expect(src).toContain("call(studio, '/_api/edit-op'");
    expect(read('routes/edit.ts')).toContain("path: '/_api/edit-op'");
  });

  test('trash move / restore: restore is a table route, move claims in its own handler', () => {
    const src = read('bin/_trash.mjs');
    expect(src).toMatch(/from '\.\/_studio-verb\.mjs'/);
    expect(read('routes/trash.ts')).toContain("path: '/_api/trash/restore'");
    expect(read('http.ts')).toContain('control?.claimAiDelete?.(mine.runId, repoRel)');
  });

  test('every table route is wrapped by claimingTableRoute', () => {
    expect(read('http.ts')).toMatch(/tableSpecs\.map\(\(s\) => claimingTableRoute\(s, runs\)\)/);
  });

  // #164 B4 — the legacy literal too: an AI curl-local write naming its chat claims into its run
  // (behaviour: test/164-legacy-route-claims.test.ts)
  test('the legacy routes literal is mounted through claimingLegacyRoutes', () => {
    expect(read('http.ts')).toMatch(
      /const routes = \{ \.\.\.laneRoutes\.exact, \.\.\.claimingLegacyRoutes\(legacyRoutes, runs\) \};/
    );
  });

  test('the legacy artboard / array writers say their bytes (source-writing + source-written)', () => {
    const api = read('api.ts');
    for (const fn of ['insertArtboardOp', 'setArtboardLabelOp', 'editArraySrcOp']) {
      const body = after(api, `async function ${fn}(`);
      const end = body.indexOf('\n  async function ', 10);
      const own = end > 0 ? body.slice(0, end) : body;
      expect(own, fn).toMatch(/await sayingWrites\(before, '/);
      expect(own, fn).toMatch(/noteSourceWritten\(rel, after, '/);
    }
  });
});

describe('T — annotate tags its run', () => {
  test('the post names the chat from MAUDE_CHAT_ID', () => {
    const src = read('bin/_annotate-post.mjs');
    expect(src).toContain('MAUDE_CHAT_ID');
    expect(src).toContain('/_api/annotations/ops');
  });
});

describe('non-lane verbs do not reach a canvas writer', () => {
  test('none imports a canvas-source writer (canvas-edit / edit-ops) of its own', () => {
    const files = readdirSync(join(STUDIO, 'bin')).filter((f) =>
      /^(_import-asset|_import-tokens|_ingest-footage|_transcribe-local|beats)\.mjs$/.test(f)
    );
    expect(files.length).toBe(5);
    for (const f of files) {
      const src = read(`bin/${f}`);
      expect(src, f).not.toMatch(/from '\.\.\/(canvas-edit|edit-ops\/)/);
    }
  });
});
