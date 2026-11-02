// S11.2 — the pieces are mounted where they must be, and the registry action has a runner.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(import.meta.dir, '..');
const src = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

describe('mounts', () => {
  test('the shell mounts the host, the canvas mounts the reporter, Layers mounts its empty line', () => {
    expect(src('client/app.jsx')).toContain('<EmptyHost />');
    expect(src('editing/index.tsx')).toContain('<EmptyArtboardReporter />');
    expect(src('client/inspector/inspector-panel.jsx')).toContain('<LayersEmpty');
  });
});

describe('ai.ask-fill-artboard', () => {
  test('a registry row, an agent path, and a runner (no dead ⌘K row)', async () => {
    const { ACTIONS_BY_ID } = await import('../actions/index.ts');
    const def = ACTIONS_BY_ID.get('ai.ask-fill-artboard');
    expect(def?.exec).toBe('shell');
    expect(def?.visible).toMatchObject({ shell: ['desktop'], minRole: 'edit' });
    const { createMenuHandlers } = await import('../client/v2/shell/menu-runner.js');
    const calls: string[] = [];
    const h = createMenuHandlers({
      native: true,
      toast: (m: string) => calls.push(`toast:${m}`),
    });
    expect(typeof h['ai.ask-fill-artboard']).toBe('function');
    const { bindFillAsk } = await import('../client/v2/empty/fill-ask.js');
    const un = bindFillAsk(() => {
      calls.push('fill');
      return true;
    });
    h['ai.ask-fill-artboard']();
    un();
    h['ai.ask-fill-artboard'](); // unbound: nothing, and no crash
    expect(calls).toEqual(['fill']);
  });

  test('outside the desktop app it says where the chat lives instead of doing nothing', async () => {
    const { createMenuHandlers } = await import('../client/v2/shell/menu-runner.js');
    const calls: string[] = [];
    const h = createMenuHandlers({ native: false, toast: (m: string) => calls.push(m) });
    h['ai.ask-fill-artboard']();
    expect(calls).toEqual(['AI chat is in the Maude desktop app.']);
  });
});
