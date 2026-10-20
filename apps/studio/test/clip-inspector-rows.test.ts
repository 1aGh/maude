// S7.10 — the inspector of a clip you select on the Timeline (07 · ve-select, ve-transition, ve-text): the rows a clip and
// a title show in the 07 canvas's words, what each one writes, and where every control of the v1 ClipInspector dialog
// went (D15). Real markup, real registry; the Timeline's pipe (`onVerb` / `onOp`) is a recorder.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('.css')) return new Response(':root{--bg-1:#fff}', { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

let restoreSlots: (() => void) | null = null;
const seated: Array<() => void> = [];
afterAll(async () => {
  for (const off of seated.splice(0)) off();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};
const click = async (el: Element | null, what = 'element') => {
  await act(async () => {
    must(el, what).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const rowsOf = (host: HTMLElement, section: string) =>
  [...(q(host, `insp-sec-${section}`)?.querySelectorAll('[data-testid^="insp-row-"]') ?? [])].map(
    (r) =>
      `${(r.getAttribute('data-testid') ?? '').replace('insp-row-', '')} = ${r.querySelector('.insp-row-k')?.textContent}`
  );

type Call = unknown[];
const calls: Call[] = [];

const CLIP_SEQ = {
  from: 0,
  duration: 75,
  label: 'Video',
  series: true,
  mediaTag: 'Video',
  mediaSrc: 'assets/dron-sweep-lajny-8s.mp4',
  mediaProps: {
    playbackRate: 1,
    volume: 0.7,
    muted: false,
    trimBefore: 60,
    filter: null,
    framing: null,
  },
  placeholder: null,
  text: null,
  titleMotion: null,
  fit: null,
  rowKind: 'video',
};
const TITLE_SEQ = {
  from: 20,
  duration: 66,
  label: 'Title',
  series: false,
  mediaTag: null,
  mediaSrc: null,
  mediaProps: null,
  placeholder: null,
  text: 'PROČ ALLIGATORS',
  titleMotion: { preset: 'slide-up', frames: null },
  fit: null,
  rowKind: 'jsx',
};
const selection = (kind: 'clip' | 'title', seq: Record<string, unknown>, extra = {}) => ({
  kind,
  canvas: '.design/ui/Reel.tsx',
  artboardId: 'reel',
  fps: 30,
  stableId: kind === 'clip' ? 'name:dron' : 'name:title',
  label: kind === 'clip' ? 'Dron nad lajnou' : 'PROČ ALLIGATORS',
  seq,
  transitionAfter: null,
  onVerb: (...a: unknown[]) => calls.push(['verb', ...a]),
  onOp: (...a: unknown[]) => calls.push(['op', ...a]),
  onJoin: (...a: unknown[]) => calls.push(['join', ...a]),
  onRemoveJoin: (...a: unknown[]) => calls.push(['removeJoin', ...a]),
  deselect: () => {},
  ...extra,
});

async function seat() {
  if (seated.length) return;
  const clip = await import('../client/v2/inspector/kinds/clip.jsx');
  const { stashSlots } = await import('../client/v2/inspector/slots.js');
  restoreSlots = stashSlots();
  seated.push(clip.registerClipSlots());
}

async function frame(sel: Record<string, unknown>) {
  await seat();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const { timelineSelectionElement } = await import('../client/v2/timeline/selection.js');
  calls.length = 0;
  return mount(
    h(InspectorFrame, {
      selected: timelineSelectionElement(sel as never),
      layersTree: null,
      cfg: { designRel: '.design' },
      canvasFile: '.design/ui/Reel.tsx',
      onOptimistic: () => {},
      onRecordEdit: () => {},
      onReplaceMedia: () => {},
      onUndoRedo: () => {},
    } as never)
  );
}
const openAdvanced = async (host: HTMLElement) => {
  const toggle = q(host, 'fold-inspector-toggle');
  if (toggle?.getAttribute('aria-expanded') !== 'true') await click(toggle, 'the Advanced fold');
};

describe('a clip (07 ve-transition: Length · Speed · Volume · Framing)', () => {
  test('the chip says Clip, then the four rows in the canvas’s order, in the canvas’s words', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    expect(q(host, 'inspector-kind')?.textContent).toBe('Clip');
    expect(q(host, 'inspector-title')?.textContent).toBe('Dron nad lajnou');
    expect(rowsOf(host, 'clip')).toEqual([
      'clip-length = Length',
      'clip-speed = Speed',
      'clip-volume = Volume',
      'clip-framing = Framing',
    ]);
    const len = q(host, 'insp-clip-length')?.querySelector('input') as HTMLInputElement;
    expect(len.value).toBe('2.5 s');
    expect((q(host, 'insp-clip-speed') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      '1×'
    );
    expect(
      (q(host, 'insp-clip-framing') as HTMLSelectElement).selectedOptions[0]?.textContent
    ).toBe('All formats');
  });

  test('a picture has no Volume and no sound to detach; an audio clip has no Framing', async () => {
    const img = await frame(
      selection('clip', {
        ...CLIP_SEQ,
        mediaTag: 'Img',
        rowKind: 'image',
        mediaSrc: 'assets/a.png',
      })
    );
    expect(rowsOf(img, 'clip')).toEqual([
      'clip-length = Length',
      'clip-speed = Speed',
      'clip-framing = Framing',
    ]);
    const aud = await frame(
      selection('clip', {
        ...CLIP_SEQ,
        mediaTag: 'Audio',
        rowKind: 'audio',
        mediaSrc: 'assets/a.mp3',
      })
    );
    expect(rowsOf(aud, 'clip')).toEqual([
      'clip-length = Length',
      'clip-speed = Speed',
      'clip-volume = Volume',
    ]);
  });

  test('Speed is one clip.speed; a rate that is not a preset shows as its own option', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    await pick(q(host, 'insp-clip-speed'), '2');
    expect(calls).toEqual([['verb', 'speed', { rate: 2 }]]);
    const odd = await frame(
      selection('clip', { ...CLIP_SEQ, mediaProps: { ...CLIP_SEQ.mediaProps, playbackRate: 1.25 } })
    );
    const sel = q(odd, 'insp-clip-speed') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      '0.25×',
      '0.5×',
      '1×',
      '1.25×',
      '1.5×',
      '2×',
      '4×',
    ]);
    expect(sel.selectedOptions[0]?.textContent).toBe('1.25×');
  });

  test('Framing writes video.fit (Fill is the default and reads "All formats")', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    await pick(q(host, 'insp-clip-framing'), 'blur');
    expect(calls).toEqual([['op', 'fit', { fit: 'blur' }]]);
    const lit = await frame(selection('clip', { ...CLIP_SEQ, fit: 'fit' }));
    expect((q(lit, 'insp-clip-framing') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      'Fit'
    );
  });

  test('Length types a fixed number and trims the END: clip.retime with whole frames', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    const input = q(host, 'insp-clip-length')?.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.value = '1,5';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      input.blur();
    });
    await settle();
    expect(calls).toEqual([['verb', 'retime', { durationInFrames: 45 }]]);
  });

  test('a muted clip shows Volume 0', async () => {
    const host = await frame(
      selection('clip', { ...CLIP_SEQ, mediaProps: { ...CLIP_SEQ.mediaProps, muted: true } })
    );
    const field = q(host, 'insp-clip-volume')?.querySelector(
      'input[type="number"], input:not([type="range"])'
    ) as HTMLInputElement;
    expect(field.value).toBe('0');
  });
});

