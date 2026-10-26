// S7.11 — the Transcript panel (07 · ve-captions): what it shows, how a selection becomes ⌫ / a typed fix, and
// the three quiet states (no engine, no words, read-only). Real markup; the handlers are recorders.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { buildTranscriptModel } from '../client/v2/transcript/transcript-model.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const SRC = 'assets/7c40e2b1.mp4';
const WORDS = [
  { id: 'w0', t0: 3.0, t1: 3.4, text: 'Přišel' },
  { id: 'w1', t0: 3.4, t1: 3.7, text: 'jsem', p: 0.3 },
  { id: 'w2', t0: 3.7, t1: 4.9, text: 'zkušenosti.' },
  { id: 'w3', t0: 4.95, t1: 5.35, text: 'Ehm…' },
  { id: 'w4', t0: 5.4, t1: 5.8, text: 'Za' },
  { id: 'w5', t0: 8.4, t1: 8.9, text: 'Dneska', flags: ['loop'] },
];
const clip = (stableId: string, trimBefore: number, from: number, d: number) => ({
  stableId,
  track: 'video',
  src: SRC,
  from,
  durationInFrames: d,
  trimBefore,
  playbackRate: 1,
  muted: false,
});
const shown = (id: string, f0: number, f1: number, text: string, c: string, extra = {}) => ({
  src: SRC,
  wordId: id,
  clip: c,
  f0,
  f1,
  text,
  ...extra,
});
const media = (over: Record<string, unknown> = {}) => ({
  fps: 30,
  clips: [clip('name:a', 90, 0, 57), clip('name:b', 162, 57, 12), clip('name:c', 252, 69, 15)],
  words: [
    shown('w0', 0, 12, 'Přišel', 'name:a'),
    shown('w1', 12, 21, 'jsem', 'name:a', { p: 0.3 }),
    shown('w2', 21, 57, 'zkušenosti.', 'name:a'),
    shown('w4', 57, 69, 'Za', 'name:b'),
  ],
  speech: [],
  beats: [],
  unresolved: [],
  transcripts: { [SRC]: { words: WORDS } },
  captions: {
    words: 'line',
    position: 'bottom',
    font: null,
    highlight: null,
    maxChars: null,
    fixes: [],
  },
  ...over,
});

interface Rec {
  cuts: number;
  fixes: Array<[string, string]>;
  finds: number;
  setups: number;
  closes: number;
}

