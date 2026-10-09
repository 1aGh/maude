// V2-2.16 — the DDR-115 runtime-state tripwire across ALL FOUR lists.
//
//   1. `git/service.ts` `isMaudeRuntimeState`           (RUNTIME_STATE_* data)
//   2. `sync/file-membership.ts` `isRuntimeStateRel`    (+ the hub `.mjs` mirror)
//   3. `cli/lib/gitignore-block.mjs` `buildBlock`       (what `maude init` writes)
//   4. the repo `.gitignore`                            (this repo's own copy)
//
// `sync-file-membership.test.ts` already pins 1 ↔ 2 on a fixture list; the
// `.gitignore` ↔ `gitignore-block.mjs` pair had NO test (CLAUDE.md: "the pair
// still has no such pin") and the fixture list was hand-kept, so a name added
// to one regex and to no fixture passed every test. Here the four lists are
// READ as vocabularies and compared as sets: a path planted in any one of them
// — or missing from any one — fails, naming the list. The self-test at the
// bottom plants one and proves the tripwire goes red.
//
// Then every path the v2 contract notes introduce is classified once, with its
// source, against all four lists AND the file-plane classifier (both copies),
// with `git check-ignore` as the ground truth for the two gitignore files.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BEGIN_MARKER, buildBlock, END_MARKER } from '../../../cli/lib/gitignore-block.mjs';
import * as hub from '../../hub/src/file-membership.mjs';
import {
  RUNTIME_STATE_DIRS as GIT_DIRS,
  RUNTIME_STATE_FILES as GIT_FILES,
  isMaudeRuntimeState,
} from '../git/service.ts';
import {
  classifyProjectFile,
  type FileClass,
  RUNTIME_STATE_DIRS as FM_DIRS,
  RUNTIME_STATE_FILES as FM_FILES,
  isRuntimeStateRel,
} from '../sync/file-membership.ts';

const REPO_ROOT = path.resolve(import.meta.dir, '../../..');

/** One list's runtime vocabulary: `_<file>.json` names, `_<dir>/` names, and the
 *  two fixed extras (`_server.lock|log`). */
interface Vocab {
  files: Set<string>;
  dirs: Set<string>;
  extras: Set<string>;
  /** Lines the parser could not place — always a failure (an unknown rule shape
   *  is exactly how a list drifts without anyone noticing). */
  unknown: string[];
}

const vocab = (files: readonly string[], dirs: readonly string[], extras: string[]): Vocab => ({
  files: new Set(files),
  dirs: new Set(dirs),
  extras: new Set(extras),
  unknown: [],
});

/** A gitignore rule under the design root → its place in the vocabulary. */
function placeRule(v: Vocab, rest: string, line: string): void {
  const file = rest.match(/^_([a-z][a-z0-9-]*)(?:\.\*)?\.json$/);
  const extra = rest.match(/^_server\.(lock|log)$/);
  const dir = rest.match(/^_([a-z][a-z0-9-]*)\/\*?$/);
  if (file) v.files.add(file[1] as string);
  else if (extra) v.extras.add(`server.${extra[1]}`);
  else if (dir) v.dirs.add(dir[1] as string);
  else v.unknown.push(line);
}

/** `buildBlock(root)` → vocabulary. Every non-comment line inside the markers
 *  must be placed (`.kgai/` is the one repo-root rule, checked on its own). */
function blockVocab(block: string, root = '.design'): Vocab {
  const v = vocab([], [], []);
  const body = block.slice(block.indexOf(BEGIN_MARKER), block.indexOf(END_MARKER));
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '.kgai/') continue;
    if (!line.startsWith(`${root}/`)) {
      v.unknown.push(line);
      continue;
    }
    placeRule(v, line.slice(root.length + 1), line);
  }
  return v;
}

/** The repo `.gitignore` → vocabulary: every rule naming `.design/_…`. A
 *  negation (`!.design/_state/.gitkeep`) re-includes a placeholder and is not
 *  part of the vocabulary. */
function repoVocab(text: string, root = '.design'): Vocab {
  const v = vocab([], [], []);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith(`${root}/_`)) continue;
    placeRule(v, line.slice(root.length + 1), line);
  }
  return v;
}

/** Every disagreement between the lists, as human-readable lines. Empty = the
 *  four lists name the same runtime state. */
function vocabDrift(lists: Record<string, Vocab>): string[] {
  const out: string[] = [];
  const names = Object.keys(lists);
  for (const kind of ['files', 'dirs', 'extras'] as const) {
    const union = new Set<string>();
    for (const n of names) for (const x of lists[n]?.[kind] ?? []) union.add(x);
    for (const x of [...union].sort()) {
      const missing = names.filter((n) => !lists[n]?.[kind].has(x));
      if (missing.length) {
        const shape = kind === 'files' ? `_${x}.json` : kind === 'dirs' ? `_${x}/` : `_${x}`;
        out.push(`${shape} is missing from: ${missing.join(', ')}`);
      }
    }
  }
  for (const n of names)
    for (const u of lists[n]?.unknown ?? []) out.push(`${n}: unplaced rule ${u}`);
  return out;
}

