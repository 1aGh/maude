// P8 C5 (05 es-canvas-ai, es-offline-uncached): the empty block sits in the middle of the FREE canvas — what
// the panels leave — not the middle of the window. The shell already measures what its islands cover (the
// occluded insets); the block reads the same measure.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freeCentre } from '../client/v2/empty/free-centre.js';
import { insetsNow, setShellInsets } from '../client/v2/shell/insets-now.js';

const read = (p: string) => readFileSync(join(import.meta.dir, '..', p), 'utf8');

describe('freeCentre', () => {
  test('no insets: the window centre', () => {
    expect(freeCentre({ top: 0, right: 0, bottom: 0, left: 0 }, 1440, 900)).toBe(720);
  });

  test('a left panel moves it right, a right panel moves it left', () => {
    // 05 es-canvas-ai: the left panel is ~290 wide, the block sits at ~0.59 of the window
    expect(freeCentre({ top: 0, right: 0, bottom: 0, left: 290 }, 1440, 900)).toBe(865);
    expect(freeCentre({ top: 0, right: 300, bottom: 0, left: 0 }, 1440, 900)).toBe(570);
    expect(freeCentre({ top: 0, right: 300, bottom: 0, left: 290 }, 1440, 900)).toBe(715);
  });

  test('a canvas squeezed under the measure keeps the window centre (the same rule the camera uses)', () => {
    expect(freeCentre({ top: 0, right: 700, bottom: 0, left: 700 }, 1440, 900)).toBe(720);
  });
});

describe('the shell publishes the insets it sends', () => {
  test('insetsNow follows setShellInsets and tells its subscribers', () => {
    const seen: number[] = [];
    const off = insetsNow.subscribe(() => seen.push(insetsNow.get().left));
    setShellInsets({ top: 0, right: 0, bottom: 0, left: 288 });
    setShellInsets({ top: 0, right: 0, bottom: 0, left: 288 }); // same value: nobody is woken
    setShellInsets({ top: 0, right: 0, bottom: 0, left: 0 });
    off();
    expect(seen).toEqual([288, 0]);
  });
});

describe('the block uses it', () => {
  test('the host hands the centre to the block; the block places itself on it', () => {
    expect(read('client/v2/empty/empty-host.jsx')).toContain('--es-cx');
    const css = read('client/v2/empty/empty.css');
    const ec = /\.es-ec \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(ec).toContain('left: var(--es-cx, 50%)');
  });

  test('the pump that measures the islands publishes what it sends', () => {
    expect(read('client/v2/shell/use-occluded-insets.js')).toContain('setShellInsets(');
  });
});

// 05 es-all-trashed: the card was built (S11.5) and never mounted; the empty-canvas host mounts it and holds
// "Your canvas is ready." back until the Trash has answered.
describe('every artboard in the Trash', () => {
  const host = read('client/v2/empty/empty-host.jsx');
  test('the host mounts the card for an empty canvas and the plain block steps aside for it', () => {
    expect(host).toContain('<AllTrashed');
    expect(host).toContain('artboardCount={count}');
    expect(host).toContain('onShown={onTrashShown}');
    expect(host).toMatch(/drawEmpty = !!model && \(!trashWatch \|\| trashShown === false\)/);
  });

  test('the answer is kept with its canvas (a switch never reads the last canvas’s answer)', () => {
    expect(host).toMatch(/setTrashAnswer\(\{ path: activePath, shown \}\)/);
    expect(host).toContain('trashAnswer.path === activePath');
  });
});

// 05 es-project-new: the prompt is the board's 520 px box — it was a ~140 px pill (`width: min(520px, 100%)`
// of a shrink-to-fit parent) with the placeholder clipped to "A one-page portfolio wi", and the send read grey
// until a word was typed (the board draws it azure).
describe('the empty-project prompt keeps its width and its azure send', () => {
  const css = read('client/v2/create/empty-project.css');
  const rule = (sel: string) => {
    const at = css.indexOf(`\n  ${sel} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  test('a definite 520 px, held to its container', () => {
    const ask = rule('.ep-ask');
    expect(ask).toMatch(/\bwidth:\s*520px/);
    expect(ask).toMatch(/max-width:\s*100%/);
    expect(ask).not.toContain('min(520px');
  });

  test('the send is azure even before a word is typed', () => {
    const idle = rule('.ep-ask-send[data-idle]');
    expect(idle).not.toContain('--bg-3');
    expect(idle).not.toContain('--fg-3');
  });
});
