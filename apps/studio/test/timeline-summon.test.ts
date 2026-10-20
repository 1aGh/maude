// S7.7 — the timeline island's rules (client/v2/timeline/timeline-store.js).
//
// 07 · ve-deselect, "the timeline, in five rules": select a video → it slides out of it, another video takes
// it over and each keeps its playhead; select anything else or esc → it slides back; ⇧⌘T shows / hides it and,
// shown that way, it stays whatever you select; Expand / Compact is a button, not a key.
import { describe, expect, test } from 'bun:test';
import { createTimelineStore } from '../client/v2/timeline/timeline-store.js';

const rect = { x: 400, y: 300, w: 250, h: 444 };
const video = (id: string, label = id) => ({ artboardId: id, kind: 'video', label, rect });
const page = (id: string) => ({ artboardId: id, kind: 'digital', label: id, rect });

describe('summon and follow', () => {
  test('nothing selected: no island', () => {
    const t = createTimelineStore();
    expect(t.get().visible).toBe(false);
    expect(t.get().target).toBeNull();
  });

  test('a video artboard summons it, compact, over that video', () => {
    const t = createTimelineStore();
    t.anchor(video('reels', 'Reels'));
    expect(t.get()).toMatchObject({ visible: true, size: 'compact', kept: false });
    expect(t.get().target?.artboardId).toBe('reels');
    expect(t.get().target?.label).toBe('Reels');
  });

  test('another video takes it over', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.anchor(video('wide'));
    expect(t.get().visible).toBe(true);
    expect(t.get().target?.artboardId).toBe('wide');
  });

  test('anything that is not a video sends it back', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.anchor(page('post'));
    expect(t.get().visible).toBe(false);
    t.anchor(video('reels'));
    t.anchor({ artboardId: null });
    expect(t.get().visible).toBe(false);
  });

  test('a pan or zoom of the same video moves the rect and changes nothing else', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.anchor({ ...video('reels'), rect: { ...rect, x: 90 } });
    expect(t.get().target?.rect.x).toBe(90);
    expect(t.get().visible).toBe(true);
  });

  test('a message with no rect, or a video with no id, is not a summons', () => {
    const t = createTimelineStore();
    t.anchor({ artboardId: 'reels', kind: 'video' });
    t.anchor({ artboardId: '', kind: 'video', rect });
    expect(t.get().visible).toBe(false);
  });
});

describe('esc', () => {
  // esc is the shell's step-back ladder: it ends by clearing the canvas selection, which arrives as a null anchor
  test('esc (selection cleared) slides it back; selecting the video again summons it again', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.anchor({ artboardId: null });
    expect(t.get().visible).toBe(false);
    t.anchor(video('reels'));
    expect(t.get().visible).toBe(true);
  });

  test('esc does not hide a kept-open island', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.toggleKeep();
    t.anchor({ artboardId: null });
    expect(t.get().visible).toBe(true);
  });
});

describe('⇧⌘T keeps it open', () => {
  test('shown that way it stays whatever you select, showing the last video', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.toggleKeep();
    expect(t.get().kept).toBe(true);
    t.anchor(page('post'));
    expect(t.get()).toMatchObject({ visible: true, kept: true });
    expect(t.get().target?.artboardId).toBe('reels');
    t.anchor({ artboardId: null });
    expect(t.get().visible).toBe(true);
  });

  test('pressed with nothing ever selected it opens with no video (the empty state)', () => {
    const t = createTimelineStore();
    t.toggleKeep();
    expect(t.get()).toMatchObject({ visible: true, kept: true, target: null });
  });

  test('pressed again it hides, even over a selected video, until the selection changes', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.toggleKeep();
    t.toggleKeep();
    expect(t.get().visible).toBe(false);
    t.anchor({ ...video('reels'), rect: { ...rect, x: 5 } });
    expect(t.get().visible).toBe(false);
    t.anchor(video('wide'));
    expect(t.get().visible).toBe(true);
    expect(t.get().kept).toBe(false);
  });

  test('a legacy open (the artboard menu) keeps it; a legacy close (the ×) hides and un-keeps', () => {
    const t = createTimelineStore();
    t.open();
    expect(t.get()).toMatchObject({ visible: true, kept: true });
    t.close();
    expect(t.get().visible).toBe(false);
    expect(t.state().keepOpen).toBe(false);
  });
});

describe('size and playheads', () => {
  test('Expand and Compact are the only size controls; the size is the same for every video', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.expand();
    expect(t.get().size).toBe('full');
    t.anchor(video('wide'));
    expect(t.get().size).toBe('full');
    t.compact();
    expect(t.get().size).toBe('compact');
    t.toggleSize();
    expect(t.get().size).toBe('full');
  });

  test('each video keeps its own playhead', () => {
    const t = createTimelineStore();
    t.remember('reels', 120);
    t.remember('wide', 240);
    expect(t.frameFor('reels')).toBe(120);
    expect(t.frameFor('wide')).toBe(240);
    expect(t.frameFor('other')).toBeUndefined();
    t.remember('reels', Number.NaN);
    expect(t.frameFor('reels')).toBe(120);
  });

  test('remembering a playhead is not a view change', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    let calls = 0;
    t.subscribe(() => calls++);
    const before = t.get();
    t.remember('reels', 7);
    expect(calls).toBe(0);
    expect(t.get()).toBe(before);
  });

  test('switching canvas forgets the videos and playheads, keeps keep-open and size', () => {
    const t = createTimelineStore();
    t.anchor(video('reels'));
    t.toggleKeep();
    t.expand();
    t.remember('reels', 9);
    t.reset();
    expect(t.get()).toMatchObject({ visible: true, kept: true, size: 'full', target: null });
    expect(t.frameFor('reels')).toBeUndefined();
  });
});
