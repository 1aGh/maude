// annotations-v2 (DDR-242 AD8, Task 21) — the one pointer pipeline: explicit
// stage priority, one owner per gesture, the tool state machine's node.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { type Gesture, PointerPipeline } from '../annotations/ui/pointer-pipeline.ts';

function fire(target: EventTarget, type: string, init: Partial<PointerEventInit> = {}) {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

function setup() {
  const p = new PointerPipeline();
  const detach = p.attach(document);
  const log: string[] = [];
  const states: string[] = [];
  p.onState = (s) => states.push(s);
  return { p, detach, log, states };
}

describe('stage order and ownership', () => {
  test('the lowest priority claiming stage wins, whatever order stages registered in', () => {
    const { p, detach, log } = setup();
    p.add({
      priority: 100,
      name: 'select',
      down: () => (log.push('select'), { kind: 'dragging' }),
    });
    p.add({
      priority: 3,
      name: 'group-resize',
      down: () => (log.push('group'), { kind: 'resizing' }),
    });
    fire(document.body, 'pointerdown');
    expect(log).toEqual(['group']);
    expect(p.state).toBe('resizing');
    expect(p.lastClaim).toEqual({ stage: 'group-resize', claim: 'gesture', kind: 'resizing' });
    fire(document.body, 'pointerup');
    detach();
  });

  test('ce641b18 class: a press on chrome passes to the chrome — the select stage never sees it', () => {
    const { p, detach, log } = setup();
    const handle = document.createElement('div');
    handle.className = 'dc-annot-resize-handle';
    document.body.append(handle);
    p.add({
      priority: 5,
      name: 'chrome',
      down: (e) => ((e.target as Element).closest('.dc-annot-resize-handle') ? 'pass' : undefined),
    });
    p.add({
      priority: 100,
      name: 'select',
      down: () => (log.push('select-marquee'), { kind: 'marquee' }),
    });
    fire(handle, 'pointerdown');
    expect(log).toEqual([]);
    expect(p.state).toBe('idle');
    expect(p.lastClaim).toEqual({ stage: 'chrome', claim: 'pass' });
    // …and a press on empty canvas still reaches the select stage.
    fire(document.body, 'pointerdown');
    expect(log).toEqual(['select-marquee']);
    fire(document.body, 'pointerup');
    handle.remove();
    detach();
  });

  test('only the owning gesture sees moves and the release, for its own pointer only', () => {
    const { p, detach, log, states } = setup();
    const g: Gesture = {
      kind: 'dragging',
      move: (e) => log.push(`move:${e.pointerId}`),
      up: () => log.push('up'),
    };
    p.add({ priority: 100, name: 'select', down: () => g });
    fire(document.body, 'pointerdown');
    fire(document.body, 'pointermove', { pointerId: 1 });
    fire(document.body, 'pointermove', { pointerId: 2 }); // another pointer
    fire(document.body, 'pointerup', { pointerId: 2 });
    fire(document.body, 'pointerup', { pointerId: 1 });
    fire(document.body, 'pointermove', { pointerId: 1 }); // after the release
    expect(log).toEqual(['move:1', 'up']);
    expect(states).toEqual(['dragging', 'idle']);
    detach();
  });

  test('a new press before the release cancels the running gesture (no stuck drag)', () => {
    const { p, detach, log } = setup();
    p.add({
      priority: 100,
      name: 'select',
      down: () => ({ kind: 'dragging', cancel: () => log.push('cancelled') }),
    });
    fire(document.body, 'pointerdown');
    fire(document.body, 'pointerdown');
    expect(log).toEqual(['cancelled']);
    expect(p.state).toBe('dragging');
    detach();
  });

  test('a gesture begun by chrome (a resize handle) is routed like any other', () => {
    const { p, detach, log } = setup();
    p.add({ priority: 5, name: 'chrome', down: () => 'pass' });
    fire(document.body, 'pointerdown');
    p.begin(1, { kind: 'resizing', move: () => log.push('m'), up: () => log.push('u') });
    fire(document.body, 'pointermove');
    fire(document.body, 'pointerup');
    expect(log).toEqual(['m', 'u']);
    expect(p.state).toBe('idle');
    detach();
  });

  test('unregistering a stage (tool change) takes it out; detach removes every listener', () => {
    const { p, detach, log } = setup();
    const off = p.add({ priority: 100, name: 'select', down: () => (log.push('x'), undefined) });
    off();
    fire(document.body, 'pointerdown');
    expect(log).toEqual([]);
    p.add({ priority: 100, name: 'select', down: () => (log.push('y'), undefined) });
    detach();
    fire(document.body, 'pointerdown');
    expect(log).toEqual([]);
  });
});
