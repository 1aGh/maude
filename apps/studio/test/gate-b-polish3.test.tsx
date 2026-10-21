// gate-b-polish3 — the wave-B gate design blockers that are testable headlessly:
//   10 / 01 · the comment composer is the v2 card (the place in words, one field, a round send) — never a raw id;
//   07 · the timeline clip name is legible (one centred chip on the current theme's ink, the body face).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArtboardLayers, currentBoard } from '../client/v2/layers/artboard-layers.jsx';
import { CommentComposer, placeWords } from '../comments-overlay.tsx';

const STUDIO = join(import.meta.dir, '..');
const css = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');
/** The declarations of the first rule whose selector is exactly `sel`. */
const rule = (src: string, sel: string) => {
  const at = src.indexOf(`\n${sel} {`);
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('}', at));
};

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
});

function board() {
  const ab = document.createElement('article');
  ab.setAttribute('data-dc-screen', 'hero');
  ab.innerHTML =
    '<div class="dc-artboard-label">Hero · desktop</div><div class="dc-artboard-body"><h2 data-cd-id="566b4b33">Book a call</h2></div>';
  document.body.append(ab);
}

function mountComposer(state: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentComposer state={state as never} onSubmit={() => {}} onCancel={() => {}} />
    );
  });
  return host.querySelector('.cm-composer') as HTMLElement;
}

describe('10 · the comment composer', () => {
  test('the header says where in words, never the raw element id', () => {
    board();
    const card = mountComposer({
      selection: { selector: '[data-cd-id="566b4b33"]', tag: 'h2' },
      clientX: 200,
      clientY: 200,
    });
    expect(card).not.toBeNull();
    expect(card.textContent).not.toContain('cd:');
    expect(card.textContent).not.toContain('566b4b33');
    expect(card.textContent).not.toContain('New comment');
    expect(card.querySelector('[data-testid="comment-composer-where"]')?.textContent).toBe(
      'Hero · desktop'
    );
  });

  test('one field and a round send — no CANCEL / SAVE pair; × and esc cancel', () => {
    board();
    const card = mountComposer({ selection: { selector: '' }, clientX: 10, clientY: 10 });
    const buttons = [...card.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent?.trim()).filter(Boolean)).not.toContain('Save');
    expect(card.querySelector('.cm-btn--primary')?.getAttribute('aria-label')).toBe('Send');
    expect(card.querySelector('[data-testid="comment-composer-cancel"]')).not.toBeNull();
    expect(card.querySelector('.cm-composer__textarea')?.getAttribute('placeholder')).not.toMatch(
      /Esc/
    );
    expect(card.querySelector('[data-testid="comment-composer-where"]')?.textContent).toBe(
      'On the canvas'
    );
  });

  test('placeWords: artboard label, else the element name, else the canvas', () => {
    board();
    expect(placeWords({ artboard: 'hero' })).toBe('Hero · desktop');
    expect(placeWords({ selector: '[data-cd-id="566b4b33"]' })).toBe('Hero · desktop');
    expect(placeWords({ selector: '[data-cd-id="missing"]' })).toBe('On the canvas');
    expect(placeWords({ selector: 'not a [ selector' })).toBe('On the canvas');
  });

  test('the composer card and its buttons speak the body face on chrome tokens — no hex, no caps, no 2 px', () => {
    const src = css('client/comments-overlay.css');
    for (const sel of ['.cm-composer', '.cm-btn', '.cm-composer__where']) {
      const r = rule(src, sel);
      expect(r).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      expect(r).not.toMatch(/text-transform:\s*uppercase/);
      expect(r).not.toMatch(/font-mono/);
      expect(r).not.toMatch(/border-radius:\s*2px/);
    }
    expect(rule(src, '.cm-composer')).toMatch(/--maude-chrome-font-body/);
  });
});

describe('07 · the timeline clip name', () => {
  test('one centred chip, body face at --type-xs, the current theme ink — not pinned top AND bottom', () => {
    const r = rule(css('client/styles/3-shell-maude.css'), '.tl-seq-block .tl-seq-name');
    expect(r).toMatch(/top:\s*50%/);
    expect(r).toMatch(/bottom:\s*auto/);
    expect(r).toMatch(/color:\s*var\(--fg-0\)/);
    expect(r).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(r).toMatch(/font-size:\s*var\(--type-xs\)/);
    expect(r).not.toMatch(/#fff|rgba\(0, 0, 0/);
  });
});

describe('08 · Layers by artboard', () => {
  const BOARDS = [
    { id: 'a1', label: 'Combine campaign 1', kind: 'digital' },
    { id: 'a2', label: 'Arch 1 · vnějšek', kind: 'print' },
    { id: 'a3', label: 'Reels · nábor', kind: 'video' },
  ];
  function mountLayers(current: string | null, picked: string[] = []) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ArtboardLayers
          boards={BOARDS}
          canvasName="Combine-kampan"
          count={3}
          current={current}
          onPick={(id: string) => picked.push(id)}
        >
          <div role="tree" data-testid="the-tree" />
        </ArtboardLayers>
      );
    });
    return host;
  }

  test('every artboard is a row with its kind; the tree sits under the one you are in', () => {
    const h = mountLayers('a2');
    const rows = [...h.querySelectorAll('[data-testid^="layers-artboard-a"]')];
    expect(rows.map((r) => r.textContent)).toEqual(BOARDS.map((b) => b.label));
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['digital', 'print', 'video']);
    expect(h.querySelector('[aria-current="true"]')?.getAttribute('data-testid')).toBe(
      'layers-artboard-a2'
    );
    // the tree follows the current row, before the next artboard
    expect(rows[1]?.nextElementSibling?.querySelector('[data-testid="the-tree"]')).not.toBeNull();
    expect(h.querySelector('[data-testid="layers-artboard-count"]')?.textContent).toBe(
      '3 artboards'
    );
    expect(h.textContent).not.toMatch(/LAYERS|Alt\+/);
  });

  test('a row selects its artboard', () => {
    const picked: string[] = [];
    const h = mountLayers(null, picked);
    act(() => (h.querySelector('[data-testid="layers-artboard-a3"]') as HTMLElement).click());
    expect(picked).toEqual(['a3']);
    // no current artboard: the tree still shows, after the list
    expect(h.querySelector('.ly2-tree--loose [data-testid="the-tree"]')).not.toBeNull();
  });

  test("currentBoard: the tree's artboard, else the selection's, only when it is on this canvas", () => {
    expect(currentBoard({ boards: BOARDS, treeArtboard: 'a3', selectedArtboard: 'a1' })).toBe('a3');
    expect(currentBoard({ boards: BOARDS, treeArtboard: 'zz', selectedArtboard: 'a1' })).toBe('a1');
    expect(currentBoard({ boards: BOARDS })).toBeNull();
  });

  test('the element rows speak the body face; the type word is not 9 px caps', () => {
    const src = css('client/styles/3-shell-maude.css');
    const layer = src.slice(
      src.indexOf('  .st-layer {'),
      src.indexOf('}', src.indexOf('  .st-layer {'))
    );
    expect(layer).toMatch(/font-family:\s*var\(--font-body\)/);
    const type = src.slice(
      src.indexOf('  .st-layer-type {'),
      src.indexOf('}', src.indexOf('  .st-layer-type {'))
    );
    expect(type).not.toMatch(/9px|uppercase/);
  });
});
