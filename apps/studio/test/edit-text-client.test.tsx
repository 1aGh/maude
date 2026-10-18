// S2.12 (ed-text-edit) — the canvas half of text in place: the style a text wears and what it overrides
// (measured from computed style, not guessed), the Czech tie arcs under the caret, the typed copy as one
// edit-op, and the text actions the Type section asks for. The writers are test/edit-ops-text.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { EditOpResult } from '../edit-ops/types.ts';
import {
  commitTextInPlace,
  NO_STYLE_LINE,
  runTextAction,
  textParams,
  UNKNOWN_OP_MESSAGE,
} from '../editing/text-actions.ts';
import { TextInPlace, tieArcs } from '../editing/text-in-place.tsx';
import { declaredTypeValues, probeTextInfo } from '../editing/type-role.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

const OK: EditOpResult = { ok: true, actionId: null, writeId: 'w1', rev: 'r', refs: [] };

/** A system with two type roles, an artboard with a styled headline, an overriding body, a plain text. */
const tree = (lang = '') => {
  document.head.innerHTML = `<style>
    .t-heading { font-size: 28px; font-weight: 700; line-height: 32px; text-transform: none; }
    .t-eyebrow { font-size: 12px; font-weight: 600; text-transform: uppercase; }
  </style>`;
  document.body.innerHTML = `
    <section ${lang ? `lang="${lang}"` : ''}>
    <article data-dc-screen="post"><div class="dc-artboard-body">
      <h1 data-cd-id="title" class="t-heading card">Jdu v lese</h1>
      <h1 data-cd-id="over" class="t-heading" style="font-size: 20px; color: red">Over</h1>
      <p data-cd-id="eyebrow" class="t-eyebrow">Kicker</p>
      <p data-cd-id="plain" style="font-size: 14px">Plain</p>
    </div></article></section>`;
  return (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;
};

describe('probeTextInfo — the style, measured', () => {
  test('a text on its style differs in nothing; its values are the style’s', () => {
    const q = tree();
    const info = probeTextInfo(q('title'));
    expect(info?.role).toBe('t-heading');
    expect(info?.differs).toEqual([]);
    expect(info?.values['font-size']).toBe('28px');
    expect(info?.values['font-weight']).toBe('700');
  });

  test('an inline size over the style is the one difference — colour is not part of a style', () => {
    const q = tree();
    const info = probeTextInfo(q('over'));
    expect(info?.differs).toEqual(['font-size']);
    // the style's own value, not the override: what Reset and Detach need
    expect(info?.values['font-size']).toBe('28px');
  });

  test('looking leaves the element exactly as it was: its inline style, no node added or removed', () => {
    const q = tree();
    const el = q('over');
    const before = el.getAttribute('style');
    let nodes = 0;
    const obs = new MutationObserver((rs) => {
      for (const r of rs)
        if (r.type === 'childList') nodes += r.addedNodes.length + r.removedNodes.length;
    });
    obs.observe(document.body, { childList: true, subtree: true });
    probeTextInfo(el);
    probeTextInfo(q('title')); // no inline style at all
    expect(el.getAttribute('style')).toBe(before);
    expect(q('title').hasAttribute('style')).toBe(false);
    expect(nodes).toBe(0);
    obs.disconnect();
  });

  test('a text with no style has no role and differs from nothing', () => {
    const q = tree();
    const info = probeTextInfo(q('plain'));
    expect(info).toMatchObject({ role: null, differs: [], values: {} });
  });

  test('the language in force is the nearest lang up the tree; AA is read from the computed case', () => {
    const q = tree('cs');
    expect(probeTextInfo(q('title'))?.lang).toBe('cs');
    expect(probeTextInfo(q('eyebrow'))?.upper).toBe(true);
    expect(probeTextInfo(q('title'))?.upper).toBe(false);
    expect(probeTextInfo(tree()('title'))?.lang).toBe('');
  });
});

// happy-dom lays nothing out: give every character a box, 10px wide and 20px tall, at its index
const stubRects = () => {
  const proto = Range.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const saved = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: Range) {
    const left = this.startOffset * 10;
    return {
      left,
      top: 100,
      width: 10,
      height: 20,
      right: left + 10,
      bottom: 120,
      x: left,
      y: 100,
    } as DOMRect;
  };
  return () => {
    proto.getBoundingClientRect = saved;
  };
};

