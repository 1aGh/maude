// V2-2.8 S8 — the whole-project ZIP carries no runtime state.
//
// `exporters/scope.ts` kept its own `RAW_EXCLUDES` name list, a fifth copy of
// "what is runtime state" next to the four DDR-115 lists, and it had drifted:
// `_chat/` (every AI conversation), `_state/` (the outbox), `_untrusted/`,
// `_trash/`, `_draw/`, `_reports/`, each member's `_active.<session>.json` and
// the rest of the IGNORED set all went into a `project-raw` ZIP that any member
// may download (V2-1.16 L7, an "everyone-fix"). The walk now asks the one
// classifier (`isRuntimeStateRel`, byte-identical to `isMaudeRuntimeState` and
// pinned to it by sync-file-membership.test.ts), so the lists cannot drift
// again.
//
// The second test is the other direction: versioned files whose names merely
// START with an underscore (a DS's `preview/_components.css`, a canvas group's
// `_kit.tsx`) are project content and must still ship.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

import { resolveScope } from '../../exporters/scope.ts';
import { run } from '../../exporters/zip.ts';
import { isMaudeRuntimeState } from '../../git/service.ts';

/** One file in every DDR-115 IGNORED family, nested where the family nests. */
const RUNTIME = [
  '_chat/c1.jsonl',
  '_chat/c1.meta.json',
  '_state/outbox/0001.json',
  '_untrusted/peer/ui/x.tsx',
  '_trash/ui/Old.tsx',
  '_draw/mark.proof.tsx',
  '_reports/report.md',
  '_history/ui-home/1.tsx',
  '_comments/ui-home.json',
  '_canvas-state/aaaaaaaaaaaaaaaa/ui-home.view.json',
  '_canvas-state/ui-home.json',
  '_export-jobs/j1/out.zip',
  '_photo/p.json',
  '_smoke/shot.png',
  '_cache/x.bin',
  '_server.json',
  '_server.lock',
  '_active.json',
  '_active.aaaaaaaaaaaaaaaa.json',
  '_sync.json',
  '_preflight.json',
  '_locator.json',
  '_export-history.json',
  '_generate-history.json',
  '.kgai/store/x.ndjson',
];

/** Versioned content, including names that start with an underscore. */
const CONTENT = [
  'config.json',
  'README.md',
  'ui/Home.tsx',
  'ui/_kit.tsx',
  'system/ds/preview/_components.css',
  'system/ds/preview/_layout.css',
  'assets/abcd1234.png',
];

function setupTree(): { root: string; designRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'zip-runtime-'));
  const designRoot = join(root, '.design');
  for (const rel of [...RUNTIME, ...CONTENT]) {
    const abs = join(designRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `// ${rel}\n`);
  }
  return { root, designRoot };
}

async function zipNames(): Promise<string[]> {
  const { root, designRoot } = setupTree();
  const targets = await resolveScope({
    scope: 'project-raw',
    activeJson: { active: null, selected: null },
    designRoot,
    repoRoot: root,
  });
  const r = await run(targets, {}, { designRoot, repoRoot: root, serverOrigin: '' });
  const zip = await JSZip.loadAsync(r.body);
  return Object.keys(zip.files).filter((n) => !zip.files[n]?.dir);
}

describe('project-raw ZIP excludes the DDR-115 runtime set (V2-2.8 S8)', () => {
  test('no runtime-state path is packed', async () => {
    const names = await zipNames();
    // Every fixture path really is runtime state per the classifier — so this
    // test fails if the fixture drifts, not just if the walk does.
    for (const rel of RUNTIME) expect(`${rel} ${isMaudeRuntimeState(rel)}`).toBe(`${rel} true`);
    const leaked = names.filter((n) => isMaudeRuntimeState(n));
    expect(leaked).toEqual([]);
    for (const rel of RUNTIME) expect(names).not.toContain(rel);
  });

  test('versioned files, underscore-named ones included, still ship', async () => {
    const names = await zipNames();
    for (const rel of CONTENT) expect(names).toContain(rel);
  });
});
