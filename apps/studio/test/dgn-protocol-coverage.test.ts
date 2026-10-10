// V2-1.2 §7 T1 — the drift gate between the sources and the typed dgn table.
//
// scripts/v2-dgn/dgn-inventory.mjs parses every apps/studio source, apps/hub/src and the template's
// inline scripts and lists each `dgn` type with its send and handle sites. This test holds the
// table (apps/studio/bridge/dgn-protocol.ts) to it: every literal in the sources is a table row
// with the direction the code uses; every live row still has a sender and a handler (or declares
// the orphan); the only dynamic send sites are the two the table resolves by hand.

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { inventory } from '../../../scripts/v2-dgn/dgn-inventory.mjs';
import {
  type CanvasToShellMessage,
  DGN_TABLE,
  type ShellToCanvasMessage,
} from '../bridge/dgn-protocol.ts';

type Site = { file: string; line: number; side: 'shell' | 'canvas'; gates?: string[] };
type Row = {
  type: string;
  dir: string[];
  orphan: 'no-sender' | 'no-handler' | null;
  dynamic: boolean;
  sends: Site[];
  handles: Site[];
};

const REPO = resolve(import.meta.dir, '../../..');
const inv = inventory(REPO) as unknown as { rows: Row[] };
const rows = inv.rows.filter((r) => !r.dynamic);
const byType = new Map(rows.map((r) => [r.type, r]));
const C2S = DGN_TABLE.c2s as Record<string, { status: string; orphan?: string; gate: string }>;
const S2C = DGN_TABLE.s2c as Record<string, { status: string; orphan?: string; gate: string }>;
const spec = (t: string) => C2S[t] ?? S2C[t];

/** Dynamic send sites the table resolves by hand: `{dgn: dir}` → undo | redo (the inspector
 *  knobs' ⌘Z), `bridgeRequest(reqDgn, resDgn)` → export(-history)-request. */
const DYNAMIC: Record<string, { file: string; resolves: string[] }> = {
  '<dynamic:dir>': {
    file: 'apps/studio/client/hooks/use-palette-and-panels.jsx',
    resolves: ['undo', 'redo'],
  },
  '<dynamic:reqDgn>': {
    file: 'apps/studio/export-dialog.tsx',
    resolves: ['export-request', 'export-history-request'],
  },
};

describe('dgn table ↔ sources (T1)', () => {
  test('the inventory sees the bridge (sanity)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  test('every dgn literal in the sources is a table row', () => {
    const missing = rows.map((r) => r.type).filter((t) => !spec(t));
    expect(missing).toEqual([]);
  });

  test('a type has exactly one direction', () => {
    expect(Object.keys(C2S).filter((t) => t in S2C)).toEqual([]);
  });

  test('c2s rows: sent by the canvas, handled by the shell — never the reverse', () => {
    const bad: string[] = [];
    for (const [t, s] of Object.entries(C2S)) {
      const r = byType.get(t);
      if (!r) continue;
      if (r.sends.some((x) => x.side === 'shell')) bad.push(`${t}: a shell-side sender`);
      if (s.status === 'new' || s.status === 'proposed') continue;
      if (s.orphan !== 'no-sender' && !r.sends.some((x) => x.side === 'canvas'))
        bad.push(`${t}: no canvas-side sender`);
      if (s.orphan !== 'no-handler' && !r.handles.some((x) => x.side === 'shell'))
        bad.push(`${t}: no shell handler`);
    }
    expect(bad).toEqual([]);
  });

  test('s2c rows: sent by the shell, handled by the canvas — never the reverse', () => {
    const bad: string[] = [];
    for (const [t, s] of Object.entries(S2C)) {
      const r = byType.get(t);
      if (!r) continue;
      if (r.handles.some((x) => x.side === 'shell')) bad.push(`${t}: a shell-side handler`);
      if (s.status === 'new' || s.status === 'proposed') continue; // lands handler-first, sender in V2-4.x
      const dynSent = Object.values(DYNAMIC).some((d) => d.resolves.includes(t));
      if (s.orphan !== 'no-sender' && !dynSent && !r.sends.some((x) => x.side === 'shell'))
        bad.push(`${t}: no shell-side sender`);
      if (s.orphan !== 'no-handler' && !r.handles.some((x) => x.side === 'canvas'))
        bad.push(`${t}: no canvas handler`);
    }
    expect(bad).toEqual([]);
  });

  test('declared orphans are orphans; an undeclared one fails', () => {
    const bad: string[] = [];
    for (const r of rows) {
      const s = spec(r.type);
      if (!s || s.status === 'new' || s.status === 'proposed') continue;
      if (r.orphan !== (s.orphan ?? null))
        bad.push(`${r.type}: inventory ${r.orphan} · table ${s.orphan}`);
    }
    expect(bad).toEqual([]);
  });

  test('no stale rows: every live / legacy row is still in the sources', () => {
    const dyn = new Set(Object.values(DYNAMIC).flatMap((d) => d.resolves));
    const stale = [...Object.entries(C2S), ...Object.entries(S2C)]
      .filter(
        ([t, s]) => (s.status === 'live' || s.status === 'legacy') && !byType.has(t) && !dyn.has(t)
      )
      .map(([t]) => t);
    expect(stale).toEqual([]);
  });

  test('new / proposed rows are not yet live anywhere they would contradict', () => {
    // A `new` row may gain its handler before its sender (the canvas side lands first); it must
    // never be SENT in-tree until its governed path lands (V2-4.x), and keeps its direction.
    const sentEarly = [...Object.entries(C2S), ...Object.entries(S2C)]
      .filter(
        ([t, s]) =>
          (s.status === 'new' || s.status === 'proposed') && (byType.get(t)?.sends.length ?? 0) > 0
      )
      .map(([t]) => t);
    expect(sentEarly).toEqual([]);
  });

  test('the only dynamic send sites are the two the table resolves by hand', () => {
    const dyn = inv.rows.filter((r) => r.dynamic);
    expect(dyn.map((r) => r.type).sort()).toEqual(Object.keys(DYNAMIC).sort());
    for (const r of dyn) {
      expect(r.sends.map((s) => s.file)).toEqual([DYNAMIC[r.type].file]);
      for (const t of DYNAMIC[r.type].resolves) expect(spec(t)).toBeTruthy();
    }
  });

  test('a canvas handler of a parent-gated row checks the parent (or goes through the table)', () => {
    const bad: string[] = [];
    for (const [t, s] of Object.entries(S2C)) {
      if (s.gate !== 'parent') continue;
      for (const h of byType.get(t)?.handles ?? []) {
        if (h.side !== 'canvas' || h.file.startsWith('apps/studio/bridge/')) continue;
        if (!h.gates?.includes('parent')) bad.push(`${t} @ ${h.file}:${h.line}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the message types are the table (compile-time probes, T1)', () => {
  test('an unknown dgn type and a malformed set-mode do not type-check', () => {
    // @ts-expect-error — not a dgn type
    const unknown: CanvasToShellMessage = { dgn: 'no-such-message' };
    const badMode: ShellToCanvasMessage = {
      dgn: 'set-mode',
      v: 2,
      seq: 1,
      // @ts-expect-error — not a CanvasModeV2
      mode: 'zen',
      present: null,
      caps: { edit: true, annotate: true, comment: true },
    };
    // @ts-expect-error — occluded-insets without insets
    const noInsets: ShellToCanvasMessage = { dgn: 'occluded-insets', seq: 1 };
    expect([unknown, badMode, noInsets].length).toBe(3);
  });
});
