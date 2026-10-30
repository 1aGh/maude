// p8-sweep-leftovers item 7: Menu › File › Assemble video answers with a toast, never `window.alert`.
//
// The dynamic crawler saw a native alert ("Drop video/audio clips on the canvas first…") — a blocking OS dialog the
// rest of v2 never uses. The flow moved to client/v2/timeline/assemble-video.js and reports through the shell toast.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const CLIENT = join(import.meta.dir, '..', 'client');
let mod: typeof import('../client/v2/timeline/assemble-video.js');

beforeAll(async () => {
  GlobalRegistrator.register();
  mod = await import('../client/v2/timeline/assemble-video.js');
});
afterAll(() => GlobalRegistrator.unregister());

const res = (body: unknown, status = 200) =>
  typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status });

describe('Assemble video', () => {
  test('the shell hook has no native alert left', () => {
    const src = readFileSync(join(CLIENT, 'hooks', 'use-tabs.jsx'), 'utf8');
    expect(src).not.toContain('window.alert(');
    expect(src).toContain('assembleVideoFlow');
  });

  test('no clips → an info toast, nothing created', async () => {
    const toasts: unknown[][] = [];
    const posted: string[] = [];
    let alerted = false;
    (globalThis as any).alert = () => {
      alerted = true;
    };
    const out = await mod.assembleVideoFlow({
      activePath: 'ui/Board.tsx',
      name: 'Board Video',
      toast: (...a: unknown[]) => toasts.push(a),
      loadTree: async () => {},
      openTab: () => {},
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posted.push(url);
        return res('', 404);
      }) as any,
    });
    expect(out).toBe('no-clips');
    expect(alerted).toBe(false);
    expect(posted).toEqual([]);
    expect(toasts).toEqual([[mod.NO_CLIPS_WORDS, false, undefined, { kind: 'info' }]]);
  });

  test('clips → the comp is created and opened; a refusal is an error toast', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><g data-tool="mediaref" data-src="a.mp4"/><g data-tool="mediaref" data-src="b.mp3" data-media-kind="audio"/></svg>';
    const opened: string[] = [];
    let body: any = null;
    const ok = await mod.assembleVideoFlow({
      activePath: 'ui/Board.tsx',
      name: 'Board Video',
      toast: () => {
        throw new Error('no toast on success');
      },
      loadTree: async () => {},
      openTab: (f: string) => opened.push(f),
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          body = JSON.parse(String(init.body));
          return res({ ok: true, file: 'ui/Board Video.tsx' });
        }
        return res(svg);
      }) as any,
    });
    expect(ok).toBe('opened');
    expect(opened).toEqual(['ui/Board Video.tsx']);
    expect(body.clips).toEqual([
      { src: 'a.mp4', mediaKind: 'video' },
      { src: 'b.mp3', mediaKind: 'audio' },
    ]);

    const toasts: unknown[][] = [];
    const bad = await mod.assembleVideoFlow({
      activePath: 'ui/Board.tsx',
      name: 'Board Video',
      toast: (...a: unknown[]) => toasts.push(a),
      loadTree: async () => {},
      openTab: () => {},
      fetchImpl: (async (_u: string, init?: RequestInit) =>
        init?.method === 'POST' ? res({ ok: false, error: 'nope' }, 409) : res(svg)) as any,
    });
    expect(bad).toBe('failed');
    expect(toasts).toEqual([['Assemble failed: nope']]);
  });
});