async function mountPanel(
  m: unknown,
  opts: { canEdit?: boolean; ui?: Record<string, unknown>; frame?: number } = {}
) {
  const { TranscriptPanel } = await import('../client/v2/transcript/TranscriptPanel.jsx');
  const rec: Rec = { cuts: 0, fixes: [], finds: 0, setups: 0, closes: 0 };
  const model = buildTranscriptModel(m, { nameOf: () => 'Rozhovor · Kilián' });
  function Wrap() {
    const [sel, setSel] = useState<{ selection: string[]; anchor: string | null }>({
      selection: [],
      anchor: null,
    });
    return h(TranscriptPanel, {
      model,
      ui: { working: null, noEngine: false, notice: null, tip: null, ...sel, ...opts.ui },
      frame: opts.frame ?? -1,
      canEdit: opts.canEdit ?? true,
      onSelect: (selection: string[], anchor: string | null) => setSel({ selection, anchor }),
      onCut: () => {
        rec.cuts += 1;
      },
      onFix: (item: { wordId: string }, text: string) => {
        rec.fixes.push([item.wordId, text]);
      },
      onFindSpeech: () => {
        rec.finds += 1;
      },
      onSetUp: () => {
        rec.setups += 1;
      },
      onClose: () => {
        rec.closes += 1;
      },
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(h(Wrap)));
  return { host, rec };
}

const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const word = (host: HTMLElement, id: string) => {
  const el = q(host, `transcript-word-${id}`);
  if (!el) throw new Error(`no word ${id}`);
  return el;
};
const mouse = (type: string, init: Record<string, unknown> = {}) =>
  new window.MouseEvent(type, { bubbles: true, button: 0, ...init });
const down = (el: Element, init = {}) =>
  act(async () => void el.dispatchEvent(mouse('mousedown', init)));
const key = (el: Element, k: string, init: Record<string, unknown> = {}) =>
  act(
    async () =>
      void el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
  );

describe('what the panel shows', () => {
  test('the source, the words, a time on each paragraph, and the one-line help', async () => {
    const { host } = await mountPanel(media());
    expect(q(host, 'transcript-source')?.textContent).toBe('Rozhovor · Kilián');
    const paras = [...host.querySelectorAll('[data-testid="transcript-paragraph"]')].map(
      (p) => p.textContent
    );
    expect(paras[0]).toBe('0:00Přišel jsem zkušenosti. Ehm… Za');
    expect(q(host, 'transcript-foot')?.textContent).toBe(
      'Select words and press delete to cut them. Fix a misheard word by typing over it.'
    );
  });

  test('a cut word is struck, p < 0.5 is marked, a repetition says it may be noise', async () => {
    const { host } = await mountPanel(media());
    expect(word(host, 'w3').getAttribute('data-state')).toBe('struck');
    expect(word(host, 'w1').getAttribute('data-low')).toBe('true');
    expect(word(host, 'w1').title).toBe('Not sure about this word — check it.');
    expect(word(host, 'w5').getAttribute('data-state')).toBe('noise');
    expect(word(host, 'w5').title).toBe('May be noise, not speech');
  });

  test('the word being said lights up as it plays', async () => {
    const { host } = await mountPanel(media(), { frame: 15 });
    expect(word(host, 'w1').getAttribute('data-playing')).toBe('true');
    expect(word(host, 'w0').getAttribute('data-playing')).toBeNull();
  });
});

describe('select, cut, fix', () => {
  test('a click selects a word, shift-click extends to a range', async () => {
    const { host } = await mountPanel(media());
    await down(word(host, 'w0'));
    expect(word(host, 'w0').getAttribute('data-selected')).toBe('true');
    await down(word(host, 'w2'), { shiftKey: true });
    expect(['w0', 'w1', 'w2'].map((id) => word(host, id).getAttribute('data-selected'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    expect(word(host, 'w4').getAttribute('data-selected')).toBeNull();
  });

  test('⌫ with a selection cuts; with none it does nothing', async () => {
    const { host, rec } = await mountPanel(media());
    const panel = q(host, 'transcript-panel') as HTMLElement;
    await key(panel, 'Backspace');
    expect(rec.cuts).toBe(0);
    await down(word(host, 'w3'));
    await key(panel, 'Backspace');
    expect(rec.cuts).toBe(1);
  });

  test('⌫ / ⌦ in the transcript never reach the shell: the selected video artboard is not trashed with the word', async () => {
    // The shell's `object.remove` listens on the window: an ⌫ that bubbled out of the panel also deleted the video
    // artboard the transcript belongs to (V2-8.3 e2e r3 — the cut and an `artboard.trash` left together).
    const { host, rec } = await mountPanel(media());
    const panel = q(host, 'transcript-panel') as HTMLElement;
    const heard: string[] = [];
    const onWin = (e: KeyboardEvent) => heard.push(e.key);
    window.addEventListener('keydown', onWin);
    try {
      await key(panel, 'Backspace'); // nothing selected: nothing is cut, and nothing else runs either
      await down(word(host, 'w3'));
      await key(panel, 'Delete');
    } finally {
      window.removeEventListener('keydown', onWin);
    }
    expect(rec.cuts).toBe(1);
    expect(heard).toEqual([]);
  });

  test('double-click a word, type over it, Enter: that word is fixed; Esc leaves it alone', async () => {
    const { host, rec } = await mountPanel(media());
    await act(async () => void word(host, 'w1').dispatchEvent(mouse('dblclick')));
    const input = q(host, 'transcript-edit') as HTMLInputElement;
    expect(input.value).toBe('jsem');
    await act(async () => {
      input.value = 'jsme';
    });
    await key(input, 'Enter');
    expect(rec.fixes).toEqual([['w1', 'jsme']]);
    expect(q(host, 'transcript-edit')).toBeNull();

    await act(async () => void word(host, 'w0').dispatchEvent(mouse('dblclick')));
    await key(q(host, 'transcript-edit') as HTMLElement, 'Escape');
    expect(rec.fixes).toHaveLength(1);
  });

  test('typing a letter over one selected word starts the fix with that letter', async () => {
    const { host } = await mountPanel(media());
    await down(word(host, 'w4'));
    await key(q(host, 'transcript-panel') as HTMLElement, 'x');
    expect((q(host, 'transcript-edit') as HTMLInputElement).value).toBe('x');
  });

  test('"May be noise, not speech" can be kept: it is a fix that names the word', async () => {
    const { host, rec } = await mountPanel(media());
    await down(word(host, 'w5'));
    expect(q(host, 'transcript-noise')?.textContent).toContain('May be noise, not speech');
    await act(async () => void q(host, 'transcript-keep')?.dispatchEvent(mouse('click')));
    expect(rec.fixes).toEqual([['w5', 'Dneska']]);
  });
});

describe('the quiet states', () => {
  test('no speech engine: the sentence and Set up…', async () => {
    const { host, rec } = await mountPanel(media({ transcripts: {}, words: [] }), {
      ui: { noEngine: true },
    });
    expect(q(host, 'transcript-no-engine')?.textContent).toContain(
      'Captions need speech recognition on this Mac.'
    );
    await act(async () => void q(host, 'transcript-set-up')?.dispatchEvent(mouse('click')));
    expect(rec.setups).toBe(1);
  });

  test('no words yet: Find speech', async () => {
    const { host, rec } = await mountPanel(media({ transcripts: {}, words: [] }));
    expect(q(host, 'transcript-empty')?.textContent).toContain('No words yet.');
    await act(async () => void q(host, 'transcript-find-speech')?.dispatchEvent(mouse('click')));
    expect(rec.finds).toBe(1);
  });

  test('Can view / Can comment read the words but cannot cut, fix or find speech', async () => {
    const { host, rec } = await mountPanel(media(), { canEdit: false });
    await down(word(host, 'w1'));
    await key(q(host, 'transcript-panel') as HTMLElement, 'Backspace');
    expect(rec.cuts).toBe(0);
    await act(async () => void word(host, 'w1').dispatchEvent(mouse('dblclick')));
    expect(q(host, 'transcript-edit')).toBeNull();
    const empty = await mountPanel(media({ transcripts: {}, words: [] }), { canEdit: false });
    expect(q(empty.host, 'transcript-find-speech')).toBeNull();
  });

  test('without captions a fix has no home: the foot says so and double-click does not edit', async () => {
    const { host } = await mountPanel(media({ captions: null }));
    expect(q(host, 'transcript-foot')?.textContent).toContain(
      'Add captions to fix a misheard word.'
    );
    await act(async () => void word(host, 'w1').dispatchEvent(mouse('dblclick')));
    expect(q(host, 'transcript-edit')).toBeNull();
  });

  test('the panel closes with × and with esc when nothing is selected', async () => {
    const { host, rec } = await mountPanel(media());
    await act(async () => void q(host, 'transcript-close')?.dispatchEvent(mouse('click')));
    await key(q(host, 'transcript-panel') as HTMLElement, 'Escape');
    expect(rec.closes).toBe(2);
  });
});
