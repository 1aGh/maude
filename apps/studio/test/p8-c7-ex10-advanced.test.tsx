// P8 round 7 (09 ex-advanced): the Advanced fold's print and video parts carry the rows the board draws —
// Paper, GIF colours (a real spec field, only live for a GIF) and Long videos (the cap, as words).
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAdvanced } from '../client/v2/export/advanced/model.js';
import { PrintPart } from '../client/v2/export/advanced/print.jsx';
import { VideoPart } from '../client/v2/export/advanced/video.jsx';

const spec = { v: 2, scope: 'canvas', format: 'gif', options: {} };

describe('Advanced › Video and Print — the board’s rows', () => {
  test('Video: GIF colours (disabled unless a GIF is exported) and Long videos', () => {
    const mp4 = renderToStaticMarkup(<VideoPart spec={spec} formats={['mp4']} setAdv={() => {}} />);
    expect(mp4).toContain('GIF colours');
    expect(mp4).toMatch(/data-testid="export-adv-gif-colours"[^>]*disabled/);
    expect(mp4).toContain('Long videos');
    expect(mp4).toContain('Up to 3,600 frames');
    const gif = renderToStaticMarkup(<VideoPart spec={spec} formats={['gif']} setAdv={() => {}} />);
    expect(gif).not.toMatch(/data-testid="export-adv-gif-colours"[^>]*disabled/);
  });

  test('Print: a Paper row that says the paper is the artboard’s', () => {
    const html = renderToStaticMarkup(<PrintPart spec={spec} setAdv={() => {}} />);
    expect(html).toContain('Paper');
    expect(html).toContain('Same as artboard');
  });

  test('the chosen colours reach the spec’s video options', () => {
    const out = applyAdvanced(
      { v: 2, scope: 'canvas', format: 'gif', options: {} },
      { gifColors: 64 }
    );
    expect(out.options?.video?.gifColors).toBe(64);
  });
});
