// r1 (Michal rc.1 item 10) — "z assets mi nejde pretahnout obrazek do canvasu". The Assets tile (shell origin)
// puts its payload under `application/x-maude-asset`; the canvas is a DIFFERENT origin (DDR-054), and WebKit
// shows a custom MIME type only to the origin that wrote it — in WKWebView the canvas saw `types` without it,
// never cancelled dragover, and the drop did nothing. The tile's plain-text twin (`assets/<name>`) IS readable
// across origins, so the canvas now also recognises a plain-text drag and reads the asset from it at drop. The
// server still re-checks the path (`image.place`), so a forged text places at most a picture the project has.

import { describe, expect, test } from 'bun:test';

import { ASSET_DRAG_MIME, assetFromDrop, dragHasAsset } from '../editing/asset-drag.ts';
import { isFinderDrag } from '../editing/finder-drop-model.ts';

const dt = (data: Record<string, string>, extra: string[] = []) => ({
  types: [...Object.keys(data), ...extra],
  getData: (t: string) => data[t] ?? '',
});

describe('an Assets drag the canvas cannot see the custom type of (WebKit, cross-origin)', () => {
  test('a plain-text drag may carry an asset while it is in flight', () => {
    expect(dragHasAsset(['text/plain'])).toBe(true);
    expect(dragHasAsset([ASSET_DRAG_MIME, 'text/plain'])).toBe(true);
    // a Finder file is still the asset import's, never this lane's
    expect(dragHasAsset(['Files'])).toBe(false);
    expect(dragHasAsset(['Files', 'text/plain'])).toBe(false);
    expect(isFinderDrag(['text/plain'])).toBe(false);
  });

  test('at drop the asset comes from the custom type, else from the plain-text twin', () => {
    expect(
      assetFromDrop(dt({ [ASSET_DRAG_MIME]: '{"asset":"assets/a.png","w":40,"h":30}' }))
    ).toEqual({ asset: 'assets/a.png', w: 40, h: 30 });
    expect(assetFromDrop(dt({ 'text/plain': 'assets/stadium.jpg' }))).toEqual({
      asset: 'assets/stadium.jpg',
    });
  });

  test('a plain text that is not an asset path is nobody’s asset', () => {
    for (const t of [
      'hello',
      'assets/../config.json',
      'https://x.test/a.png',
      'assets/sub/a.png',
      '',
    ])
      expect(assetFromDrop(dt({ 'text/plain': t }))).toBeNull();
    expect(assetFromDrop(null)).toBeNull();
  });
});
