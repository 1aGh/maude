// r4 #3 — dragging a number in the Inspector must not select text in the page.
// The scrub used to switch selection off only after the 3px dead-zone, by which time the browser had begun a
// selection from the pointerdown. Now the pointerdown itself switches it off and a selectstart is refused until
// the gesture ends (release, Esc, cancel).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const down = (handle: HTMLElement) =>
  ({
    button: 0,
    clientX: 100,
    pointerId: 1,
    currentTarget: handle,
    preventDefault() {},
  }) as unknown as PointerEvent;

const selectstart = (): Event => {
  const ev = new Event('selectstart', { bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  return ev;
};

describe('scrub drag does not select text', () => {
  test('selectstart is refused from pointerdown to release, and body user-select is off', async () => {
    const { makeScrubHandler } = await import('../client/inspector-controls.jsx');
    const handle = document.createElement('span');
    document.body.append(handle);
    const start = makeScrubHandler({ getBase: () => '10', onInput() {}, onCommit() {} });

    expect(selectstart().defaultPrevented).toBe(false);
    start(down(handle));
    // before any movement: a click that might become a drag already holds the selection off
    expect(selectstart().defaultPrevented).toBe(true);
    expect(document.body.classList.contains('insp-scrub-armed')).toBe(true);

    document.dispatchEvent(new Event('pointermove'));
    document.dispatchEvent(new Event('pointerup'));
    expect(selectstart().defaultPrevented).toBe(false);
    expect(document.body.classList.contains('insp-scrub-armed')).toBe(false);
  });

  test('Esc and pointercancel give the selection back too', async () => {
    const { makeScrubHandler } = await import('../client/inspector-controls.jsx');
    const handle = document.createElement('span');
    document.body.append(handle);
    const start = makeScrubHandler({
      getBase: () => '10',
      onInput() {},
      onCommit() {},
      onCancel() {},
    });
    start(down(handle));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(selectstart().defaultPrevented).toBe(false);
    expect(document.body.classList.contains('insp-scrub-armed')).toBe(false);

    start(down(handle));
    document.dispatchEvent(new Event('pointercancel'));
    expect(selectstart().defaultPrevented).toBe(false);
    expect(document.body.classList.contains('insp-scrub-armed')).toBe(false);
  });

  test('a tap (no drag) still reaches onTap so the field can take focus', async () => {
    const { makeScrubHandler } = await import('../client/inspector-controls.jsx');
    const handle = document.createElement('span');
    document.body.append(handle);
    let tapped = 0;
    const start = makeScrubHandler({
      getBase: () => '10',
      onInput() {},
      onCommit() {},
      onTap: () => tapped++,
    });
    start(down(handle));
    document.dispatchEvent(new Event('pointerup'));
    expect(tapped).toBe(1);
    expect(selectstart().defaultPrevented).toBe(false);
  });
});
