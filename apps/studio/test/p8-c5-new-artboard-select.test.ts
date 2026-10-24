// P8 C5 (05 es-artboard-new): "New artboard" leaves the new board selected — the hint and the compact Inspector
// belong to a selected empty board.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEW_ARTBOARD_RUNGS, selectNewArtboard } from '../client/v2/empty/select-new-artboard.js';

describe('selectNewArtboard', () => {
  const fake = () => {
    const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
    return {
      timers,
      schedule: (fn: () => void, ms: number) => {
        const t = { fn, ms, live: true };
        timers.push(t);
        return t;
      },
      clear: (h: unknown) => {
        (h as { live: boolean }).live = false;
      },
      fire: () => {
        for (const t of timers) if (t.live) t.fn();
      },
    };
  };

  test('one select-by-id per rung, naming the whole artboard (no element id)', () => {
    const f = fake();
    const sent: object[] = [];
    selectNewArtboard({ artboardId: 's1a2b3', post: (m) => sent.push(m), ...f });
    expect(f.timers.map((t) => t.ms)).toEqual([...NEW_ARTBOARD_RUNGS]);
    f.fire();
    expect(sent).toHaveLength(NEW_ARTBOARD_RUNGS.length);
    expect(sent[0]).toEqual({ dgn: 'select-by-id', artboardId: 's1a2b3', index: 0 });
    expect('id' in (sent[0] as object)).toBe(false);
  });

  test('cancel stops the rest (a canvas switch must not select on the next canvas)', () => {
    const f = fake();
    const sent: object[] = [];
    const cancel = selectNewArtboard({ artboardId: 'x', post: (m) => sent.push(m), ...f });
    cancel();
    f.fire();
    expect(sent).toEqual([]);
  });
});

describe('the shell asks for it when the add is written', () => {
  const src = readFileSync(
    join(import.meta.dir, '..', 'client', 'hooks', 'use-canvas-bridge.jsx'),
    'utf8'
  );
  test('insertArtboardShell selects the new board once the write is ok', () => {
    const fn = /const insertArtboardShell = useCallback\([\s\S]*?\n {2}\);\n/.exec(src)?.[0] ?? '';
    expect(fn).toContain('selectNewArtboard(');
    expect(fn).toContain('onOk');
  });
});
