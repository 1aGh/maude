// S10.10 (13 · ds-edit-master) — the Components section of the Design system canvas: every master across its
// variants × states × sizes, the states held with `.ds-force-<state>` copies of the system's own rules, a waiting
// edit shown "as edited" through the board-scoped <style> — and nothing hostile reaching that <style>.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildBoardModel } from '../ds/board/build-model.ts';
import { lookOf, stateRulesOf, statesOf } from '../ds/board/component-states.ts';
import { DSSection } from '../ds/board/index.tsx';
import { __resetBoardState } from '../ds/board/state.ts';
import { boardComponentsCss } from '../ds/board/types.ts';
import { systemConfigsFrom } from '../ds/system.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
beforeEach(() => __resetBoardState());

const TOKENS = `:root,
.acme[data-theme="light"],
.ds[data-theme="light"] {
  --bg-0: #ffffff;
  --bg-4: #e4e4e4;
  --fg-0: #111111;
  --fg-3: #888888;
  --accent: #2f6bff;
}
.acme[data-theme="dark"],
.ds[data-theme="dark"] {
  --bg-0: #111111;
  --bg-4: #333333;
  --fg-0: #eeeeee;
  --fg-3: #888888;
  --accent: #6b95ff;
}
`;

const COMPONENTS_CSS = `.btn {
  height: 32px;
  border-radius: 4px;
  background: var(--bg-3, #eee);
  color: var(--fg-0);
}
.btn:hover { background: var(--bg-4); }
.btn:active { transform: scale(0.97); }
.btn:focus-visible { outline: 2px solid var(--accent); }
.btn[disabled] { color: var(--fg-3); cursor: not-allowed; }
.btn--primary { background: var(--accent); color: white; }
.btn--primary:hover { background: var(--accent); filter: brightness(1.1); }
.btn--sm { height: 24px; }
@media (min-width: 900px) {
  .btn:hover { background: red; }
}
.card:hover { box-shadow: 0 0 0 1px; }
`;

const COMPONENTS_JSON = {
  components: {
    Button: {
      class: 'btn',
      label: 'Tlačítko',
      variants: { primary: 'btn--primary', ghost: null },
      sizes: { sm: 'btn--sm' },
    },
    Card: { class: 'card', label: 'Card' },
  },
};

function model(pending?: object) {
  const root = mkdtempSync(path.join(tmpdir(), 'ds-master-'));
  roots.push(root);
  const dsPath = 'system/acme';
  mkdirSync(path.join(root, dsPath, 'preview'), { recursive: true });
  const config = {
    designSystems: [
      { name: 'acme', path: dsPath, themes: ['light', 'dark'], themeDefault: 'light', rootClass: 'acme' },
    ],
    defaultDesignSystem: 'acme',
  };
  writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  writeFileSync(path.join(root, dsPath, 'colors_and_type.css'), TOKENS);
  writeFileSync(path.join(root, dsPath, 'preview', '_components.css'), COMPONENTS_CSS);
  writeFileSync(path.join(root, dsPath, 'components.json'), JSON.stringify(COMPONENTS_JSON));
  if (pending)
    writeFileSync(
      path.join(root, dsPath, 'design-system.meta.json'),
      JSON.stringify({ dsPending: pending })
    );
  return buildBoardModel(root, systemConfigsFrom(config)[0]);
}

const html = (m: ReturnType<typeof model>) =>
  renderToStaticMarkup(<DSSection kind="components" model={m} mode="light" />);

describe('component-states (pure)', () => {
  test('the states a system styles for a master, in board order, top-level rules only', () => {
    const rules = stateRulesOf(COMPONENTS_CSS, ['btn', 'btn--primary', 'btn--sm']);
    expect(statesOf(rules)).toEqual(['hover', 'active', 'focus', 'disabled']);
    // the @media copy of `.btn:hover` and the other component's `.card:hover` are not the master's
    expect(rules.filter((r) => r.state === 'hover').map((r) => r.selector)).toEqual([
      '.btn.ds-force-hover',
      '.btn--primary.ds-force-hover',
    ]);
    expect(rules.find((r) => r.state === 'disabled')).toMatchObject({
      selector: '.btn.ds-force-disabled',
      decls: [
        ['color', 'var(--fg-3)'],
        ['cursor', 'not-allowed'],
      ],
    });
  });

  test('a master’s own look is the last value in its exact rule', () => {
    expect(lookOf(COMPONENTS_CSS, 'btn')).toEqual({
      height: '32px',
      'border-radius': '4px',
      background: 'var(--bg-3, #eee)',
      color: 'var(--fg-0)',
    });
    expect(lookOf(COMPONENTS_CSS, 'nope')).toEqual({});
    expect(lookOf(null, 'btn')).toEqual({});
  });

  test('a value that could end its declaration never becomes a state rule', () => {
    const css = '.btn:hover { background: red; } .btn:active { background: url(x.png); content: "a}b"; color: blue; }';
    const rules = stateRulesOf(css, ['btn']);
    expect(rules.flatMap((r) => r.decls)).toEqual([
      ['background', 'red'],
      ['color', 'blue'],
    ]);
  });
});

