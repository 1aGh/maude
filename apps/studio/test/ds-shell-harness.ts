// S10.4 test harness — runs the canvas shell's own `ds-css` / `ds-pins` regions (lifted from
// plugins/design/templates/_shell.html, the code that ships) inside a real Chromium iframe whose parent is
// a plain page, so `window.parent` gating, fetch, the MutationObserver and the cascade are all real.
// The origin is a routed fake (`http://t.test`): the frame's `/.design/**` requests are answered from `css`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);

export function shellRegion(name: string): string {
  const begin = SHELL.indexOf(`// ${name}:begin`);
  const end = SHELL.indexOf(`// ${name}:end`);
  if (begin < 0 || end <= begin) throw new Error(`region ${name} missing from _shell.html`);
  return SHELL.slice(begin, end);
}

// biome-ignore lint/suspicious/noExplicitAny: playwright surface
type Any = any;

export interface Frame {
  page: Any;
  /** a message from the PARENT window into the shell frame */
  post(msg: unknown): Promise<void>;
  /** a message the frame's own (untrusted) code posts to itself */
  selfPost(msg: unknown): Promise<void>;
  /** what the parent window received from the frame */
  got(): Promise<unknown[]>;
  evalInFrame<T>(fn: string): Promise<T>;
  close(): Promise<void>;
}

export async function openShellFrame(opts: {
  /** designRoot-relative path → CSS text served for it */
  css?: Record<string, string>;
  body?: string;
  head?: string;
}): Promise<Frame> {
  const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
    launchChromium: () => Promise<Any>;
  };
  const browser = await launchChromium();
  const ctx = await browser.newContext({ viewport: { width: 600, height: 400 } });
  const page: Any = await ctx.newPage();
  const files = opts.css ?? {};
  const frameHtml = `<!doctype html><html><head>
<link id="canvas-tokens" rel="stylesheet" href="">
<link id="canvas-components" rel="stylesheet" href="">
${opts.head ?? ''}</head><body>${opts.body ?? ''}
<script>
const designRel = '.design';
const withCap = (u) => u;
${shellRegion('ds-css')}
${shellRegion('ds-pins')}
</script></body></html>`;
  await page.route('http://t.test/**', (route: Any) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><body><iframe id="f" src="/frame" width="580" height="380"></iframe>
<script>window.__got=[];addEventListener('message',e=>window.__got.push(e.data));</script></body>`,
      });
    }
    if (url.pathname === '/frame')
      return route.fulfill({ contentType: 'text/html', body: frameHtml });
    const rel = decodeURIComponent(url.pathname).replace(/^\/\.design\//, '');
    if (url.pathname.startsWith('/.design/') && rel in files)
      return route.fulfill({ contentType: 'text/css', body: files[rel] });
    return route.fulfill({ status: 404, body: 'no' });
  });
  await page.goto('http://t.test/');
  await page.waitForSelector('#f');
  const frame = page.frames().find((f: Any) => f.url().endsWith('/frame'));
  await frame.waitForLoadState('load');
  return {
    page,
    post: (msg) =>
      page.evaluate(
        (m: unknown) =>
          (document.getElementById('f') as HTMLIFrameElement).contentWindow?.postMessage(m, '*'),
        msg
      ),
    selfPost: (msg) => frame.evaluate((m: unknown) => window.postMessage(m, '*'), msg),
    got: () => page.evaluate(() => (window as unknown as { __got: unknown[] }).__got),
    evalInFrame: (fn) => frame.evaluate(fn),
    close: () => browser.close(),
  };
}
