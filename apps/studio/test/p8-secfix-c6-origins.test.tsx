// V2-8.9 defender L2 (checklist C6) — shell → canvas posts name the canvas origin, never '*': the canvas
// bridge carries no '*' target at all (the ring relay's own pin is in v2-ai-runs-ui.test.tsx).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('C6: the canvas bridge posts no message to "*"', () => {
  test('use-canvas-bridge.jsx carries no "*" target origin', () => {
    const src = readFileSync(
      join(import.meta.dir, '../client/hooks/use-canvas-bridge.jsx'),
      'utf8'
    );
    const code = src
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    expect(code).not.toMatch(/postMessage\([^;]*'\*'/s);
    expect(code).not.toMatch(/^\s*'\*'\s*\)/m);
  });
});
