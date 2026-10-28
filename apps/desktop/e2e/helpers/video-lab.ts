import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, browser } from '@wdio/globals';
import { pointerClick } from './pointer';
import { readServerInfo } from './sidecar';

/**
 * P8 test round (G4 video + import): small helpers the video / import specs share. Additive; nothing here changes a
 * spec that does not import it.
 *
 *   media      real, tiny clips made with the local ffmpeg into a THROWAWAY dir (never committed): `makeClip` (a
 *              vertical or horizontal picture, with or without sound), `makeTone` (a click track for the music bed)
 *   in-page    `fileInShell` builds a real `File` in the shell window from those bytes (the same File a Finder drop
 *              hands over), `dropOnWindow` runs the dragenter → drop a footage drop makes
 *   canvas     `artboardBox` / `clickAt` — the artboard is inside the canvas iframe, so it is clicked by coordinates
 */

export const tid = (id: string) => `[data-testid="${id}"]`;
export const text = async (id: string) => (await (await $(tid(id))).getText()).trim();

/** A scratch dir under the OS temp dir; the caller's clips live here and nowhere else. */
export function scratch(prefix = 'maude-e2e-media-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function haveFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
}

/**
 * A real h264 clip. `size` is "WxH" (vertical = 90x160), `sec` its length. `sound: false` leaves out the audio track
 * ("a video with no sound"); with sound the clip carries a quiet sine tone.
 */
export function makeClip(
  dir: string,
  name: string,
  { size = '160x90', sec = 1, sound = false, hue = 0 } = {}
): string {
  const out = join(dir, name);
  const args = [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${size}:rate=5:duration=${sec}`,
    ...(sound ? ['-f', 'lavfi', '-i', `sine=frequency=${440 + hue}:duration=${sec}`] : []),
    '-vf',
    `hue=h=${hue}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'baseline',
    '-crf',
    '42',
    ...(sound ? ['-c:a', 'aac', '-b:a', '12k', '-ar', '8000', '-shortest'] : ['-an']),
    '-movflags',
    '+faststart',
    out,
  ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg could not make ${name}: ${r.stderr}`);
  return out;
}

/** A short audio file (a 120 BPM click track) for the music bed. */
export function makeTone(dir: string, name: string, sec = 4): string {
  const out = join(dir, name);
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${sec}`, '-c:a', 'libmp3lame', out],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`ffmpeg could not make ${name}: ${r.stderr}`);
  return out;
}

export const b64 = (file: string) => readFileSync(file).toString('base64');

/** Put a real File (bytes from disk) on `window.__e2eFiles[key]` of the shell, ready for a drop. */
export async function fileInShell(
  key: string,
  file: string,
  name: string,
  type: string
): Promise<void> {
  await browser.execute(
    (k: string, data: string, n: string, t: string) => {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const w = window as unknown as { __e2eFiles?: Record<string, File> };
      w.__e2eFiles = w.__e2eFiles ?? {};
      w.__e2eFiles[k] = new File([bytes], n, { type: t });
    },
    key,
    b64(file),
    name,
    type
  );
}

/**
 * A footage drop: dragenter on the window (the shell then puts the catcher over the artboard), then the drop on the
 * catcher. Resolves once the catcher took the drop.
 */
export async function dropOnWindow(keys: string[]): Promise<void> {
  await browser.execute((ks: string[]) => {
    const w = window as unknown as { __e2eFiles: Record<string, File> };
    const dt = new DataTransfer();
    for (const k of ks) dt.items.add(w.__e2eFiles[k]);
    window.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })
    );
  }, keys);
  const catcher = await $(tid('timeline-artboard-drop'));
  await catcher.waitForExist({ timeout: 5000, timeoutMsg: 'no drop catcher over the artboard' });
  await browser.execute((ks: string[]) => {
    const w = window as unknown as { __e2eFiles: Record<string, File> };
    const dt = new DataTransfer();
    for (const k of ks) dt.items.add(w.__e2eFiles[k]);
    const at = document.querySelector('[data-testid="timeline-artboard-drop"]') as HTMLElement;
    at.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    at.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, keys);
}

export type Box = { x: number; y: number; w: number; h: number };
export async function artboardBox(id: string): Promise<Box | null> {
  return browser.execute((artboard) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    const win = frame?.contentWindow as Window | null | undefined;
    if (!frame || !win) return null;
    const f = frame.getBoundingClientRect();
    try {
      const el = win.document.querySelector(`[data-dc-screen="${artboard}"]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height } : null;
    } catch {
      return null;
    }
  }, id) as Promise<Box | null>;
}
export const clickAt = (x: number, y: number) => pointerClick(x, y);

/** A key the shell hears (the canvas iframe is out of reach; the shell's own handler takes ⌘Z). */
export const keyDown = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

/** The running studio's origin, and a JSON POST against it (the hook routes a terminal Claude Code would call). */
export const studioBase = (root: string) => readServerInfo(root).url.replace(/\/$/, '');
export async function postJson(root: string, route: string, body: unknown) {
  const r = await fetch(`${studioBase(root)}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