const realLists = (): Record<string, Vocab> => ({
  'git/service.ts': vocab(GIT_FILES, GIT_DIRS, ['server.lock', 'server.log']),
  'sync/file-membership.ts': vocab(FM_FILES, FM_DIRS, ['server.lock', 'server.log']),
  'hub/src/file-membership.mjs': vocab(hub.RUNTIME_STATE_FILES, hub.RUNTIME_STATE_DIRS, [
    'server.lock',
    'server.log',
  ]),
  'cli/lib/gitignore-block.mjs': blockVocab(buildBlock('.design')),
  '.gitignore': repoVocab(readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8')),
});

/** `git check-ignore` ground truth: which of `paths` the `.gitignore` in
 *  `dir` ignores (a negation match is NOT ignored). One spawn per call. */
function ignoredBy(dir: string, paths: readonly string[]): Set<string> {
  const r = spawnSync(
    'git',
    ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--stdin', '-v', '-n'],
    {
      cwd: dir,
      input: `${paths.join('\n')}\n`,
      encoding: 'utf8',
    }
  );
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore: ${r.stderr}`);
  const out = new Set<string>();
  for (const row of r.stdout.split('\n')) {
    if (!row) continue;
    const tab = row.indexOf('\t');
    const meta = row.slice(0, tab);
    const p = row.slice(tab + 1);
    const pattern = meta.split(':').slice(2).join(':');
    if (pattern && !pattern.startsWith('!')) out.add(p);
  }
  return out;
}

/** A throwaway repo whose `.gitignore` is exactly the generated block. */
function withBlockRepo<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'maude-v2216-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(path.join(dir, '.gitignore'), buildBlock('.design'));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── The classification table — every runtime / versioned path the v2 notes add ───

interface Row {
  rel: string; // design-root relative
  source: string;
}

/** Runtime state: ignored by git, `never` on the file plane, in every list. */
const RUNTIME: Row[] = [
  // existing classes (the v1 fixture set, kept as positive controls)
  { rel: '_server.json', source: 'DDR-115' },
  { rel: '_active.sess-1.json', source: 'Cloud Phase 27 D3' },
  { rel: '_server.lock', source: 'DDR-115' },
  { rel: '_history/ui-card/x.tsx', source: 'DDR-115' },
  { rel: '_chat/c-1.meta.json', source: 'DDR-115; V2-1.12 adds `canvas` to it' },
  // ── the ONE new runtime class v2 adds ──
  { rel: '_runs/sess-1/snap/toolu_01ABC', source: 'V2-1.11 pre-edit snapshot' },
  { rel: '_runs/shots.jsonl', source: 'V2-1.11 stop-hook screenshot ledger' },
  // ── new paths under existing classes ──
  { rel: '_state/runs/run_01.json', source: 'V2-1.15 run registry' },
  { rel: '_state/outbox/1760000000000-tx_abc.json', source: 'DDR-241 content lane' },
  {
    rel: '_state/outbox/intents/1760000000000-i_abcdefghij0123456789.json',
    source: 'V2-1.14 intents',
  },
  { rel: '_state/hub-format.json', source: 'V2-1.12 §5.2 hub format cache' },
  { rel: '_state/migrate-v2.lock', source: 'V2-1.12 I3 migrator lock' },
  { rel: '_history/_migrate/v2-20261009T120000Z/report.json', source: 'V2-1.12 I3 snapshot' },
  { rel: '_history/_migrate/v2-20261009T120000Z/ui/card.meta.json', source: 'V2-1.12 I3' },
  { rel: '_trash/migrate-v2/assets/ab12cd34.json', source: 'V2-1.12 I8 / V2-1.10 bare dump' },
  { rel: '_history/_outbox-recovery/1760000000000-tx_abc.json', source: 'V2-2.16 B1/B2' },
  { rel: '_state/project-store.sqlite', source: 'V2-1.5 local kernel store' },
  { rel: '_state/ds-outside/alligators.json', source: 'V2-1.6 §5.17' },
  { rel: '_state/ds-upgrade/alligators/step-1.json', source: 'V2-1.13' },
  { rel: '_cache/index/ds-usage.json', source: 'V2-1.6 §5.17' },
  { rel: '_trash/ds-revisions/abc.json', source: 'V2-1.6 §5.17' },
  { rel: '_canvas-state/_pins.json', source: 'V2-1.17 §5.10' },
  { rel: '_canvas-state/_recent.json', source: 'V2-1.17 §5.10' },
  { rel: '_canvas-state/_describe.json', source: 'V2-1.17 describe consent' },
];

const HEX = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

/** Versioned content: committed, NOT runtime in any list, its file-plane class
 *  fixed (both copies). */
const VERSIONED: Array<Row & { cls: FileClass }> = [
  { rel: 'system/alligators/tokens.json', cls: 'companion-text', source: 'V2-1.12 C1' },
  { rel: 'system/alligators/components.json', cls: 'companion-text', source: 'V2-1.12 C1' },
  { rel: 'system/alligators/revisions/head.json', cls: 'companion-text', source: 'V2-1.6 C1 ext.' },
  { rel: `system/alligators/revisions/${HEX}.json`, cls: 'companion-text', source: 'V2-1.6' },
  { rel: `system/alligators/revisions/${HEX}.tokens.css`, cls: 'companion-text', source: 'V2-1.6' },
  {
    rel: `system/alligators/revisions/${HEX}.components.css`,
    cls: 'companion-text',
    source: 'V2-1.6',
  },
  { rel: 'assets/ab12cd34.transcript.json', cls: 'companion-text', source: 'V2-1.10 §5.10' },
  { rel: 'assets/ab12cd34.beats.json', cls: 'companion-text', source: 'V2-1.10 §5.10' },
  // Vote stamps and section fold are annotation elements / fields (V2-1.12
  // §5.3): versioned, Plane A — no runtime path of their own.
  { rel: 'ui/home.annotations.json', cls: 'canvas-owned', source: 'votes + fold (V2-1.12)' },
  { rel: 'ui/home.meta.json', cls: 'canvas-owned', source: 'R6 top-level keys' },
];

/** Default-closed neighbours of the new entries: not runtime, not on the plane. */
const NEVER: Row[] = [
  { rel: 'tokens.json', source: 'design root, outside every group' },
  { rel: 'ui/tokens.json', source: 'directly in a group — no <ds> level' },
  { rel: 'system/alligators/sub/tokens.json', source: 'wrong depth' },
  { rel: 'system/alligators/revisions/not-hex.json', source: 'V2-1.6 test list' },
  { rel: `system/alligators/revisions/${HEX.toUpperCase()}.json`, source: 'ids are lowercase' },
  { rel: `system/alligators/revisions/${HEX}x.json`, source: '65 chars' },
  { rel: 'system/alligators/Tokens.JSON', source: 'exact names only' },
  { rel: 'assets/tokens.json', source: 'assets is not a canvas group' },
];

// Paths the v2 notes put OUTSIDE every project — nothing to classify, and the
// reason "index, thumbnails, describe sidecars, fold state" add no list entry:
//   ~/.maude/index/v1/**            V2-1.17 §5.10 (snapshots, thumbs, describe)
//   ~/.config/maude/prefs.json      V2-4.10 fold state (per Mac, across projects)
//   <app_data>/run/<pid>.json       V2-1.1 shell info
// Cloud vote ballots live on the hub (CONTRACT A18), not in a project file.

describe('V2-2.16 — the four DDR-115 lists name the same runtime state', () => {
  test('no list lacks (or alone carries) an entry', () => {
    expect(vocabDrift(realLists())).toEqual([]);
  });

  test('`.gitignore` ↔ `gitignore-block.mjs`: identical design-root rules', () => {
    const lists = realLists();
    const pair = {
      'cli/lib/gitignore-block.mjs': lists['cli/lib/gitignore-block.mjs'] as Vocab,
      '.gitignore': lists['.gitignore'] as Vocab,
    };
    expect(vocabDrift(pair)).toEqual([]);
  });

  test('`.gitignore` ↔ `gitignore-block.mjs`: identical answers (git check-ignore)', () => {
    const probes = [
      ...RUNTIME.map((r) => `.design/${r.rel}`),
      ...VERSIONED.map((r) => `.design/${r.rel}`),
      ...NEVER.map((r) => `.design/${r.rel}`),
      // kgai: the per-machine projection is ignored by both; the LOG is the
      // documented divergence — this repo versions it (its own `.gitignore`
      // kgai block), a downstream project's block ignores the whole store.
      '.kgai/store/graph.kuzu',
    ];
    const repo = ignoredBy(REPO_ROOT, probes);
    const block = withBlockRepo((dir) => ignoredBy(dir, probes));
    const differ = probes.filter((p) => repo.has(p) !== block.has(p));
    expect(differ).toEqual([]);
    expect(repo.has('.kgai/store/graph.kuzu')).toBe(true);
  });
});

describe('V2-2.16 — every v2 path, classified once', () => {
  const repoIgnored = ignoredBy(
    REPO_ROOT,
    [...RUNTIME, ...VERSIONED, ...NEVER].map((r) => `.design/${r.rel}`)
  );
  const blockIgnored = withBlockRepo((dir) =>
    ignoredBy(
      dir,
      [...RUNTIME, ...VERSIONED, ...NEVER].map((r) => `.design/${r.rel}`)
    )
  );

  test.each(RUNTIME.map((r) => [r.rel, r.source]))('runtime: %s (%s)', (rel) => {
    const answers = {
      isMaudeRuntimeState: isMaudeRuntimeState(rel),
      'isMaudeRuntimeState(.design/…)': isMaudeRuntimeState(`.design/${rel}`),
      isRuntimeStateRel: isRuntimeStateRel(rel),
      'hub.isRuntimeStateRel': hub.isRuntimeStateRel(rel),
      'classify → never': classifyProjectFile(rel) === 'never',
      'hub classify → never': hub.classifyProjectFile(rel) === 'never',
      'gitignore-block ignores': blockIgnored.has(`.design/${rel}`),
      '.gitignore ignores': repoIgnored.has(`.design/${rel}`),
    };
    expect(Object.entries(answers).filter(([, v]) => v !== true)).toEqual([]);
  });

  test.each(
    VERSIONED.map((r) => [r.rel, r.cls, r.source])
  )('versioned: %s → %s (%s)', (rel, cls) => {
    const answers = {
      isMaudeRuntimeState: isMaudeRuntimeState(rel),
      isRuntimeStateRel: isRuntimeStateRel(rel),
      'hub.isRuntimeStateRel': hub.isRuntimeStateRel(rel),
      'gitignore-block ignores': blockIgnored.has(`.design/${rel}`),
      '.gitignore ignores': repoIgnored.has(`.design/${rel}`),
    };
    expect(Object.entries(answers).filter(([, v]) => v !== false)).toEqual([]);
    expect(classifyProjectFile(rel)).toBe(cls as FileClass);
    expect(hub.classifyProjectFile(rel)).toBe(cls);
  });

  test.each(NEVER.map((r) => [r.rel, r.source]))('default-closed: %s (%s)', (rel) => {
    expect(isMaudeRuntimeState(rel)).toBe(false);
    expect(classifyProjectFile(rel)).toBe('never');
    expect(hub.classifyProjectFile(rel)).toBe('never');
  });

  test('a declared custom group carries its DS manifests too (both copies)', () => {
    const opts = { canvasGroups: [{ path: 'brand/systems' }] };
    for (const rel of ['brand/systems/ds/tokens.json', `brand/systems/ds/revisions/${HEX}.json`]) {
      expect(classifyProjectFile(rel, opts)).toBe('companion-text');
      expect(hub.classifyProjectFile(rel, opts)).toBe('companion-text');
    }
    // …and the default groups stop counting once groups are declared.
    expect(classifyProjectFile('system/ds/tokens.json', opts)).toBe('never');
  });
});

describe('V2-2.16 — the tripwire goes red on a planted path', () => {
  const lists = realLists();

  test.each(Object.keys(lists).map((n) => [n]))('a dir planted only in %s is named', (name) => {
    const planted = { ...lists };
    const v = planted[name] as Vocab;
    planted[name] = { ...v, dirs: new Set([...v.dirs, 'planted-v2216']) };
    const drift = vocabDrift(planted);
    expect(drift.length).toBe(1);
    expect(drift[0]).toContain('_planted-v2216/ is missing from');
    for (const other of Object.keys(lists).filter((n) => n !== name))
      expect(drift[0]).toContain(other);
  });

  test('a rule planted in the repo .gitignore text is named', () => {
    const text = `${readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8')}\n.design/_planted-v2216/\n`;
    const drift = vocabDrift({ ...lists, '.gitignore': repoVocab(text) });
    expect(drift).toEqual([
      '_planted-v2216/ is missing from: git/service.ts, sync/file-membership.ts, hub/src/file-membership.mjs, cli/lib/gitignore-block.mjs',
    ]);
  });

  test('a runtime path dropped from the block is named', () => {
    const block = buildBlock('.design').replace('.design/_runs/\n', '');
    const drift = vocabDrift({ ...lists, 'cli/lib/gitignore-block.mjs': blockVocab(block) });
    expect(drift).toEqual(['_runs/ is missing from: cli/lib/gitignore-block.mjs']);
  });

  test('a rule shape the parser cannot place is a failure, not a pass', () => {
    const text = '.design/_weird-*.bin\n';
    expect(vocabDrift({ x: repoVocab(text) })).toEqual(['x: unplaced rule .design/_weird-*.bin']);
  });
});
