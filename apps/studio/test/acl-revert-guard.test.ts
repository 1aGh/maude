// S9.12 — the revert guard (V2-1.16 §7 `acl-revert-guard`, standing rule 10).
//
// For each key canvas-only check, a server runs with THAT check reverted (the
// `revertAclCheckForTest` seam in access/filters.ts, reached only through
// `bun --preload test/_acl-seam-preload.ts`) and the canary sweep must go red: the sweep is
// proven to catch the check's absence, not merely to pass while it is there. The seam is
// asked on each check's live path, so a check moved off that path (left as a dead copy)
// also turns this red — the reverted server would still be safe and the sweep green.

import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACL_CHECKS, type AclCheck } from '../access/filters.ts';
import { listen, until } from './_acl-cell.ts';
import {
  A_ONLY,
  A_REL,
  A_USER,
  B_REL,
  bootGateCell,
  D,
  frameIn,
  type GateCell,
  markers,
  OWNER,
  sweep,
} from './_acl-gate.ts';

const open: GateCell[] = [];
afterAll(async () => {
  for (const c of open) await c.stop();
});

/** What the A-only session hears on its sockets while the owner edits B and comments on it. */
async function socketLeaks(cell: GateCell): Promise<string[]> {
  const shell = await listen(`${cell.base.replace(/^http/, 'ws')}/_ws`, A_ONLY);
  if ('refused' in shell) throw new Error('A-only socket refused');
  try {
    await fetch(`${cell.base}/_comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: cell.base, ...OWNER },
      body: JSON.stringify({
        file: `${D}/${B_REL}`,
        text: 'canary revert comment',
        selector: 'div',
      }),
    });
    await until(() => shell.frames.some((f) => /canary/i.test(f)), 4000);
    return shell.frames.flatMap((f) => markers(f, cell));
  } finally {
    shell.close();
  }
}

describe('reverting any one key check turns the canary sweep red', () => {
  test('every check names its live call site (the seam is on the path)', () => {
    const studio = join(import.meta.dir, '..');
    const src = (f: string) => readFileSync(join(studio, f), 'utf8');
    const sites: Record<AclCheck, [string, RegExp]> = {
      canvasScopeRefusal: ['http.ts', /await canvasScopeRefusal\(req, g\)/],
      frameFor: ['ws.ts', /scope\.frameFor\(ws, /],
      pathFirst: ['http.ts', /canvasOriginTarget\(pathname, designRel\)/],
      commentsAll: ['api.ts', /return filterCommentsAll\(out, /],
      runs: ['routes/ai.ts', /filterRunsView\(reg\.view\(\)/],
      indexData: ['api.ts', /filterIndexData\(/],
    };
    expect(Object.keys(sites).sort()).toEqual([...ACL_CHECKS].sort());
    for (const [check, [file, re]] of Object.entries(sites))
      expect({ check, called: re.test(src(file)) }).toEqual({ check, called: true });
    const filters = src('access/filters.ts') + src('access/request.ts');
    for (const check of ACL_CHECKS) expect(filters).toContain(`aclCheckOn('${check}')`);
  });

  for (const check of ACL_CHECKS) {
    test(`without ${check}`, async () => {
      const cell = await bootGateCell({ revert: [check] });
      open.push(cell);
      // gate-b-c4 — canvas-origin probes inside A's frame (frame-less, a reverted canvas
      // check would hide behind the frame gate and the guard would prove nothing).
      const r = await sweep(cell, A_USER, undefined, 12, await frameIn(cell, A_USER, A_REL));
      const heard = check === 'frameFor' ? await socketLeaks(cell) : [];
      const red = Object.keys(r.leaks).length + Object.keys(r.oracles).length + heard.length;
      expect({ check, red: red > 0 }).toEqual({ check, red: true });
      await cell.stop();
    }, 600000);
  }
});
