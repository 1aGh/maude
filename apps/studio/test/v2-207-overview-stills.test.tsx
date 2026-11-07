// 2.0.7 — the predicates the stills share (decision v2-michal-207-overview-still-during-gesture, its behaviour
// superseded by the overview level — test/v2-207-overview-level.test.tsx pins the controller now):
//   - the cut is one constant, and the entry test is "narrower than it on screen";
//   - pinned / video / no still never stand in;
//   - on in the studio on WebKit only, never in a capture, the frame parameter wins;
//   - a picture's src retry is not a paint change (it redrew stills forever), its load is.
import { describe, expect, test } from 'bun:test';
import {
  isPaintMutation,
  resolveStillMode,
  STILL_MAX_SCREEN_PX,
  stillEligible,
} from '../artboard-still.ts';

describe('which artboard may stand in as its still', () => {
  test('the threshold is one constant: narrower than it on screen, pinned and video never, no still never', () => {
    expect(STILL_MAX_SCREEN_PX).toBeGreaterThanOrEqual(120);
    const base = { pinned: false, eager: false, hasStill: true };
    // 1600 px at 10 % = 160 px on screen
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1 })).toBe(true);
    expect(stillEligible({ ...base, width: STILL_MAX_SCREEN_PX, zoom: 1 })).toBe(false);
    expect(stillEligible({ ...base, width: STILL_MAX_SCREEN_PX - 1, zoom: 1 })).toBe(true);
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1, pinned: true })).toBe(false);
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1, eager: true })).toBe(false);
    expect(stillEligible({ ...base, width: 1600, zoom: 0.1, hasStill: false })).toBe(false);
    // once standing in, it stays a still until the settle however far the zoom goes
    expect(stillEligible({ ...base, width: 1600, zoom: 2, showing: true })).toBe(true);
  });

  test('on in the studio on WebKit only; never in a capture; the frame parameter wins', () => {
    expect(resolveStillMode({ search: '', webkit: true, liveMode: 'sleep' })).toBe('on');
    expect(resolveStillMode({ search: '', webkit: false, liveMode: 'sleep' })).toBe('off');
    expect(resolveStillMode({ search: '?artboard-still=on', webkit: true, liveMode: 'off' })).toBe(
      'off'
    );
    expect(
      resolveStillMode({ search: '?artboard-still=on', webkit: false, liveMode: 'sleep' })
    ).toBe('on');
    expect(
      resolveStillMode({ search: '?artboard-still=off', webkit: true, liveMode: 'sleep' })
    ).toBe('off');
  });

  test("a picture's src retry is not a paint change; anything else is", () => {
    const img = { tagName: 'IMG' } as unknown as Node;
    const div = { tagName: 'DIV' } as unknown as Node;
    expect(isPaintMutation({ type: 'attributes', attributeName: 'src', target: img })).toBe(false);
    expect(isPaintMutation({ type: 'attributes', attributeName: 'class', target: img })).toBe(true);
    expect(isPaintMutation({ type: 'attributes', attributeName: 'src', target: div })).toBe(true);
    expect(isPaintMutation({ type: 'childList', attributeName: null, target: div })).toBe(true);
  });
});
