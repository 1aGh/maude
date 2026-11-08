// #113 slice B — contract 113-checklist §5.4 / §5.6: the rows a checklist sticky draws. One `role="group"`
// labelled by the title; each row `role="checkbox"` with `aria-checked` and the entry (or "Empty item") as its
// name; one tab stop per list (roving tabIndex); every row ≥ 24 px tall (WCAG 2.5.8 — the row is the target);
// the done ink meets 4.5:1 on every sticky paper; a polite live line after the person's own tick. Not
// interactive (Edit, Present, Can view / Can comment): drawn, inert, no tab stop, no "+ Add an item".

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  type ChecklistApi,
  ChecklistChip,
  ChecklistContext,
  ChecklistRows,
  doneInk,
} from '../annotations/ui/checklist.tsx';
import { contrast, quietPaper } from '../annotations/ui/posture.ts';
import { STICKY_PALETTE } from '../annotations-model.ts';

const items: AnnotationElement[] = [
  { id: 'c1', type: 'checkitem', index: 'a0', list: 's1', text: 'Write the post' },
  {
    id: 'c2',
    type: 'checkitem',
    index: 'a1',
    list: 's1',
    text: 'Record the demo',
    done: { by: 'AI', at: '2026-11-08T10:12:00Z' },
  },
  { id: 'c3', type: 'checkitem', index: 'a2', list: 's1' },
] as AnnotationElement[];

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function mount(interactive: boolean, over: Partial<ChecklistApi> = {}) {
  const calls: string[] = [];
  const api: ChecklistApi = {
    byList: new Map([['s1', items]]),
    interactive,
    editing: null,
    focusRequest: null,
    announce: null,
    toggle: (id) => calls.push(`toggle:${id}`),
    startEdit: (id) => calls.push(`edit:${id}`),
    commitText: (id, t) => calls.push(`text:${id}:${t}`),
    addAtEnd: (l) => calls.push(`add:${l}`),
    focused: (id) => calls.push(`focus:${id}`),
    ...over,
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <ChecklistContext.Provider value={api}>
        <ChecklistRows listId="s1" title="Launch" paper="#fce8a6" fontSize={14} />
        <ChecklistChip listId="s1" paper="#fce8a6" />
      </ChecklistContext.Provider>
    );
  });
  return { calls, el: host };
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role="checkbox"]')];

describe('roles and names', () => {
  test('a group named by the title; a checkbox per entry with aria-checked and its words', () => {
    const { el } = mount(true);
    const group = el.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Launch');
    const r = rows(el);
    expect(r.map((x) => x.getAttribute('aria-label'))).toEqual([
      'Write the post',
      'Record the demo',
      'Empty item',
    ]);
    expect(r.map((x) => x.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    // the AI's tick wears the spark
    expect(r[1]?.getAttribute('data-by')).toBe('ai');
    // the testids are an API (TESTIDS.md)
    expect(r.map((x) => x.getAttribute('data-testid'))).toEqual([
      'checklist-row-c1',
      'checklist-row-c2',
      'checklist-row-c3',
    ]);
    expect(el.querySelector('[data-testid="checklist-add"]')).not.toBeNull();
  });

  test('one tab stop per list (roving tabIndex); the box is SVG, never a glyph', () => {
    const { el } = mount(true);
    const tabs = rows(el).map((x) => x.tabIndex);
    expect(tabs.filter((t) => t === 0)).toHaveLength(1);
    expect(tabs.filter((t) => t === -1)).toHaveLength(2);
    for (const r of rows(el)) expect(r.querySelector('svg')).not.toBeNull();
    expect(el.textContent).not.toContain('☐');
  });

  test('every row is at least 24 px tall — the row is the target', () => {
    const { el } = mount(true);
    for (const r of rows(el))
      expect(Number.parseFloat(r.style.minHeight)).toBeGreaterThanOrEqual(24);
    const add = el.querySelector<HTMLElement>('[data-testid="checklist-add"]');
    expect(Number.parseFloat(add?.style.minHeight ?? '0')).toBeGreaterThanOrEqual(24);
  });

  test('the progress chip reads 1/3 and says "1 of 3 done" politely after the person’s tick', () => {
    const { el } = mount(true, { announce: { list: 's1', text: '1 of 3 done' } });
    const chip = el.querySelector('[data-testid="checklist-progress-s1"]');
    expect(chip?.textContent).toContain('1/3');
    const live = chip?.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('1 of 3 done');
  });
});

describe('gestures', () => {
  test('a click on the box ticks; a click on the words opens the entry', () => {
    const { el, calls } = mount(true);
    const r = rows(el);
    act(() => ((r[0] as HTMLElement).querySelector('[data-an-check-box]') as HTMLElement).click());
    act(() => ((r[2] as HTMLElement).querySelector('[data-an-check-text]') as HTMLElement).click());
    act(() => (el.querySelector('[data-testid="checklist-add"]') as HTMLElement).click());
    expect(calls).toEqual(['toggle:c1', 'edit:c3', 'add:s1']);
  });

  test('an open entry is a labelled field', () => {
    const { el } = mount(true, { editing: { id: 'c1', caret: 0 } });
    const input = el.querySelector<HTMLInputElement>('input[data-an-check-input]');
    expect(input?.value).toBe('Write the post');
    expect(input?.getAttribute('aria-label')).toBe('Edit item “Write the post”');
  });
});

describe('not interactive (Edit, Present, Can view / Can comment)', () => {
  test('drawn, inert: no tab stop, no add row, no click, not the checklist’s keys', () => {
    const { el, calls } = mount(false);
    const r = rows(el);
    expect(r).toHaveLength(3);
    for (const x of r) {
      expect(x.hasAttribute('tabindex')).toBe(false);
      expect(x.getAttribute('aria-disabled')).toBe('true');
    }
    expect(el.querySelector('[data-testid="checklist-add"]')).toBeNull();
    expect(el.querySelector('[data-an-checklist]')).toBeNull();
    act(() => ((r[0] as HTMLElement).querySelector('[data-an-check-box]') as HTMLElement).click());
    expect(calls).toEqual([]);
  });
});

describe('contrast', () => {
  test('the done ink meets 4.5:1 on every sticky paper, and on its quiet (Edit) form', () => {
    for (const paper of STICKY_PALETTE) {
      expect(contrast(doneInk(paper), paper)).toBeGreaterThanOrEqual(4.5);
      const q = quietPaper(paper);
      expect(contrast(doneInk(q), q)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the done ink is quieter than the object ink (it reads as done)', () => {
    expect(doneInk('#fce8a6')).not.toBe('#2a2a28');
  });
});