describe('Advanced (src · in · out, then the v1 dialog’s Audio · Crop · Grade · Transition)', () => {
  test('src · in · out say where in the file the clip plays', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    await openAdvanced(host);
    expect(q(host, 'insp-adv-clip-src')?.textContent).toContain('dron-sweep-lajny-8s.mp4');
    expect(q(host, 'insp-adv-clip-in')?.textContent).toContain('0:02.0');
    expect(q(host, 'insp-adv-clip-out')?.textContent).toContain('0:04.5');
  });

  test('Audio: Muted and Detach audio (timeline-detach-audio) are one verb each', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    await openAdvanced(host);
    await click(q(host, 'timeline-detach-audio'));
    expect(calls).toEqual([['verb', 'detach-audio', {}]]);
    const mute = q(host, 'insp-adv-audio')?.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    await click(mute);
    expect(calls[1]).toEqual(['verb', 'audio', { muted: true }]);
  });

  test('Grade: a look is one clip.grade; None writes no grade; a hand-written filter is read-only', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    await openAdvanced(host);
    await click(q(host, 'timeline-grade-warm'));
    expect(calls).toEqual([
      ['verb', 'grade', { grade: { hue: -12, saturation: 1.15, brightness: 1.03 } }],
    ]);
    await click(q(host, 'timeline-grade-none'));
    expect(calls[1]).toEqual(['verb', 'grade', { grade: null }]);
    const hand = await frame(
      selection('clip', {
        ...CLIP_SEQ,
        mediaProps: { ...CLIP_SEQ.mediaProps, filter: 'blur(4px)' },
      })
    );
    await openAdvanced(hand);
    expect(q(hand, 'timeline-grade-readonly')?.textContent).toContain('hand-written filter');
    expect(q(hand, 'timeline-grade-warm')).toBeNull();
  });

  test('Crop: scale, x, y and Reset write clip.framing; the neutral frame writes none', async () => {
    const host = await frame(selection('clip', CLIP_SEQ));
    await openAdvanced(host);
    const crop = q(host, 'insp-adv-crop') as HTMLElement;
    const chip = [...crop.querySelectorAll('button')].find((b) => b.textContent === '1.5×');
    await click(chip ?? null, '1.5×');
    expect(calls).toEqual([['verb', 'framing', { framing: { scale: 1.5, x: 0, y: 0 } }]]);
    const reset = [...crop.querySelectorAll('button')].find((b) => b.textContent === 'Reset');
    await click(reset ?? null, 'Reset');
    expect(calls[1]).toEqual(['verb', 'framing', { framing: null }]);
  });

  test('Transition frames: the join after the clip — its frames, and the hard cut', async () => {
    const j = { k: 0, stableId: 'tr:0', dur: 15, presentation: 'fade' };
    const host = await frame(selection('clip', CLIP_SEQ, { transitionAfter: j }));
    await openAdvanced(host);
    await click(q(host, 'timeline-transition-remove'));
    expect(calls).toEqual([['removeJoin', j]]);
    const none = await frame(selection('clip', CLIP_SEQ));
    await openAdvanced(none);
    expect(q(none, 'insp-adv-transition')).toBeNull();
  });

  test('a picture has no Audio, Crop or Grade of a video’s kind to show beyond its own file', async () => {
    const host = await frame(
      selection('clip', {
        ...CLIP_SEQ,
        mediaTag: 'Audio',
        rowKind: 'audio',
        mediaSrc: 'assets/a.mp3',
      })
    );
    await openAdvanced(host);
    expect(q(host, 'insp-adv-crop')).toBeNull();
    expect(q(host, 'insp-adv-grade')).toBeNull();
    expect(q(host, 'insp-adv-audio')).not.toBeNull();
  });
});

