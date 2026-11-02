// V2-8.5 round 7 (c7-edit3) — 14 · ed-edge-paste: a picture pasted from Figma opens on its Image card
// (From Figma · W · H · Fit), not on the Photo card a placed photo opens on (12 · ia-photo-inspector).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());

describe('what a pasted picture is called', () => {
  test('its crumb reads the Figma frame name, not "Photo"', async () => {
    const { crumbNodeOf } = await import('../editing/selection.tsx');
    const { crumbLabel } = await import('../editing/crumbs.ts');
    document.body.innerHTML =
      '<img data-source="figma" data-source-name="Hero / v3" data-cd-id="hero-v3" />';
    const img = document.querySelector('img') as Element;
    expect(crumbLabel(crumbNodeOf(img))).toBe('Hero / v3');
    img.removeAttribute('data-source');
    expect(crumbLabel(crumbNodeOf(img))).not.toBe('Hero / v3');
  });
});

describe('which card a picture opens on', () => {
  test('a placed photo opens on Photo; one with data-source="figma" opens on Image', async () => {
    const { opensOnPhotoCard } = await import('../client/inspector/inspector-panel.jsx');
    const base = { layersOnly: false, photoPerUse: true, picked: null, selKey: 'a:0:' };
    const photo = { tag: 'img', attrs: {} };
    expect(opensOnPhotoCard({ ...base, el: photo })).toBe(true);
    expect(
      opensOnPhotoCard({ ...base, el: { tag: 'img', attrs: { 'data-source': 'figma' } } })
    ).toBe(false);
  });

  test('the viewer’s own pick of a view still holds, and a layers-only panel never opens on Photo', async () => {
    const { opensOnPhotoCard } = await import('../client/inspector/inspector-panel.jsx');
    const base = { layersOnly: false, photoPerUse: true, picked: null, selKey: 'a:0:' };
    const photo = { tag: 'img', attrs: {} };
    expect(opensOnPhotoCard({ ...base, el: photo, picked: 'a:0:' })).toBe(false);
    expect(opensOnPhotoCard({ ...base, el: photo, layersOnly: true })).toBe(false);
    expect(opensOnPhotoCard({ ...base, el: { tag: 'div', attrs: {} } })).toBe(false);
  });
});
