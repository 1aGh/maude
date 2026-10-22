// P8 bug sweep B2 — the video seed read "No clips on clip yet." The canvas names the selected artboard to
// the shell (`artboard-anchor.label`, the empty hint's `label`) through `labelOf`, which read the label
// element's `firstChild`. A non-digital artboard's label starts with the kind chip (an aria-hidden
// <span>), so the "name" was '' — the shell fell back to the artboard ID ("clip") and said so in the
// timeline's empty words. The artboard's own name is the one the canvas stamped on `data-dc-label`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { measureAnchor } from '../editing/anchor-report.ts';
import { labelOf } from '../editing/empty-report.ts';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = '';
});

// the markup canvas-lib renders for a positioned artboard (canvas-lib.tsx): kind chip first, then the name
const videoBoard = `<article data-dc-screen="clip" data-dc-kind="video" data-dc-label="Clip · 320×180"><button type="button" class="dc-artboard-label sku"><span class="dc-artboard-kind-chip" aria-hidden="true"><svg viewBox="0 0 16 16"></svg></span>Clip · 320×180<span class="dc-artboard-warn"></span></button><div class="dc-artboard-body"></div></article>`;

describe('labelOf names the artboard, not its kind chip', () => {
  test('a video artboard whose label button starts with the kind chip', () => {
    document.body.innerHTML = videoBoard;
    const article = document.querySelector('article') as Element;
    expect(labelOf(article)).toBe('Clip · 320×180');
    expect(measureAnchor(document, 'clip')).toMatchObject({
      kind: 'video',
      label: 'Clip · 320×180',
    });
  });

  test('without data-dc-label it reads the label element text outside the chip, then the id', () => {
    document.body.innerHTML = videoBoard.replace(' data-dc-label="Clip · 320×180"', '');
    expect(labelOf(document.querySelector('article') as Element)).toBe('Clip · 320×180');
    document.body.innerHTML = '<article data-dc-screen="solo"></article>';
    expect(labelOf(document.querySelector('article') as Element)).toBe('solo');
  });

  test('an unpositioned digital artboard (plain <header>) is unchanged', () => {
    document.body.innerHTML =
      '<article data-dc-screen="a"><header class="dc-artboard-label sku">Home</header><div class="dc-artboard-body"></div></article>';
    expect(labelOf(document.querySelector('article') as Element)).toBe('Home');
  });
});