describe('a title (07 ve-text: Text · Motion · Length)', () => {
  test('the chip says Title; Text starts from the words, Motion lights the one it has', async () => {
    const host = await frame(selection('title', TITLE_SEQ));
    expect(q(host, 'inspector-kind')?.textContent).toBe('Title');
    expect(rowsOf(host, 'title-motion')).toEqual([
      'clip-text = Text',
      'title-motion = Motion',
      'clip-length = Length',
    ]);
    expect((q(host, 'timeline-inspector-text') as HTMLTextAreaElement).value).toBe(
      'PROČ ALLIGATORS'
    );
    const grid = q(host, 'insp-title-motion') as HTMLElement;
    expect([...grid.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'None',
      'Fade',
      'Slide up',
      'Pop',
      'Type on',
      'Per word',
    ]);
    expect(grid.querySelector('[data-on]')?.textContent).toBe('Slide up');
  });

  test('a tile is one video.title.motion; the one it already has writes nothing', async () => {
    const host = await frame(selection('title', TITLE_SEQ));
    await click(q(host, 'insp-title-motion-pop'));
    expect(calls).toEqual([['op', 'title.motion', { preset: 'pop' }]]);
    await click(q(host, 'insp-title-motion-slide-up'));
    expect(calls).toHaveLength(1);
    await click(q(host, 'insp-title-motion-none'));
    expect(calls[1]).toEqual(['op', 'title.motion', { preset: 'none' }]);
  });

  test('Apply text is clip.set-text with what is in the field (the v1 Text tab’s two testids)', async () => {
    const host = await frame(selection('title', TITLE_SEQ));
    const ta = q(host, 'timeline-inspector-text') as HTMLTextAreaElement;
    await act(async () => {
      ta.value = 'Nábor 2027';
    });
    await click(q(host, 'timeline-inspector-text-apply'));
    expect(calls).toEqual([['verb', 'set-text', { text: 'Nábor 2027' }]]);
    ta.value = '   ';
    await click(q(host, 'timeline-inspector-text-apply'));
    expect(calls).toHaveLength(1); // blank words are never written
  });

  test('Advanced: enter · easing, and the Speed the v1 dialog gave a title', async () => {
    const host = await frame(selection('title', TITLE_SEQ));
    await openAdvanced(host);
    expect(q(host, 'insp-adv-title-enter')?.textContent).toContain('slide-up 12f');
    await pick(q(host, 'insp-clip-speed'), '0.5');
    expect(calls).toEqual([['verb', 'speed', { rate: 0.5 }]]);
  });

  test('an AI slate keeps its Prompt (the v1 Text tab for a placeholder)', async () => {
    const host = await frame(
      selection('clip', {
        ...CLIP_SEQ,
        mediaTag: null,
        mediaSrc: null,
        mediaProps: null,
        rowKind: 'placeholder',
        placeholder: { prompt: 'a drone over a field', kind: 'veo' },
      })
    );
    expect(rowsOf(host, 'clip')).toContain('clip-text = Prompt');
    expect((q(host, 'timeline-inspector-text') as HTMLTextAreaElement).value).toBe(
      'a drone over a field'
    );
  });
});