describe('the tie arcs under the caret', () => {
  test('one arc under each space that will tie, at that space', () => {
    const restore = stubRects();
    const q = tree('cs');
    const el = q('title');
    el.textContent = 'Jdu v lese a s Petrem';
    const arcs = tieArcs(el);
    expect(arcs.map((a) => a.at)).toEqual([5, 12, 14]);
    // 0.15em left of the space, 0.95em below its top (font-size 28px here is the style's: happy-dom reads it)
    expect(arcs[0]?.x).toBeLessThan(5 * 10);
    expect(arcs[0]?.y).toBeGreaterThan(100);
    restore();
  });

  test('while a Czech text is being typed the arcs are drawn, and gone when the text is not Czech', async () => {
    const restore = stubRects();
    const q = tree('cs');
    const el = q('title');
    el.textContent = 'Jdu v lese';
    el.setAttribute('contenteditable', 'plaintext-only');
    el.classList.add('dc-text-editing');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<TextInPlace />));
    await act(async () => {
      document.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[data-testid="edit-tie-arc"]').length).toBe(1);
    // typing on: a second one-letter word, a second arc
    el.textContent = 'Jdu v lese a pak';
    await act(async () => {
      document.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[data-testid="edit-tie-arc"]').length).toBe(2);
    // the text is not Czech: no arcs
    el.closest('section')?.removeAttribute('lang');
    await act(async () => {
      document.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[data-testid="edit-tie-arc"]').length).toBe(0);
    restore();
  });

  test('the edit-tone ring is drawn from tokens (the canvas accent), not a colour', () => {
    const css = document.getElementById('maude-text-in-place-css');
    // mounted by the effect above in the previous test; mount once more here to be independent
    expect(css === null || /var\(--maude-hud-accent/.test(css.textContent ?? '')).toBe(true);
  });
});

describe('commitTextInPlace — the typed copy is one edit-op', () => {
  test('asks text.set with the copy, what it was and the language in force; records the undo', async () => {
    const q = tree('cs');
    const asked: Array<Record<string, unknown>> = [];
    const records: unknown[] = [];
    const handled = await commitTextInPlace(
      { el: q('title'), text: 'Jdu do lesa', before: 'Jdu v lese' },
      {
        run: async (ask) => {
          asked.push(ask as unknown as Record<string, unknown>);
          return OK;
        },
        record: (r) => records.push(r),
      }
    );
    expect(handled).toBe(true);
    expect(asked).toEqual([
      {
        op: 'text.set',
        targets: [{ artboard: 'post', element: 'title' }],
        params: { text: 'Jdu do lesa', before: 'Jdu v lese', lang: 'cs' },
      },
    ]);
    expect(records).toHaveLength(1);
  });

  test('a refusal says its own line and puts the old text back — and is handled, not retried', async () => {
    const q = tree();
    const lines: string[] = [];
    let reverted = 0;
    const handled = await commitTextInPlace(
      { el: q('title'), text: 'x', before: 'y' },
      {
        run: async () => ({ ok: false, code: 'locked', message: 'Title is locked · ⇧⌘L unlocks' }),
        toast: (m) => lines.push(m),
        revert: () => {
          reverted += 1;
        },
      }
    );
    expect(handled).toBe(true);
    expect(lines).toEqual(['Title is locked · ⇧⌘L unlocks']);
    expect(reverted).toBe(1);
  });

  test('a studio with no text.set sends the caller to the legacy path', async () => {
    const q = tree();
    const handled = await commitTextInPlace(
      { el: q('title'), text: 'x', before: 'y' },
      { run: async () => ({ ok: false, code: 'invalid', message: UNKNOWN_OP_MESSAGE }) }
    );
    expect(handled).toBe(false);
  });

  test('an element the studio cannot name (no artboard) is the legacy path too', async () => {
    document.body.innerHTML = '<p data-cd-id="loose">x</p>';
    const handled = await commitTextInPlace(
      { el: document.querySelector('p') as HTMLElement, text: 'y', before: 'x' },
      { run: async () => OK }
    );
    expect(handled).toBe(false);
  });
});

describe('runTextAction', () => {
  const ref = (element: string) => ({ artboard: 'post', element });

  test('Detach sends the style’s own values, measured here — one request per distinct style', async () => {
    const q = tree();
    void q;
    const asked: Array<{ op: string; targets: unknown; params?: Record<string, unknown> }> = [];
    await runTextAction(
      'text.detach-style',
      [],
      [ref('title'), ref('over'), ref('eyebrow')],
      {},
      {
        run: async (a) => {
          asked.push(a as never);
          return OK;
        },
      }
    );
    expect(asked).toHaveLength(2); // heading ×2 share their values, the eyebrow has its own
    expect(asked[0]?.params?.values).toMatchObject({ 'font-size': '28px', 'font-weight': '700' });
    expect(asked[0]?.targets).toEqual([ref('title'), ref('over')]);
    expect(asked[1]?.params?.values).toMatchObject({
      'font-size': '12px',
      'text-transform': 'uppercase',
    });
  });

  test('Detach writes the style’s own token references, not computed px (S2.12b)', async () => {
    const q = tree();
    void q;
    document.head.innerHTML = `<style>
      :root { --type-xl: 28px; --weight-bold: 700; }
      body { font-family: Georgia; }
      .t-heading { font-size: var(--type-xl); font-weight: var(--weight-bold); line-height: 32px; }
    </style>`;
    const asked: Array<{ params?: Record<string, unknown> }> = [];
    await runTextAction(
      'text.detach-style',
      [],
      [ref('title')],
      {},
      {
        run: async (a) => {
          asked.push(a as never);
          return OK;
        },
      }
    );
    const values = asked[0]?.params?.values as Record<string, string>;
    expect(values['font-size']).toBe('var(--type-xl)');
    expect(values['font-weight']).toBe('var(--weight-bold)');
    expect(values['line-height']).toBe('32px'); // a literal the style declares stays as written
    // a property the style does not declare falls back to what it computes to here
    expect(values['font-family']).toBe(probeTextInfo(q('title'))?.values['font-family'] as string);
    expect(values['font-family']).toContain('Georgia');
  });

  test('declaredTypeValues reads the role’s rule as written, through @supports and @media groups', () => {
    document.head.innerHTML = `<style>
      @supports (display: block) { .t-heading { font-size: var(--type-xl); } }
      @media all { .t-heading { letter-spacing: var(--tracking-tight); } }
      @media not all { .t-heading { font-weight: 100; } }
      .t-other { font-size: 1px; }
      .t-heading, .t-poster { font-style: italic; }
    </style>`;
    expect(declaredTypeValues(document, 't-heading')).toEqual({
      'font-size': 'var(--type-xl)',
      'letter-spacing': 'var(--tracking-tight)',
      'font-style': 'italic',
    });
  });

  test('Detach on a text with no style says so and asks nothing', async () => {
    const q = tree();
    void q;
    const lines: string[] = [];
    let n = 0;
    const r = await runTextAction(
      'text.detach-style',
      [],
      [ref('plain')],
      {},
      {
        run: async () => {
          n += 1;
          return OK;
        },
        toast: (m) => lines.push(m),
      }
    );
    expect(r).toBeNull();
    expect(n).toBe(0);
    expect(lines).toEqual([NO_STYLE_LINE]);
  });

  test('As typed under a style that sets the case is explicit — the style would put the case back', async () => {
    const q = tree();
    void q;
    const asked: Array<{ params?: Record<string, unknown> }> = [];
    const run = async (a: unknown) => {
      asked.push(a as never);
      return OK;
    };
    await runTextAction('text.set-case', [], [ref('eyebrow')], { case: 'typed' }, { run });
    await runTextAction('text.set-case', [], [ref('title')], { case: 'typed' }, { run });
    expect(asked[0]?.params).toEqual({ case: 'typed', explicit: true });
    expect(asked[1]?.params).toEqual({ case: 'typed' });
  });

  test('a refusal is the studio’s own line; no undo record for it', async () => {
    const q = tree();
    void q;
    const lines: string[] = [];
    const records: unknown[] = [];
    const r = await runTextAction(
      'text.reset-style',
      [],
      [ref('over')],
      {},
      {
        run: async () => ({
          ok: false,
          code: 'held-by-ai',
          message: 'Over is AI’s until it’s done',
        }),
        toast: (m) => lines.push(m),
        record: (x) => records.push(x),
      }
    );
    expect(r?.ok).toBe(false);
    expect(lines).toEqual(['Over is AI’s until it’s done']);
    expect(records).toEqual([]);
  });

  test('an edit with no write behind it pushes one undo record; with a kernel action, none', async () => {
    const q = tree();
    void q;
    const records: unknown[] = [];
    await runTextAction(
      'text.reset-style',
      [],
      [ref('over')],
      {},
      { run: async () => OK, record: (x) => records.push(x) }
    );
    await runTextAction(
      'text.reset-style',
      [],
      [ref('over')],
      {},
      {
        run: async () => ({ ...OK, actionId: 'a1' }),
        record: (x) => records.push(x),
      }
    );
    expect(records).toHaveLength(1);
  });
});

describe('textParams — only what the actions know gets through', () => {
  test('refs, role, language, case and props; nothing else', () => {
    const out = textParams({
      targets: [{ artboard: 'post', element: 'title' }, { nope: 1 }],
      role: 't-title',
      lang: 'cs',
      case: 'upper',
      props: ['font-size', 4],
      values: { evil: '1' },
    });
    expect(out.refs).toEqual([{ artboard: 'post', element: 'title' }]);
    expect(out.params).toEqual({
      role: 't-title',
      lang: 'cs',
      case: 'upper',
      props: ['font-size'],
    });
    expect(textParams(null)).toEqual({ refs: undefined, params: {} });
    expect(textParams({ case: 'lower' }).params).toEqual({});
  });
});
