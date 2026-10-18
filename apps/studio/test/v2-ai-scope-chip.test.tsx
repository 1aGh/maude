// S5.8 (03 `ai-scope`) — the scope chip as markup and as a menu. Real component, static markup for the
// words, happy-dom for the menu (open, pick, esc, outside click).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScopeChip } from '../client/v2/ai/ScopeChip.jsx';

const BOARDS = [
  { id: 'post', label: 'Post 1:1 · Combine 2026' },
  { id: 'story', label: 'Story 9:16' },
  { id: 'poster', label: 'A4 · plakát' },
];
const noop = () => {};
const html = (scope: unknown, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <ScopeChip scope={scope} artboards={BOARDS} onChoose={noop} onRemove={noop} {...extra} />
  );

describe('the chip says what AI touches', () => {
  test('◆ Whole canvas, ◆ <artboard short name>, ◆ N artboards', () => {
    expect(html({ kind: 'whole' })).toContain('◆</span><span class="ai-scope-text">Whole canvas');
    expect(html({ kind: 'artboards', ids: ['post'] })).toContain('>Post 1:1<');
    expect(html({ kind: 'artboards', ids: ['post', 'story', 'poster'] })).toContain(
      '>3 artboards<'
    );
  });

  test('"No canvas" has no ◆ and no remove ×; the others keep the v1 ×', () => {
    const none = html({ kind: 'none' });
    expect(none).toContain('>No canvas<');
    expect(none).not.toContain('◆');
    expect(none).not.toContain('Remove canvas context from this message');
    expect(html({ kind: 'whole' })).toContain(
      'aria-label="Remove canvas context from this message"'
    );
  });

  test('keeps the v1 testid, adds its own, and a stale selection warns', () => {
    const h = html({ kind: 'whole' }, { stale: true });
    expect(h).toContain('data-testid="chat-context-chip"');
    expect(h).toContain('data-testid="ai-scope-chip"');
    expect(h).toContain('canvas changed since selection');
    expect(h).toContain('⚠');
  });

  test('a several-artboards chip lists the full names on hover', () => {
    const h = html({ kind: 'artboards', ids: ['post', 'story'] });
    expect(h).toContain('Post 1:1 · Combine 2026 · Story 9:16');
  });
});

describe('the chip menu', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  async function mount(scope: unknown, activeArtboardId: string | null = 'post') {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { ScopeChip: Chip } = await import('../client/v2/ai/ScopeChip.jsx');
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const chosen: unknown[] = [];
    let removed = 0;
    await act(async () =>
      root.render(
        <Chip
          scope={scope}
          artboards={BOARDS}
          activeArtboardId={activeArtboardId}
          onChoose={(s: unknown) => chosen.push(s)}
          onRemove={() => {
            removed += 1;
          }}
        />
      )
    );
    const q = (sel: string) => document.querySelector(sel) as HTMLElement;
    return { act, chosen, removed: () => removed, q };
  }

  test('click opens it in 03 order and focuses the first row; esc closes it and focus returns to the chip', async () => {
    const t = await mount({ kind: 'whole' });
    await t.act(async () => t.q('[data-testid="ai-scope-chip"]').click());
    const menu = t.q('[data-testid="ai-scope-menu"]');
    expect(menu).not.toBeNull();
    expect(
      [...menu.querySelectorAll('[role^="menuitem"]')].map((n) => n.textContent?.replace('✓', ''))
    ).toEqual([
      'Whole canvas',
      'Post 1:1 · Combine 2026',
      'Choose artboards…',
      'No canvas — just ask',
    ]);
    expect(document.activeElement).toBe(menu.querySelector('[role^="menuitem"]'));
    await t.act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(t.q('[data-testid="ai-scope-menu"]')).toBeNull();
    expect(document.activeElement).toBe(t.q('[data-testid="ai-scope-chip"]'));
  });

  test('picking a row reports the scope and closes', async () => {
    const t = await mount({ kind: 'whole' });
    await t.act(async () => t.q('[data-testid="ai-scope-chip"]').click());
    await t.act(async () => t.q('[data-testid="ai-scope-item-none"]').click());
    expect(t.chosen).toEqual([{ kind: 'none' }]);
    expect(t.q('[data-testid="ai-scope-menu"]')).toBeNull();
    await t.act(async () => t.q('[data-testid="ai-scope-chip"]').click());
    await t.act(async () => t.q('[data-testid="ai-scope-item-artboard:post"]').click());
    expect(t.chosen[1]).toEqual({ kind: 'artboards', ids: ['post'] });
  });

  test('Choose artboards… lists every artboard as a check row; each click toggles', async () => {
    const t = await mount({ kind: 'artboards', ids: ['post'] });
    await t.act(async () => t.q('[data-testid="ai-scope-chip"]').click());
    await t.act(async () => t.q('[data-testid="ai-scope-item-choose"]').click());
    const rows = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    await t.act(async () => t.q('[data-testid="ai-scope-item-artboard-story"]').click());
    expect(t.chosen).toEqual([{ kind: 'artboards', ids: ['post', 'story'] }]);
  });

  test('the checked row is the current scope', async () => {
    const t = await mount({ kind: 'none' });
    await t.act(async () => t.q('[data-testid="ai-scope-chip"]').click());
    expect(t.q('[data-testid="ai-scope-item-none"]').getAttribute('aria-checked')).toBe('true');
    expect(t.q('[data-testid="ai-scope-item-whole"]').getAttribute('aria-checked')).toBe('false');
  });

  test('× is "No canvas — just ask" by another door', async () => {
    const t = await mount({ kind: 'whole' });
    await t.act(async () => t.q('.ai-scope-x').click());
    expect(t.removed()).toBe(1);
  });
});
