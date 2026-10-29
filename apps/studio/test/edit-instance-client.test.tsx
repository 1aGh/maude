// S2.17 — the canvas side of the instance actions: what a shell message may carry, one edit-op per action,
// Detach sends what the instance RENDERS to (measured here — the studio cannot know a system's markup),
// a refusal is toasted in the studio's words, and one write leaves one undo record on a legacy link.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import {
  INSTANCE_ACTIONS,
  instanceParams,
  isInstanceAction,
  measureInstance,
  runInstanceAction,
} from '../editing/instance-actions.ts';
import type { Selection } from '../use-selection-set.tsx';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const REF: ElementRef = { artboard: 'desktop', element: 'cta' };
const SEL = { id: 'cta', artboardId: 'desktop' } as unknown as Selection;
const OK: EditOpResult = {
  ok: true,
  actionId: null,
  writeId: 'w_0123456789abcdef',
  rev: 'r',
  refs: [REF],
};

function harness(result: EditOpResult = OK) {
  const asks: unknown[] = [];
  const toasts: Array<[string, string | undefined]> = [];
  const records: unknown[] = [];
  return {
    asks,
    toasts,
    records,
    deps: {
      run: async (a: unknown) => {
        asks.push(a);
        return result;
      },
      toast: (m: string, k?: string) => toasts.push([m, k]),
      record: (r: unknown) => records.push(r),
    },
  };
}

function page(html: string) {
  document.body.innerHTML = `<article data-dc-screen="desktop">${html}</article>`;
}

describe('the ids', () => {
  test('the three instance ops and the Content › Text row’s text.set', () => {
    expect(INSTANCE_ACTIONS.sort()).toEqual([
      'component.detach',
      'component.reset',
      'component.swap-variant',
      'text.set',
    ]);
    expect(isInstanceAction('component.detach')).toBe(true);
    expect(isInstanceAction('object.frame')).toBe(false);
  });
});

describe('what a shell message may carry', () => {
  test('a variant (or null), a component, words, the targets — nothing else', () => {
    const { refs, params } = instanceParams({
      targets: [REF, { nope: 1 }],
      variant: null,
      component: 'Chip',
      text: 'Hi',
      tree: { tag: 'script' },
      file: '../../etc',
      props: ['color', 3],
    });
    expect(refs).toEqual([REF]);
    expect(params).toEqual({ variant: null, component: 'Chip', text: 'Hi', props: ['color'] });
    expect(instanceParams({ variant: 3 }).params).toEqual({});
    expect(instanceParams({ text: 'x'.repeat(2001) }).params).toEqual({});
  });
});

describe('measuring what an instance renders to', () => {
  test('tags, classes, style and words — not what the canvas itself adds', () => {
    page(
      '<button data-cd-id="cta" class="btn btn--primary" style="background:var(--accent)" data-dc-component="x" data-ds-rev="head" data-cd-hover="1" contenteditable="true" onclick="x()">Book <b>now</b></button>'
    );
    const t = measureInstance(document.querySelector('button') as Element);
    expect(t.tag).toBe('button');
    expect(Object.keys(t.attrs).sort()).toEqual(['class', 'data-cd-id', 'onclick', 'style']);
    expect(t.attrs.style).toBe('background:var(--accent)');
    expect(t.kids[0]).toBe('Book ');
    expect(t.kids[1]).toMatchObject({ tag: 'b', kids: ['now'] });
  });
});

describe('one action, one edit-op', () => {
  test('swap and reset ask with the target and the params, one ask each, no canvas record', async () => {
    page('<button data-cd-id="cta">Go</button>');
    const h = harness();
    await runInstanceAction(
      'component.swap-variant',
      [SEL],
      undefined,
      { variant: 'outline' },
      h.deps
    );
    expect(h.asks).toEqual([
      { op: 'component.swap-variant', targets: [REF], params: { variant: 'outline' } },
    ]);
    // p8-v1-drop: no canvas undo record — the write is a kernel action and ⌘Z is the shell history
    expect(h.records).toHaveLength(0);
    await runInstanceAction('component.reset', [SEL], undefined, {}, h.deps);
    expect(h.asks[1]).toEqual({ op: 'component.reset', targets: [REF] });
    expect(h.asks).toHaveLength(2);
    expect(h.records).toHaveLength(0);
  });

  test('Detach sends the measured subtree and how many nodes carry the id', async () => {
    page(
      '<button data-cd-id="cta" class="btn">Go</button><button data-cd-id="cta" class="btn">Go</button>'
    );
    const h = harness();
    await runInstanceAction('component.detach', [SEL], undefined, {}, h.deps);
    const ask = h.asks[0] as { op: string; params: { tree: { tag: string }; rendered: number } };
    expect(ask.op).toBe('component.detach');
    expect(ask.params.tree.tag).toBe('button');
    expect(ask.params.rendered).toBe(2);
  });

  test('a refusal is toasted as an error in the studio’s words; nothing is recorded', async () => {
    page('<button data-cd-id="cta">Go</button>');
    const h = harness({
      ok: false,
      code: 'invalid',
      message: 'This one repeats; change it where it is written.',
    });
    const r = await runInstanceAction('component.reset', [SEL], undefined, {}, h.deps);
    expect(r?.ok).toBe(false);
    expect(h.toasts).toEqual([['This one repeats; change it where it is written.', 'error']]);
    expect(h.records).toHaveLength(0);
  });

  test('nothing selected, or several: a line, no ask', async () => {
    page('<button data-cd-id="cta">Go</button>');
    const h = harness();
    expect(await runInstanceAction('component.reset', [], undefined, {}, h.deps)).toBeNull();
    expect(
      await runInstanceAction(
        'component.reset',
        [SEL, { ...SEL, id: 'b' } as Selection],
        undefined,
        {},
        h.deps
      )
    ).toBeNull();
    expect(h.asks).toHaveLength(0);
    expect(h.toasts.map(([m]) => m)).toEqual(['Select an instance first.', 'Select one instance.']);
  });
});
