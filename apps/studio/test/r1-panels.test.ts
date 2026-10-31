// rc.1 findings 6 / 16 / 20 (package C) — the shell's panel widths and the shell that never scrolls.
//
// The browser end of each is test/e2e/shell-panels.e2e.mjs (real grips, real scroll gestures); here the pure parts and
// the source rules a layout-less happy-dom cannot see.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(join(import.meta.dir, '..', dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(join(import.meta.dir, '..', rel)).isDirectory() ? walk(rel) : [rel];
  });

describe('5 · no Advanced fold opens itself', () => {
  const sources = walk('client').filter((f) => f.endsWith('.jsx'));

  test('no <AdvancedFold> is written open, and no <details> fold is drawn open (the Help sheet’s guide excepted)', () => {
    const offenders: string[] = [];
    for (const f of sources) {
      const src = read(f);
      for (const m of src.matchAll(
        /<AdvancedFold\b[^>]*?\sopen(?:=\{(?:true|!0)\})?(?=[\s/>])/gs
      )) {
        // `open={someState}` is a controlled fold; a bare `open` / `open={true}` is the bug
        if (!/open=\{(?!true|!0)/.test(m[0])) offenders.push(`${f}: ${m[0].slice(0, 60)}`);
      }
      if (f.endsWith('dialogs/help-modal.jsx')) continue;
      for (const m of src.matchAll(/<details\b[^>]*?\sopen(?=[\s>])/gs))
        offenders.push(`${f}: ${m[0].slice(0, 60)}`);
    }
    expect(offenders).toEqual([]);
  });

  test('a fold with nothing remembered is closed — every panel id, today and next', async () => {
    const { createFoldStore, FOLD_DEFAULTS, FOLD_PANELS } = await import(
      '../client/v2/fold/fold-store.js'
    );
    const s = createFoldStore();
    expect(Object.keys(FOLD_DEFAULTS)).toEqual([]);
    expect(FOLD_PANELS.filter((id: string) => s.get(id))).toEqual([]);
    expect(s.get('some.panel.added.next.year')).toBe(false);
    // …and one a person opened stays open (the remembered "kept open")
    s.set('ai.chat', true);
    expect(s.get('ai.chat')).toBe(true);
    expect(s.isRemembered('ai.chat')).toBe(true);
  });
});

describe('16 · every resizable panel owns a width', () => {
  test('rightPanelWidth: the Inspector and Version history take the width they were dragged to', async () => {
    const { rightPanelWidth, rightMainWidth } = await import('../client/v2/shell/panel-layout.js');
    expect(rightPanelWidth({ active: 'inspector', base: 304, own: 340 })).toBe(340);
    expect(rightPanelWidth({ active: 'changes', base: 304, own: 450 })).toBe(450);
    expect(rightMainWidth({ active: 'inspector', base: 304, own: 300 })).toBe(300);
    // a panel with no width of its own keeps following the side's width, whatever `own` says
    expect(rightPanelWidth({ active: 'comments', base: 304, own: 999 })).toBe(304);
    // nothing dragged: the board widths
    expect(rightPanelWidth({ active: 'inspector', base: 304 })).toBe(264);
    expect(rightPanelWidth({ active: 'changes', base: 304 })).toBe(372);
  });

  test('the AI chat widens the slot to itself, and a narrower chat leaves the panel above its own width', async () => {
    const { rightPanelWidth } = await import('../client/v2/shell/panel-layout.js');
    expect(rightPanelWidth({ active: null, base: 304, aiW: 356 })).toBe(356); // was 304 + a 340 chat hanging out of it
    expect(rightPanelWidth({ active: 'inspector', base: 304, aiW: 356 })).toBe(356);
    expect(rightPanelWidth({ active: 'inspector', base: 304, own: 400, aiW: 296 })).toBe(400);
    expect(rightPanelWidth({ active: null, base: 304, aiW: 296 })).toBe(296); // narrower than the generic 304
  });

  test('aiSlotWidth: the person’s width wins; else 436 long, 420 docked, 356 otherwise', async () => {
    const { aiSlotWidth, PANEL_SIZES, AI_FULL_W } = await import(
      '../client/v2/shell/panel-sizes.js'
    );
    const def = PANEL_SIZES.ai.def;
    expect(aiSlotWidth({ w: def })).toBe(356);
    expect(aiSlotWidth({ w: def, full: true })).toBe(AI_FULL_W);
    expect(aiSlotWidth({ w: def, pinned: true })).toBe(420);
    expect(aiSlotWidth({ w: 300, full: true })).toBe(300);
    expect(aiSlotWidth({ w: 500, pinned: true })).toBe(500);
  });

  test('the store clamps, persists per panel, and survives blocked storage', async () => {
    const { createPanelSizes, PANEL_SIZES } = await import('../client/v2/shell/panel-sizes.js');
    const disk = new Map<string, string>();
    const a = createPanelSizes({
      read: (k) => disk.get(k) ?? null,
      write: (k, v) => void disk.set(k, v),
    });
    expect(a.get('inspector')).toBe(264);
    expect(a.set('inspector', 9999)).toBe(PANEL_SIZES.inspector.max);
    expect(a.set('inspector', 1)).toBe(PANEL_SIZES.inspector.min);
    expect(a.set('ai', 300)).toBe(300);
    expect(a.isCustom('ai')).toBe(true);
    // a second page reads what the first wrote
    const b = createPanelSizes({ read: (k) => disk.get(k) ?? null });
    expect(b.get('ai')).toBe(300);
    expect(b.get('inspector')).toBe(PANEL_SIZES.inspector.min);
    expect(b.get('changes')).toBe(372);
    // junk and a throwing store fall back to the defaults, never throw
    const c = createPanelSizes({
      read: () => {
        throw new Error('blocked');
      },
      write: () => {
        throw new Error('blocked');
      },
    });
    expect(c.get('ai')).toBe(356);
    expect(c.set('ai', 400)).toBe(400);
    expect(createPanelSizes({ read: () => 'nope' }).get('changes')).toBe(372);
  });

  test('handle(): the shape PanelGrip takes — setW accepts a number or an updater, clamped', async () => {
    const { createPanelSizes } = await import('../client/v2/shell/panel-sizes.js');
    const s = createPanelSizes();
    const h = s.handle('ai');
    h.setW((v: number) => v + 8);
    expect(s.get('ai')).toBe(364);
    s.handle('ai').setW(10);
    expect(s.get('ai')).toBe(s.handle('ai').min);
    s.reset('ai');
    expect(s.get('ai')).toBe(356);
  });

  test('gripTarget: the grip resizes the widest island in its slot', async () => {
    const { gripTarget } = await import('../client/v2/shell/panel-sizes.js');
    // the chat alone, or the chat wider than the panel beside it
    expect(gripTarget({ active: null, mainW: 0, aiW: 356, generic: 'rp' })).toBe('ai');
    expect(gripTarget({ active: 'inspector', mainW: 264, aiW: 356, generic: 'rp' })).toBe('ai');
    // the panel wider than the chat, or no chat
    expect(gripTarget({ active: 'inspector', mainW: 400, aiW: 296, generic: 'rp' })).toBe(
      'inspector'
    );
    expect(gripTarget({ active: 'changes', mainW: 372, aiW: 0, generic: 'rp' })).toBe('changes');
    // a panel with no width of its own follows the side
    expect(gripTarget({ active: 'comments', mainW: 304, aiW: 0, generic: 'rp' })).toBe('rp');
    expect(gripTarget({ active: 'tree', mainW: 264, aiW: 0, generic: 'sb' })).toBe('sb');
  });

  test('the shell wires it: grips take the target, the drag handler routes by it', () => {
    const app = read('client/app.jsx');
    expect(app).toContain('sizes.setTarget(rightGrip)');
    expect(app).toContain('sizes.setTarget(leftGrip)');
    expect(app).toContain('aiW: rightAiShown ? aiSlotW : 0');
    const core = read('client/hooks/use-shell-core.jsx');
    expect(core).toContain('panelSizes.target()');
    expect(core).toContain('hasOwnWidth(target)');
  });
});

describe('6 · the AI chat is its slot, and a folded icon stands beside it', () => {
  const panelCss = read('client/v2/ai/panel.css');
  const floatCss = read('client/v2/shell/floating-panels.css');

  test('the floating chat has no fixed 340 floor: it takes the slot’s width', () => {
    const rule = /\.sh-body--float \.sh-dockslot-ai \{[^}]*\}/.exec(panelCss)?.[0] ?? '';
    expect(rule).not.toMatch(/width:\s*340px/);
    expect(rule).not.toContain('min-width: 100%');
    expect(rule).toContain('align-self: stretch');
    expect(panelCss).not.toMatch(/width:\s*420px/);
  });

  test('the panel above the chat keeps its own width', () => {
    expect(panelCss).toMatch(
      /\.sh-dockslot--right\.has-ai > \.sh-dockslot-inner:not\(\.sh-dockslot-ai\) \{[^}]*--dock-main-w/
    );
  });

  test('the corner icon dodges ANY shown chat, not only a full-height one', () => {
    const rule =
      /\.sh-body--float:has\(\s*> \.sh-dockslot--right[^{]*\{[^}]*\}/.exec(floatCss)?.[0] ?? '';
    expect(rule).toContain('.sh-dockslot-ai:not([hidden])');
    expect(rule).not.toContain('data-full');
    expect(rule).toContain('var(--rp-w');
  });
});

describe('20 · nothing scrolls the shell', () => {
  test('the shell root clips (not a scroll container) and the document does not scroll', () => {
    const floatCss = read('client/v2/shell/floating-panels.css');
    expect(floatCss).toMatch(/@supports \(overflow: clip\) \{\s*\.sh-shell \{\s*overflow: clip;/);
    const reset = read('client/styles/0-reset.css');
    const root = /html,\s*body \{[^}]*\}/.exec(reset)?.[0] ?? '';
    expect(root).toContain('overflow: hidden');
  });

  describe('the scroll lock (scripts can still scroll an overflow:hidden root)', () => {
    beforeAll(() => GlobalRegistrator.register());
    afterAll(() => GlobalRegistrator.unregister());

    test('resetShellScroll puts the document, body, .maude and .sh-shell back to 0', async () => {
      const { resetShellScroll } = await import('../client/v2/shell/scroll-lock.js');
      document.body.innerHTML = '<div class="maude"><div class="sh-shell"></div></div>';
      const els = [
        document.documentElement,
        document.body,
        document.querySelector('.maude') as HTMLElement,
        document.querySelector('.sh-shell') as HTMLElement,
      ];
      for (const el of els) {
        el.scrollTop = 120;
        el.scrollLeft = 30;
      }
      expect(resetShellScroll(document)).toBe(true);
      for (const el of els) expect([el.scrollTop, el.scrollLeft]).toEqual([0, 0]);
      expect(resetShellScroll(document)).toBe(false); // nothing to do the second time
    });

    test('a scroll event on the shell root is undone; a panel scrolling inside itself is left alone', async () => {
      const { installShellScrollLock } = await import('../client/v2/shell/scroll-lock.js');
      document.body.innerHTML =
        '<div class="maude"><div class="sh-shell"><div class="sh-tree" id="tree"></div></div></div>';
      const off = installShellScrollLock(document);
      const shell = document.querySelector('.sh-shell') as HTMLElement;
      const tree = document.getElementById('tree') as HTMLElement;
      shell.scrollTop = 300;
      shell.dispatchEvent(new window.Event('scroll'));
      expect(shell.scrollTop).toBe(0);
      tree.scrollTop = 80;
      tree.dispatchEvent(new window.Event('scroll'));
      expect(tree.scrollTop).toBe(80);
      off();
      shell.scrollTop = 200;
      shell.dispatchEvent(new window.Event('scroll'));
      expect(shell.scrollTop).toBe(200); // uninstalled
    });

    test('the shell core installs it once at boot', () => {
      expect(read('client/hooks/use-shell-core.jsx')).toContain('installShellScrollLock(document)');
    });
  });
});
