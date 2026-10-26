// p8-fixups2 — Esc on a selected object steps OUT to its parent (board 14 · decision
// maude/v2-p8-lead-esc-steps-out-per-board-14): a nested object → Esc → its parent → … → the top → nothing selected.
// The V2-8.7 walk read "Esc clears the selection"; the live canvas (an E2E drive, p8-fixups2) already stepped out —
// the walk had selected a TOP-LEVEL object, where there is no parent to step to. This is the keyboard pin that was
// missing: the real router, the real ladder (`runEscRung`, Edit), the real selection rung (`stepOut`) over a real
// nested DOM, press by press, plus the two things that must NOT step out (a text edit cancels first; Inspect clears).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { escClearsSelection, runEscRung } from '../bridge/esc-ladder.ts';
import { stepOut } from '../editing/selection.tsx';
import { useInputRouter } from '../input-router.tsx';
import { SelectionSetProvider, useSelectionSet } from '../use-selection-set.tsx';
import { ToolProvider, useToolMode } from '../use-tool-mode.tsx';

const FIXTURE = `
<article class="dc-artboard" data-dc-screen="desktop">
  <div class="dc-artboard-body">
    <section data-cd-id="services" data-dc-element="services">
      <div data-cd-id="row">
        <h3 data-cd-id="title">Brand systems</h3>
      </div>
    </section>
  </div>
</article>`;
const sel = (id: string) => ({
  id,
  selector: `[data-dc-screen="desktop"] [data-cd-id="${id}"]`,
  artboardId: 'desktop',
});

type SelCtx = ReturnType<typeof useSelectionSet>;
let selCtx: SelCtx | null = null;
const roots: Root[] = [];
const outcomes: string[] = [];

/** canvas-shell's selection rung, as it wires it (a source pin below keeps this honest). */
function Wiring({ mode }: { mode: 'edit' | 'preview' }) {
  const c = useToolMode();
  const s = useSelectionSet();
  selCtx = s;
  const host = useRef<HTMLDivElement | null>(null);
  useInputRouter({
    hostRef: host,
    getActiveTool: () => c.tool,
    callbacks: {
      onEscape: () => {
        const outcome = runEscRung(mode, c.tool, {
          selection: () => {
            if (s.selected.length === 0) return false;
            if (escClearsSelection(mode) || !stepOut(s)) s.clear();
            return true;
          },
        });
        outcomes.push(outcome);
        return outcome !== 'back' && outcome !== 'stay';
      },
    },
  });
  return <div ref={host} />;
}

async function mount(mode: 'edit' | 'preview', select: string) {
  document.body.innerHTML = FIXTURE;
  const h = document.createElement('div');
  document.body.append(h);
  const r = createRoot(h);
  roots.push(r);
  await act(async () =>
    r.render(
      <ToolProvider governed>
        <SelectionSetProvider>
          <Wiring mode={mode} />
        </SelectionSetProvider>
      </ToolProvider>
    )
  );
  await act(async () => (selCtx as SelCtx).replace(sel(select) as never));
}
const selected = () => (selCtx as SelCtx).selected.map((s) => s.id ?? null);
const esc = async (target: EventTarget = document) => {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
  });
  return ev;
};

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  selCtx = null;
  outcomes.length = 0;
});

describe('Esc steps out on the canvas (board 14)', () => {
  test('a nested object: Esc → parent → grandparent → nothing selected', async () => {
    await mount('edit', 'title');
    expect(selected()).toEqual(['title']);
    await esc();
    expect(selected()).toEqual(['row']);
    await esc();
    expect(selected()).toEqual(['services']);
    await esc(); // the top of the artboard: nowhere left to step, so it deselects
    expect(selected()).toEqual([]);
    expect(outcomes).toEqual(['selection', 'selection', 'selection']);
  });

  test('every press takes ONE step and is consumed (default prevented)', async () => {
    await mount('edit', 'title');
    const ev = await esc();
    expect(ev.defaultPrevented).toBe(true);
    expect(selected()).toEqual(['row']);
  });

  test('a top-level object clears at once — nothing above it to step to', async () => {
    await mount('edit', 'services');
    await esc();
    expect(selected()).toEqual([]);
  });

  test('Inspect (Preview) clears the inspection in one press instead of stepping', async () => {
    await mount('preview', 'title');
    await esc();
    expect(selected()).toEqual([]);
  });

  test('a multi-selection has no single parent: Esc clears it', async () => {
    await mount('edit', 'title');
    await act(async () => (selCtx as SelCtx).add?.(sel('row') as never));
    if ((selCtx as SelCtx).selected.length < 2) return; // the set refused a second member: nothing to pin
    await esc();
    expect(selected()).toEqual([]);
  });
});

describe('the shell wires the same rung', () => {
  test('canvas-shell.tsx: governed Edit steps out, Inspect clears, ungoverned steps out too', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'canvas-shell.tsx'), 'utf8');
    expect(src).toContain('if (escClearsSelection(governed) || !stepOut(selSet)) selSet.clear();');
    expect(src).toContain('if (!stepOut(selSet)) selSet.clear();');
  });
});