describe('the model', () => {
  test('a master carries its states, look and waiting edits; the file’s rules are inlined once', () => {
    const m = model({
      components: { Button: { '.btn': { 'border-radius': { value: '6px', by: { kind: 'person' } } } } },
    });
    const b = m.components.find((c) => c.name === 'Button');
    expect(b?.states).toEqual(['hover', 'active', 'focus', 'disabled']);
    expect(b?.look['border-radius']).toBe('4px');
    expect(b?.patches).toEqual([{ selector: '.btn', prop: 'border-radius', value: '6px' }]);
    expect(b?.pending).toBe(true);
    // Card has a hover rule too
    expect(m.components.find((c) => c.name === 'Card')?.states).toEqual(['hover']);
    expect(m.stateRules.length).toBeGreaterThan(0);
  });

  test('a waiting edit written by a person or an agent is re-checked: only plain declarations survive', () => {
    const m = model({
      components: {
        Button: {
          '.btn': {
            height: { value: '40px' },
            'border-radius': { value: '6px; } body { display: none' },
            background: { value: 'url(https://evil.example/x.png)' },
            'Bad Prop': { value: '1px' },
          },
          '.btn{}body{x:y': { color: { value: 'red' } },
          '@import "x"': { color: { value: 'red' } },
        },
      },
    });
    expect(m.components.find((c) => c.name === 'Button')?.patches).toEqual([
      { selector: '.btn', prop: 'height', value: '40px' },
    ]);
  });
});

describe('the section', () => {
  test('a tile draws variants, states and sizes with the system’s own classes', () => {
    const out = html(model());
    expect(out).toContain('data-ds-master="Button"');
    expect(out).toContain('data-ds-label="Tlačítko"');
    expect(out).toContain('class="ds-m-sample btn btn--primary"');
    for (const s of ['hover', 'active', 'focus', 'disabled'])
      expect(out).toContain(`class="ds-m-sample btn ds-force-${s}" data-ds-axis="state" data-ds-state="${s}"`);
    expect(out).toContain('class="ds-m-sample btn btn--sm"');
    expect(out).toContain('2 variants · 4 states · 1 size');
  });

  test('the board <style> holds the state rules and the waiting edit, scoped, the edit last', () => {
    const m = model({ components: { Button: { '.btn': { 'border-radius': { value: '6px' } } } } });
    const css = boardComponentsCss(m);
    const scope = '.ds-board[data-ds-board="acme"]';
    expect(css).toContain(`${scope} .btn.ds-force-hover{background:var(--bg-4)}`);
    expect(css).toContain(`${scope} .btn.ds-force-disabled{color:var(--fg-3);cursor:not-allowed}`);
    expect(css.endsWith(`${scope} .btn{border-radius:6px}`)).toBe(true);
    // and it is the section's own <style> in the markup, flagged as holding a waiting change
    const out = html(m);
    expect(out).toContain('data-ds-pending=""');
    expect(out).toContain('.btn.ds-force-hover');
  });

  test('a model that was tampered with after it was built still draws nothing hostile', () => {
    const m = model();
    m.components[0].patches = [
      { selector: '.btn', prop: 'color', value: 'red' },
      { selector: '.btn}body{', prop: 'color', value: 'red' },
      { selector: '.btn', prop: 'color', value: 'red;}x{' },
      { selector: '.btn', prop: 'Color', value: 'red' },
    ];
    m.stateRules.push({
      selector: '.x}y{,.btn.ds-force-hover',
      state: 'hover',
      decls: [
        ['color', 'blue'],
        ['background', 'url(x)'],
      ],
    });
    const css = boardComponentsCss(m);
    expect(css).not.toContain('body');
    expect(css).not.toContain('url(');
    expect(css).not.toContain('}x{');
    expect(css).toContain('.btn.ds-force-hover{color:blue}');
    expect(css).toContain('.btn{color:red}');
  });
});
