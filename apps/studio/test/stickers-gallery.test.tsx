// S4.3 — the Stickers gallery island rendered: Stamps row, packs in C13 order with "+N", credits, the
// "done" search (chips, "6 of 80", the no-hits line), the "hotovo" empty state, Recent after a pick.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  // `document`, not `window`: a `window` stub another file left must not skip the DOM.
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import StickersGallery from '../client/v2/annotations/stickers-gallery.jsx';

const DIR = join(import.meta.dir, '..', 'stickers');
const PACKS = readdirSync(DIR)
  .sort()
  .map((slug) => {
    const m = JSON.parse(readFileSync(join(DIR, slug, 'manifest.json'), 'utf8'));
    return {
      slug,
      name: m.name,
      author: m.author,
      attributionUrl: m.attributionUrl,
      stickers: m.stickers.map((s: any) => ({ ...s, url: `/_stickers/${slug}/${s.file}` })),
    };
  });

beforeEach(() => {
  (globalThis as any).fetch = async () => ({ json: async () => ({ ok: true, packs: PACKS }) });
  try {
    localStorage.clear();
  } catch {}
});

async function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const picked: any[] = [];
  await act(async () => {
    root.render(
      <StickersGallery onPick={(s: any) => picked.push(s)} onClose={() => {}} {...props} />
    );
  });
  await act(async () => {}); // the fetch resolves
  return {
    host,
    picked,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function type(host: HTMLElement, value: string) {
  const input = host.querySelector('[data-testid="stickers-search"]') as HTMLInputElement;
  // a dispatched `input` event does not reach React's onChange under happy-dom (v2-search-ui.test.tsx
  // hit the same wall): call the handler React attached, with the value set the way a keystroke does
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set?.call(input, value);
    props.onChange({ target: input, currentTarget: input });
  });
}

describe('browse', () => {
  test('Stamps row, packs in C13 order with "+N", credits', async () => {
    const { host, done } = await mount();
    expect(host.querySelectorAll('[data-testid^="stickers-stamp-"]')).toHaveLength(6);
    const packs = [...host.querySelectorAll('[data-testid^="stickers-pack-"]')].map(
      (el) => el.querySelector('strong')?.textContent
    );
    expect(packs).toEqual(['FigJam Doodle', 'Life Style', 'Opposing Thoughts', 'Project status']);
    expect(host.querySelector('[data-testid="stickers-more-project-status"]')?.textContent).toBe(
      '+75'
    );
    expect(host.querySelector('[data-testid="stickers-more-figjam-doodle"]')?.textContent).toBe(
      '+19'
    );
    const credits = host.querySelector('[data-testid="stickers-credits"]')?.textContent ?? '';
    expect(credits).toContain('Packs from the Figma Community:');
    expect(credits).toContain('Project status — Iconfinder');
    expect(host.querySelector('[data-testid="stickers-recent"]')).toBeNull(); // nothing placed yet
    await done();
  });

  test('"+N" opens that pack in place', async () => {
    const { host, done } = await mount();
    const more = host.querySelector('[data-testid="stickers-more-life-style"]') as HTMLElement;
    await act(async () => more.click());
    const pack = host.querySelector('[data-testid="stickers-pack-life-style"]') as HTMLElement;
    expect(pack.querySelectorAll('.st-sp-cell')).toHaveLength(15);
    expect(host.querySelector('[data-testid="stickers-more-life-style"]')).toBeNull();
    await done();
  });

  test('a stamp is inert until S4.13 hands the gallery a placer', async () => {
    const { host, done } = await mount();
    expect(
      (host.querySelector('[data-testid="stickers-stamp-yes"]') as HTMLButtonElement).disabled
    ).toBe(true);
    await done();
    const seen: string[] = [];
    const m = await mount({ onPickStamp: (id: string) => seen.push(id) });
    const yes = m.host.querySelector('[data-testid="stickers-stamp-yes"]') as HTMLButtonElement;
    expect(yes.disabled).toBe(false);
    await act(async () => yes.click());
    expect(seen).toEqual(['yes']);
    await m.done();
  });
});

