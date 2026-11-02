// p8-sweep-errors (5) — the dead-control crawl's one DEAD: `Crawl fixture: tighten the hero copy` in Version history
// (a version row open, Tauri shell). It is a comment pin (`.dgn-pin`, its title is the comment's text) drawn by the
// injected inspector script inside the PAST-VERSION frame — `_canvas-shell.html?…&sha=r4&ro=1&comments=0`. The shell
// posts today's comments (`comments-set`) to the frame of the open canvas, and that frame is the version's; the
// script drew pins although the URL says `comments=0`, and a click on one asked the shell to open a thread the
// version view does not show (nothing happened). A frame with `comments=0` (a version, Compare, a follower, an
// embed, a gallery tile) now draws no pin, whatever it is sent.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { type Context, createBus } from '../context.ts';
import { createInspect } from '../inspect.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
}

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
  (window as unknown as { __designInspectorAttached?: boolean }).__designInspectorAttached = false;
  document.getElementById('dgn-pin-layer')?.remove();
});

const COMMENTS = [
  { id: 'c_1', text: 'Crawl fixture: tighten the hero copy', selector: 'h1', status: 'open' },
];

/** Run the injected inspector script in a document at `search`, then send it today's comments. */
async function pinsAt(search: string): Promise<HTMLButtonElement[]> {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
    `http://localhost:4400/_canvas-shell.html${search}`
  );
  const { root, designRoot } = makeSandbox();
  const inspect = createInspect(mkCtx(root, designRoot), async () => []);
  const html = inspect.injectInspector('<html><body><h1>Hello</h1></body></html>');
  const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
  Object.defineProperty(window, 'parent', { value: { postMessage() {} }, configurable: true });
  document.body.innerHTML = '<h1>Hello</h1>';
  for (const b of bodies) new Function(b)();
  window.dispatchEvent(
    new MessageEvent('message', { data: { dgn: 'comments-set', comments: COMMENTS } })
  );
  await new Promise((r) => setTimeout(r, 10));
  return [...document.querySelectorAll<HTMLButtonElement>('.dgn-pin')];
}

describe('the injected pin layer honours comments=0', () => {
  test('the open canvas draws its comment pins', async () => {
    const pins = await pinsAt('?canvas=ui%2FLanding.tsx&designRel=.design');
    expect(pins.map((p) => p.title)).toEqual(['Crawl fixture: tighten the hero copy']);
  });

  test('a past version (sha=…&ro=1&comments=0) draws none, though today’s comments are sent to it', async () => {
    const pins = await pinsAt('?canvas=ui%2FLanding.tsx&designRel=.design&sha=r4&ro=1&comments=0');
    expect(pins).toEqual([]);
  });
});
