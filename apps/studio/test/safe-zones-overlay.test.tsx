// S7.22 — the safe-zone overlay as the canvas draws it (08 ak-safe-zones): hatched, labelled bands from the
// `safeZones` prop; hidden by the person's own "Show on canvas"; an amber "Under the caption" flag on text that
// lands in a band. It rides the guides overlay mount (`.dc-artboard-guides`), the one every exporter hides.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArtboardGuidesOverlay } from '../artboard-guides-overlay.tsx';

const RECT = { x: 100, y: 200, w: 1080, h: 1920 };

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const draw = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    <ArtboardGuidesOverlay rect={RECT} kind="digital" visibility={{}} {...props} />
  );

describe('safeZones prop → bands', () => {
  test("Reels draws top, bottom and right bands with the canvas's tags, inside the guides mount", () => {
    const html = draw({ safeZones: 'instagram-reels', artboardId: 'story' });
    expect(html).toContain('class="dc-artboard-guides"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('pointer-events:none');
    expect(html).toContain('data-testid="safe-zones"');
    expect(html).toContain('data-preset="instagram-reels"');
    expect(html.match(/data-testid="safe-zone-band"/g)?.length).toBe(3);
    for (const word of ['Profile and progress bar', 'Caption and audio', 'Buttons'])
      expect(html).toContain(word);
  });

  test('story has two bands; the grid has the cut-off sides and a dashed frame, no bands', () => {
    expect(
      draw({ safeZones: 'instagram-story' }).match(/data-testid="safe-zone-band"/g)?.length
    ).toBe(2);
    const grid = renderToStaticMarkup(
      <ArtboardGuidesOverlay
        rect={{ x: 0, y: 0, w: 1080, h: 1080 }}
        kind="digital"
        visibility={{}}
        safeZones="instagram-grid"
      />
    );
    expect(grid).not.toContain('safe-zone-band');
    expect(grid.match(/data-testid="safe-zone-cut"/g)?.length).toBe(2);
    expect(grid).toContain('dashed');
    expect(grid).toContain('Cut off in the grid');
  });

  test('it works on any kind, not only a fixed-size artboard', () => {
    for (const kind of ['digital', 'video', 'web', 'print'] as const)
      expect(draw({ kind, safeZones: 'tiktok' })).toContain('data-testid="safe-zones"');
  });

  test('no prop, "None", or an id this build does not know draws nothing (and no empty box)', () => {
    expect(draw({})).toBe('');
    expect(draw({ safeZones: '' })).toBe('');
    expect(draw({ safeZones: 'snapchat' })).toBe('');
    expect(draw({ safeZones: '<script>' })).toBe('');
  });

  test('"Show on canvas" off hides it for this person; absence of the key means shown', () => {
    expect(draw({ safeZones: 'tiktok', visibility: { safeZones: false } })).toBe('');
    expect(draw({ safeZones: 'tiktok', visibility: { safeZones: true } })).toContain('safe-zones');
    expect(draw({ safeZones: 'tiktok', visibility: {} })).toContain('safe-zones');
  });

  test('the generic guides and a safe zone live side by side in the one mount', () => {
    const html = draw({
      safeZones: 'instagram-story',
      guides: { grid: { size: 40 } },
      visibility: { guides: true },
    });
    expect(html.match(/class="dc-artboard-guides"/g)?.length).toBe(1);
    expect(html).toContain('safe-zones');
  });
});

describe('the flag on text under a band', () => {
  /** An artboard article with a body and two lines of text; layout is stubbed (happy-dom has none). */
  function mountArtboard() {
    const article = document.createElement('article');
    article.setAttribute('data-dc-screen', 'story');
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    const open = document.createElement('p');
    open.textContent = 'Sobota 19:00';
    const tickets = document.createElement('p');
    tickets.textContent = 'Vstupenky na webu';
    body.append(open, tickets);
    article.append(body);
    document.body.append(article);
    const rect = (x: number, y: number, w: number, h: number) =>
      ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y }) as DOMRect;
    body.getBoundingClientRect = () => rect(0, 0, 1080, 1920);
    open.getBoundingClientRect = () => rect(80, 900, 600, 80);
    tickets.getBoundingClientRect = () => rect(80, 1650, 500, 60);
    return article;
  }

  test('the line sitting under the caption is flagged "Under the caption"; the open one is not', async () => {
    const article = mountArtboard();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ArtboardGuidesOverlay
          rect={RECT}
          kind="digital"
          visibility={{}}
          safeZones="instagram-reels"
          artboardId="story"
        />
      );
    });
    // the measuring pass runs on the next frame
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const flags = [...host.querySelectorAll('[data-testid="safe-zone-flag"]')];
    expect(flags.map((f) => f.textContent)).toEqual(['Under the caption']);
    expect(flags[0]?.getAttribute('data-edge')).toBe('bottom');
    await act(async () => root.unmount());
    article.remove();
    host.remove();
  });

  test('with "Show on canvas" off there are no bands and no flags', async () => {
    const article = mountArtboard();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ArtboardGuidesOverlay
          rect={RECT}
          kind="digital"
          visibility={{ safeZones: false }}
          safeZones="instagram-reels"
          artboardId="story"
        />
      );
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(host.innerHTML).toBe('');
    await act(async () => root.unmount());
    article.remove();
    host.remove();
  });
});

describe('DCArtboard carries the prop', () => {
  test('it stamps data-dc-safe-zones for the inspector to read back; absent without the prop', async () => {
    const { DCArtboard } = await import('../canvas-lib.tsx');
    const html = (props: Record<string, unknown>) =>
      renderToStaticMarkup(
        <DCArtboard id="story" label="Story" width={270} height={480} fixed {...props}>
          <p>x</p>
        </DCArtboard>
      );
    expect(html({ safeZones: 'instagram-reels' })).toContain(
      'data-dc-safe-zones="instagram-reels"'
    );
    expect(html({})).not.toContain('data-dc-safe-zones');
    expect(html({ safeZones: '' })).not.toContain('data-dc-safe-zones');
  });
});
