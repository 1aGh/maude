// S9.12 — U7: a project-level session is unchanged (V2-1.16 §5.1 U7, §7 `acl-u7-parity`).
//
// "Today's bodies" are pinned two ways, over the whole GET sweep of the gate fixture
// (every route on both origins, untargeted and with every target spelling):
//   1. the access machinery OFF — a second boot of the same fixture with every canvas-only
//      check reverted (the revert-guard seam) — answers owner, member, viewer and observer
//      byte-identically to the live server;
//   2. the v1 hub's request — `x-maude-role` + `x-maude-readonly` and no `x-maude-access`
//      (what a 1.9.1 hub's proxy sends) — answers byte-identically to the v2 claim of the
//      same role. An observer has no v1 spelling; it reads what a v1 viewer reads.
// Volatile bytes (clocks, ids, ports, the sandbox path) are normalised; nothing else is.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { ACL_CHECKS } from '../access/filters.ts';
import {
  ask,
  bootGateCell,
  buildProbes,
  type GateCell,
  type Headers_,
  legacySession,
  normalize,
  type Probe,
  roleSession,
} from './_acl-gate.ts';

let live: GateCell;
let off: GateCell;
beforeAll(async () => {
  live = await bootGateCell();
  off = await bootGateCell({ revert: ACL_CHECKS });
}, 90000);
afterAll(async () => {
  await live?.stop();
  await off?.stop();
});

/** The read half of the sweep: GETs only, so two boots stay in step (nothing is written). */
const reads = (cell: GateCell): Probe[] => buildProbes(cell).filter((p) => p.method === 'GET');

async function answers(cell: GateCell, headers: Headers_, probes: Probe[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < probes.length; i += 12) {
    const got = await Promise.all(probes.slice(i, i + 12).map((p) => ask(cell, p, headers)));
    for (const a of got) out.push(normalize(`${a.status} ${a.type}\n${a.heads}\n${a.text}`, cell));
  }
  return out;
}

function differences(a: string[], b: string[], probes: Probe[]): string[] {
  const out: string[] = [];
  probes.forEach((p, i) => {
    if (a[i] !== b[i])
      out.push(`${p.origin} ${p.url}: ${a[i]?.slice(0, 120)} ≠ ${b[i]?.slice(0, 120)}`);
  });
  return out;
}

describe('U7 — owner, member, viewer and observer get today’s bytes', () => {
  for (const role of ['owner', 'member', 'viewer', 'observer'] as const) {
    test(`${role}: the live server answers like the server with every canvas-only check off`, async () => {
      const probes = reads(live);
      const a = await answers(live, roleSession(role), probes);
      const b = await answers(off, roleSession(role), reads(off));
      expect(differences(a, b, probes)).toEqual([]);
    }, 600000);
  }

  for (const [role, v1] of [
    ['owner', 'owner'],
    ['member', 'member'],
    ['viewer', 'viewer'],
    ['observer', 'viewer'],
  ] as const) {
    test(`${role}: the v2 claim answers like the v1 hub's ${v1} projection`, async () => {
      const probes = reads(live);
      const a = await answers(live, roleSession(role), probes);
      const b = await answers(live, legacySession(v1), probes);
      expect(differences(a, b, probes)).toEqual([]);
    }, 600000);
  }
});
