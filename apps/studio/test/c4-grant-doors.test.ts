// gate-b-c4 — grant enforcement, every write door (decision `v2-michal-c4-fix-in-wave-b`): an
// editor whose grant covers ONE canvas has view only on every other canvas. Two such sessions —
// "Can view the project + Can edit A" (observer + grant) and a canvas-only "Can edit A" — send
// every write probe of every studio route table (test/_acl-gate.ts reads them from http.ts, the
// V2-2.5 table and the canvas origin's map: DS ops, assets, trash, exports, photo, kinds,
// versions, comments v2, annotations, describe, …) NAMING B. None may land: each answers a
// refusal unless its capability is the session's own place (`session`) or Ask to edit
// (`request`), and B's files on disk are byte-identical afterwards.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCapability } from '../access/request.ts';
import type { AccessClaim } from '../access/scope.ts';
import { allSpecs } from '../routes/index.ts';
import {
  A_REL,
  ask,
  B_REL,
  bootGateCell,
  buildProbes,
  D,
  type GateCell,
  type Headers_,
  markers,
} from './_acl-gate.ts';
import { stubDeps } from './_route-stubs.ts';

const claim = (c: AccessClaim) => Buffer.from(JSON.stringify(c)).toString('base64url');
const GRANT_A = [{ c: A_REL, r: 'member' as const }];
const SESSIONS: Record<string, Headers_> = {
  'observer + Can edit A': {
    'x-maude-access': claim({ v: 1, role: 'observer', grants: GRANT_A }),
    'x-maude-role': 'observer',
    'x-maude-readonly': '1',
  },
  'canvas-only Can edit A': {
    'x-maude-access': claim({ v: 1, role: null, grants: GRANT_A }),
    'x-maude-readonly': '1',
  },
};

/** The table's own `readOnly: 'allowed'` writes are the session class (their own place). */
const tableSession = (() => {
  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const spec of allSpecs(stubDeps())) {
    if (spec.readOnly !== 'allowed') continue;
    if (spec.path.includes(':'))
      patterns.push(new RegExp(`^${spec.path.replace(/:[A-Za-z_]+/g, '[^/]+')}$`));
    else exact.add(spec.path);
  }
  return { exact, patterns };
})();
const OWN_PLACE = new Set(['session', 'request', 'read']);

let cell: GateCell;
let before: Record<string, string>;
const snapshot = (): Record<string, string> => {
  const read = (rel: string) => {
    try {
      return readFileSync(join(cell.designRoot, rel), 'utf8');
    } catch {
      return '<absent>';
    }
  };
  return {
    source: read(B_REL),
    meta: read(B_REL.replace('.tsx', '.meta.json')),
    board: read(B_REL.replace('.tsx', '.annotations.json')),
    comments: read('_comments/b.json'),
    trash: (() => {
      try {
        return readdirSync(join(cell.designRoot, '_trash')).sort().join('\n');
      } catch {
        return '';
      }
    })(),
  };
};

beforeAll(async () => {
  cell = await bootGateCell();
  before = snapshot();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

for (const [name, headers] of Object.entries(SESSIONS)) {
  describe(`${name} — every write naming B`, () => {
    test('is refused (or is the session’s own place) on every door', async () => {
      const probes = buildProbes(cell).filter(
        (p) => p.method !== 'GET' && p.side === 'b' && p.origin === 'main'
      );
      expect(probes.length).toBeGreaterThan(30);
      const landed: string[] = [];
      for (const p of probes) {
        const path = new URL(`http://x${p.url}`).pathname;
        const cap = writeCapability(path, tableSession);
        const a = await ask(cell, p, headers);
        if (a.status >= 200 && a.status < 300 && !OWN_PLACE.has(cap))
          landed.push(`${p.method} ${p.url} → ${a.status} (${cap})`);
        expect({ url: p.url, leak: markers(a.text, cell) }).toEqual({ url: p.url, leak: [] });
      }
      expect(landed).toEqual([]);
    }, 240000);

    test("B's source, meta, board, comments and the trash are untouched", () => {
      expect(snapshot()).toEqual(before);
    });

    test('the AI chat refuses the session (no AI below Can edit on the project)', async () => {
      const r = await fetch(`${cell.base}/_api/acp/prompt`, {
        method: 'POST',
        headers: { ...headers, origin: cell.base, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'rewrite ui/canary-folder/canary-b.tsx' }),
      });
      expect(r.status).toBe(403);
    });
  });
}

test('the fixture names B where every write door reads its target', () => {
  expect(`${D}/${B_REL}`).toContain('canary');
});
