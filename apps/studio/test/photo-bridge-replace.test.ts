// A replaced image is no longer the photo it was (plan T31, L12 replace).
//
// The photo preview bridge tags an image node with `data-photo-asset` the
// first time it bakes an edit onto it, and finds the node by that tag from
// then on. Replace… points the same node at another asset; the tag stayed, so
// the next preview or refresh for the OLD photo found the node and put the
// old picture back — on the machine that made the replace, while every other
// copy and the file itself showed the new one.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { extractAssetRef, findPhotoEl } from '../canvas-lib.tsx';

const OLD = 'assets/f4c0eb9a.png';

function image(href: string, tagged?: string): Element {
  document.body.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  el.setAttribute('href', href);
  if (tagged) el.setAttribute('data-photo-asset', tagged);
  svg.append(el);
  document.body.append(svg);
  return el;
}

describe('the photo bridge after Replace…', () => {
  test('a baked node is still found by its tag', () => {
    const el = image('data:image/png;base64,AAAA', OLD);
    expect(findPhotoEl(OLD)).toBe(el);
    expect(extractAssetRef(el)).toBe(OLD);
  });

  test('an untouched node is found by its own href', () => {
    const el = image(`/.design/${OLD}?v=1`);
    expect(findPhotoEl(OLD)).toBe(el);
  });

  test('a node the canvas re-pointed at another asset is not the old photo any more', () => {
    const el = image('/.design/assets/surface-pattern.png', OLD);
    expect(findPhotoEl(OLD)).toBeNull();
    expect(el.hasAttribute('data-photo-asset')).toBe(false);
    expect(extractAssetRef(el)).toBeNull();
  });

  test('re-pointed at another photo, it answers as that photo', () => {
    const el = image('/.design/assets/0a1b2c3d.png', OLD);
    expect(extractAssetRef(el)).toBe('assets/0a1b2c3d.png');
    expect(findPhotoEl('assets/0a1b2c3d.png')).toBe(el);
  });
});