describe('D15: where the dialog’s controls went', () => {
  test('every tab of the v1 ClipInspector has a home, and the dialog file is gone', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(existsSync(join(import.meta.dir, '../client/panels/ClipInspector.jsx'))).toBe(false);
    const clip = await frame(
      selection('clip', CLIP_SEQ, {
        transitionAfter: { k: 0, stableId: 'tr:0', dur: 15, presentation: 'fade' },
      })
    );
    await openAdvanced(clip);
    const homes = [
      'insp-clip-speed', // Speed
      'insp-clip-volume', // Audio › Volume
      'insp-adv-audio', // Audio › Muted
      'timeline-detach-audio', // Audio › Detach audio
      'insp-adv-crop', // Crop
      'insp-adv-grade', // Grade
      'timeline-grade-punch', // Grade › the looks
      'insp-adv-transition', // Transition › Frames
      'timeline-transition-remove', // Transition › Remove transition (hard cut)
      'timeline-inspector', // the inspector itself
    ];
    for (const id of homes) expect({ id, found: !!q(clip, id) }).toEqual({ id, found: true });
    const title = await frame(selection('title', TITLE_SEQ));
    for (const id of [
      'timeline-inspector-text',
      'timeline-inspector-text-apply',
      'timeline-inspector',
    ])
      expect({ id, found: !!q(title, id) }).toEqual({ id, found: true });
  });
});