describe('search', () => {
  test('"done": chips, "6 of 80", and the no-hits line', async () => {
    const { host, done } = await mount();
    await type(host, 'done');
    const chips = [...host.querySelectorAll('[data-testid="stickers-chips"] .chip')].map(
      (c) => c.textContent
    );
    expect(chips[0]).toBe('All · 6');
    expect(chips).toContain('done · 4');
    expect(chips).toContain('almost-done · 2');
    const pack = host.querySelector('[data-testid="stickers-pack-project-status"]') as HTMLElement;
    expect(pack.textContent).toContain('6 of 80');
    expect(host.querySelector('[data-testid="stickers-pack-life-style"]')).toBeNull();
    expect(host.querySelector('[data-testid="stickers-none"]')?.textContent).toBe(
      'No “done” in FigJam Doodle, Life Style or Opposing Thoughts · no stamp either'
    );
    // a chip narrows, and picking it again lifts it
    await act(async () =>
      (host.querySelector('[data-testid="stickers-chip-almost-done"]') as HTMLElement).click()
    );
    expect(pack.textContent).toContain('2 of 80');
    await act(async () =>
      (host.querySelector('[data-testid="stickers-chip-almost-done"]') as HTMLElement).click()
    );
    expect(pack.textContent).toContain('6 of 80');
    await done();
  });

  test('"hotovo": the verbatim empty line with English suggestions that run the search', async () => {
    const { host, done } = await mount();
    await type(host, 'hotovo');
    const nil = host.querySelector('[data-testid="stickers-empty"]') as HTMLElement;
    expect(nil.querySelector('strong')?.textContent).toBe('No stickers match “hotovo”');
    expect(nil.textContent).toContain('Sticker words are English — try');
    const words = [...nil.querySelectorAll('.chip')].map((c) => c.textContent);
    expect(words).toEqual(['done', 'finished', 'approved']);
    await act(async () => (nil.querySelectorAll('.chip')[0] as HTMLElement).click());
    expect((host.querySelector('[data-testid="stickers-search"]') as HTMLInputElement).value).toBe(
      'done'
    );
    expect(host.querySelector('[data-testid="stickers-pack-project-status"]')).not.toBeNull();
    await done();
  });

  test('"+1" finds the stamp, and the stamps are in the result', async () => {
    const { host, done } = await mount();
    await type(host, '+1');
    expect(host.querySelector('[data-testid="stickers-stamp-plus"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="stickers-stamp-yes"]')).toBeNull();
    await done();
  });
});

describe('pick and Recent', () => {
  test('a pick hands the caller pack + id + url and is the first Recent next time', async () => {
    const first = await mount();
    const cell = first.host.querySelector(
      '[data-testid="sticker-project-status-group-51.png"]'
    ) as HTMLElement | null;
    // group-51 is not in the first five of its pack: open the pack, then pick
    await act(async () =>
      (
        first.host.querySelector('[data-testid="stickers-more-project-status"]') as HTMLElement
      ).click()
    );
    const target = (cell ??
      first.host.querySelector(
        '[data-testid="sticker-project-status-group-51.png"]'
      )) as HTMLElement;
    await act(async () => target.click());
    expect(first.picked).toHaveLength(1);
    expect(first.picked[0]).toMatchObject({
      pack: 'project-status',
      id: 'group-51.png',
      file: 'group-51.png',
    });
    expect(first.picked[0].url).toContain('/project-status/group-51.png');
    await first.done();

    const again = await mount();
    const recent = again.host.querySelector('[data-testid="stickers-recent"]') as HTMLElement;
    expect(recent).not.toBeNull();
    expect(recent.querySelectorAll('.st-sp-cell')).toHaveLength(1);
    expect(recent.querySelector('img')?.getAttribute('src')).toContain('group-51.png');
    await again.done();
  });
});
