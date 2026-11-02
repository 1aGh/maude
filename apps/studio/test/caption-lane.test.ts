// S7.11 — the captions on the Text track (07 · ve-text): one chip per word where the clip shows it, the word being
// said lit, a click selects it for the inspector, a double-click opens the Transcript panel, and the island's
// "Captions from speech" tool. Real markup; the shell door is the fake of test/_captions-harness.ts.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { A, FILE, install, source, video, WORDS } from './_captions-harness.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
let off = () => {};
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  off();
});

const CAPTIONS = '    <Captions data-cd-id="captions" words="line" position="bottom" />';
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null, type = 'click') =>
  act(async () => void el?.dispatchEvent(new window.MouseEvent(type, { bubbles: true })));

async function lane(opts: { captions?: string; frame?: number } = {}) {
  const v = video({ transcripts: { [A]: { words: WORDS } } });
  v.source = source(opts.captions ?? CAPTIONS);
  off = install(v);
  const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
  await compMediaStore.load(FILE, 'reel');
  const { CaptionLane } = await import('../client/v2/timeline/lanes/caption-lane.jsx');
  const seeks: number[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      h(CaptionLane, {
        canvas: FILE,
        artboardId: 'reel',
        fps: 30,
        frame: opts.frame ?? -1,
        x: (f: number) => f * 4,
        axisPx: 600,
        onSeek: (f: number) => seeks.push(f),
      })
    )
  );
  await settle();
  return { host, v, seeks };
}

describe('the caption lane', () => {
  test('a chip per word at the frames the clip shows it, and the word being said is lit', async () => {
    const { host } = await lane({ frame: 20 });
    expect(q(host, 'timeline-captions-lane')).not.toBeNull();
    const w0 = q(host, 'timeline-caption-w0') as HTMLElement;
    expect([w0.textContent, w0.style.left, w0.style.width]).toEqual(['Přišel', '24px', '91px']);
    expect(q(host, 'timeline-caption-w0')?.getAttribute('data-hl')).toBe('true');
    expect(q(host, 'timeline-caption-w1')?.getAttribute('data-hl')).toBeNull();
  });

  test('no <Captions> in the file: the lane is not drawn (the words alone are not captions)', async () => {
    const { host } = await lane({ captions: '' });
    expect(q(host, 'timeline-captions-lane')).toBeNull();
  });

  test('a click selects the word for the inspector and moves the playhead to it', async () => {
    const { host, seeks } = await lane();
    const { timelineSelection } = await import('../client/v2/timeline/selection.js');
    await click(q(host, 'timeline-caption-w1'));
    const sel = timelineSelection.get();
    expect(sel?.kind).toBe('caption');
    expect(sel?.label).toBe('Captions');
    expect(sel?.seq.captions?.position).toBe('bottom');
    expect(sel?.wordKey).toBe(`${A}|w1|name:a`);
    expect(q(host, 'timeline-caption-w1')?.getAttribute('data-sel')).toBe('true');
    expect(seeks).toEqual([30]);
    timelineSelection.set(null);
  });

  test('a double-click opens the Transcript panel on that word', async () => {
    const { host } = await lane();
    const { transcriptUi } = await import('../client/v2/transcript/captions-api.js');
    await click(q(host, 'timeline-caption-w2'), 'dblclick');
    expect(transcriptUi.get().open).toBe(true);
    expect(transcriptUi.get().selection).toEqual([`${A}|w2|name:a`]);
  });
});

describe('the Captions from speech tool', () => {
  test('one button on the island runs video.captions.add', async () => {
    const v = video();
    off = install(v);
    const { CaptionsTool } = await import('../client/v2/timeline/lanes/caption-lane.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(h(CaptionsTool)));
    const btn = q(host, 'timeline-captions-tool') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBe('Captions from speech');
    await click(btn);
    await settle();
    expect(v.calls.map((c) => c.verb)).toEqual(['video.captions.add']);
    expect(v.toasts[0]?.text).toBe('Captions added — 3 words from the interview.');
  });
});
