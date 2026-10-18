// S2.1 — Phase 4 security low EH-P4-3: a chord the canvas forwards (`dgn:'key'`) resolves with the
// SESSION's role, never a hard-coded owner. A viewer's forwarded chord must not reach an action the
// registry gates to Can edit (V2-1.7 rule 12: what the UI hides for a role, every door refuses).

import { afterEach, describe, expect, test } from 'bun:test';

import { kb } from '../actions/defs/_v1.ts';
import { indexKeys } from '../actions/resolve.ts';
import type { ActionDef } from '../actions/types.ts';
import { runForwardedKey, SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

// A forwarded, edit-gated action (the shape S2's writes will have): planted, with a handler.
const PLANT: ActionDef = {
  id: 'test.forwarded-write',
  label: 'Forwarded write',
  kind: 'command',
  exec: 'shell',
  fromCanvas: true,
  enabled: { minRole: 'edit' },
  keys: [kb('⌥⌘J', 'global', { inText: true })],
};

const handlers = SHELL_KEY_HANDLERS as Record<string, (...a: unknown[]) => void>;
let ran = 0;
afterEach(() => {
  delete handlers[PLANT.id];
  ran = 0;
});

describe('runForwardedKey resolves with the session role (EH-P4-3)', () => {
  const index = indexKeys([PLANT]);
  const plant = () => {
    handlers[PLANT.id] = () => {
      ran += 1;
    };
  };

  test("a viewer's forwarded chord does not run an edit-gated action", () => {
    plant();
    const denied: string[] = [];
    runForwardedKey('⌥⌘J', { readOnly: true, denied: (line: string) => denied.push(line) }, index);
    expect(ran).toBe(0);
    expect(denied.length).toBe(1);
  });

  test('an editor’s forwarded chord runs it', () => {
    plant();
    expect(runForwardedKey('⌥⌘J', { readOnly: false }, index)).toBe(true);
    expect(ran).toBe(1);
  });
});
