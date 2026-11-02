// P8 bug sweep B2 — ⌫ with a clip selected on the timeline removed the clip AND went on to delete the video
// artboard the timeline hangs from (that artboard is the selection too). On a canvas with one artboard the
// second half was refused with "A canvas keeps at least one artboard" over the clip's own removal.
import { describe, expect, test } from 'bun:test';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';

const press = (key: string) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  preventDefault() {},
});

describe('object.remove (⌫) in the shell', () => {
  const mk = (clip: string | null) => {
    const calls: string[] = [];
    const d = {
      activePath: 'ui/Video.tsx',
      selected: [{ artboardId: 'reel' }],
      deleteArtboardShell: (id: string) => calls.push(`artboard:${id}`),
      tlKeyRef: {
        current: {
          selected: clip,
          removeClip: (r: { stableId: string }) => calls.push(`clip:${r.stableId}`),
        },
      },
    };
    return { calls, d };
  };
  const timeline = { focus: 'timeline', facts: new Set<string>() };
  const chrome = { focus: 'chrome', facts: new Set<string>() };

  test('a clip selected on the timeline: the clip goes, the artboard stays', () => {
    const { calls, d } = mk('beat-two');
    SHELL_KEY_HANDLERS['object.remove'](d, { event: press('Backspace'), ctx: timeline });
    expect(calls).toEqual(['clip:beat-two']);
  });

  test('no clip selected: ⌫ still deletes the one selected artboard', () => {
    const { calls, d } = mk(null);
    SHELL_KEY_HANDLERS['object.remove'](d, { event: press('Backspace'), ctx: chrome });
    expect(calls).toEqual(['artboard:reel']);
  });
});
