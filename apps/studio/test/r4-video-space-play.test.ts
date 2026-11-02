// r4 #1 — "video v canvasu neni jak prehrat". A <video controls> placed on an artboard plays where it sits:
// a quick Space tap plays / pauses the SELECTED video element (in Edit the canvas takes the click, so the native
// controls are out of reach); a selected artboard or frame is not a video and leaves the tap to the shell.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function fake(id: string): { el: HTMLVideoElement; calls: string[] } {
  const el = document.createElement('video');
  el.setAttribute('data-cd-id', id);
  el.setAttribute('controls', '');
  const calls: string[] = [];
  let paused = true;
  Object.defineProperty(el, 'paused', { get: () => paused });
  Object.defineProperty(el, 'ended', { get: () => false });
  (el as unknown as { play: () => Promise<void> }).play = () => {
    paused = false;
    calls.push('play');
    return Promise.resolve();
  };
  (el as unknown as { pause: () => void }).pause = () => {
    paused = true;
    calls.push('pause');
  };
  document.body.append(el);
  return { el, calls };
}

describe('Space plays the selected <video> element', () => {
  test('a tap plays a paused video, the next one pauses it', async () => {
    const { playSelectedVideos } = await import('../editing/video-play.ts');
    const { calls } = fake('hero');
    const sel = [{ id: 'hero', selector: '[data-cd-id="hero"]' }];
    expect(playSelectedVideos(document, sel)).toBe(true);
    expect(playSelectedVideos(document, sel)).toBe(true);
    expect(calls).toEqual(['play', 'pause']);
  });

  test('the selector with its occurrence index finds the right one of two', async () => {
    const { playSelectedVideos } = await import('../editing/video-play.ts');
    const a = fake('twin');
    const b = fake('twin');
    playSelectedVideos(document, [{ selector: 'video[data-cd-id="twin"]', index: 1 }]);
    expect([a.calls, b.calls]).toEqual([[], ['play']]);
  });

  test('a selected artboard / frame / nothing is not a video: the tap is the shell’s', async () => {
    const { playSelectedVideos } = await import('../editing/video-play.ts');
    const div = document.createElement('div');
    div.id = 'frame';
    document.body.append(div);
    expect(playSelectedVideos(document, [{ selector: '#frame' }])).toBe(false);
    expect(playSelectedVideos(document, [])).toBe(false);
    expect(playSelectedVideos(document, undefined)).toBe(false);
    expect(playSelectedVideos(document, [{ selector: '###broken' }])).toBe(false);
  });

  test('the canvas asks it BEFORE telling the shell, and tells the shell only when it did not play', () => {
    const src = readFileSync(join(import.meta.dir, '../canvas-lib.tsx'), 'utf8');
    expect(src).toContain('onSpaceTapRef.current?.() !== true) sendSpaceTap(window)');
    expect(src).toContain(
      'onSpaceTap: () => playSelectedVideos(document, tapSelRef.current?.selected)'
    );
  });
});
