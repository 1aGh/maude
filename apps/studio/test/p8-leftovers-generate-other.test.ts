// p8-sweep-leftovers item 2: Assets › Generate › Advanced › "Video or sound…" opens the Generate dialog.
//
// The button (`generate-ask-other`) runs `menuRunner.run('ai.generate')`, but the menu runner's handler map had
// no 'ai.generate' (only the ⌘K palette's v1 row ran it), so `run` returned false and nothing happened. The runner
// now opens the dialog through the shell's `setGenerateOpen` (app.jsx `live.current`).
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
const { createMenuHandlers, menuRunner } = await import('../client/v2/shell/menu-runner.js');
GlobalRegistrator.unregister();

let bound: Record<string, unknown> | null = null;
afterEach(() => {
  if (bound) menuRunner.unbind(bound);
  bound = null;
});

describe('Generate ask › Video or sound…', () => {
  test('the menu runner opens the Generate dialog', () => {
    const opened: unknown[] = [];
    const handlers = createMenuHandlers({ setGenerateOpen: (v: unknown) => opened.push(v) } as any);
    bound = handlers;
    menuRunner.bind(handlers);
    expect(menuRunner.canRun('ai.generate')).toBe(true);
    expect(menuRunner.run('ai.generate')).toBe(true);
    expect(opened).toEqual([true]);
  });

  test('the shell hands the runner its setter, and the button still asks the runner', () => {
    const app = readFileSync(join(import.meta.dir, '..', 'client', 'app.jsx'), 'utf8');
    const live = app.slice(
      app.indexOf('live.current = {'),
      app.indexOf('const d = useMemo(() => new Proxy')
    );
    expect(live).toContain('setGenerateOpen,');
    const panel = readFileSync(
      join(import.meta.dir, '..', 'client', 'v2', 'left-panel', 'assets-panel.jsx'),
      'utf8'
    );
    expect(panel).toContain("onOther={() => menuRunner.run('ai.generate')}");
  });
});
