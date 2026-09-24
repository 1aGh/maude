// DDR-242 — embedding the studio in another app. The framing allowlist, the
// canvas URL an embed builds, the one-way message contract, and — booted for
// real — the headers the studio page and the canvas shell actually send.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { canvasUrl } from '../client/canvas-url.js';
import {
  embedMessage,
  embedTarget,
  isEmbedLocation,
  parentOrigin,
  postToEmbedder,
  readEmbedParams,
  validArtboardId,
} from '../client/embed.js';
import { frameAncestors, parseEmbedOrigins } from '../embed-origins.ts';
import { cspForCanvasShell, studioPageCsp } from '../http.ts';
import { installEmbedEscapeRelay } from '../read-only-mode.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const ORBIT = 'https://orbit.studyfi.com';

describe('parseEmbedOrigins — a framing list fails closed', () => {
  test('normalizes to bare origins, dedupes, keeps order', () => {
    expect(parseEmbedOrigins(`${ORBIT}/tasks/1, http://localhost:3100 ${ORBIT}`)).toEqual([
      ORBIT,
      'http://localhost:3100',
    ]);
  });

  test('drops wildcards, non-http schemes, credentials, junk and the null origin', () => {
    expect(
      parseEmbedOrigins(
        '* https://*.studyfi.com javascript:alert(1) file:///etc not-a-url https://u:p@x.example null'
      )
    ).toEqual([]);
    expect(parseEmbedOrigins(undefined)).toEqual([]);
  });

  test('frameAncestors: self, then the shells, then the embedders', () => {
    expect(frameAncestors('http://localhost:4399 http://127.0.0.1:4399', [ORBIT])).toBe(
      `'self' http://localhost:4399 http://127.0.0.1:4399 ${ORBIT}`
    );
    expect(frameAncestors(undefined, [])).toBe("'self'");
  });
});

describe('studioPageCsp — embedders only for the embed, and the embed frames only its canvas', () => {
  const MAIN = 'http://localhost:4399 http://127.0.0.1:4399';
  test('the full studio: no embedders, no frame-src', () => {
    expect(studioPageCsp(MAIN, [])).toBe(`frame-ancestors 'self' ${MAIN}`);
  });
  test('the embed: embedders may frame it; child frames only self + the canvas origin', () => {
    const csp = studioPageCsp(MAIN, [ORBIT], {
      embed: true,
      canvasOrigin: 'https://canvas.acme.com/tenant',
    });
    expect(csp).toBe(
      `frame-ancestors 'self' ${MAIN} ${ORBIT}; frame-src 'self' https://canvas.acme.com`
    );
  });
  test('no canvas origin (same-origin canvases) ⇒ frame-src self only', () => {
    expect(studioPageCsp(MAIN, [ORBIT], { embed: true })).toContain("frame-src 'self'");
    expect(studioPageCsp(MAIN, [ORBIT], { embed: true })).not.toMatch(/frame-src 'self' \S/);
  });
});

describe('cspForCanvasShell — every ancestor is checked', () => {
  const SHELL = '<!doctype html><html><head><script>1</script></head></html>';
  test('an embedder of the studio page is also allowed to be the canvas grand-parent', () => {
    expect(cspForCanvasShell(SHELL, 'http://localhost:4399', [ORBIT])).toContain(
      `frame-ancestors 'self' http://localhost:4399 ${ORBIT}`
    );
  });
  test('no embedders ⇒ the directive is unchanged', () => {
    expect(cspForCanvasShell(SHELL, 'http://localhost:4399')).toContain(
      "frame-ancestors 'self' http://localhost:4399"
    );
  });
});

describe('canvasUrl({ embed: true })', () => {
  const cfg = { designRel: '.design', canvasOrigin: 'http://localhost:5000' };
  test('read-only, comment-free, and marked embed so the camera is never persisted', () => {
    const qs = new URLSearchParams(
      canvasUrl('.design/ui/a.tsx', cfg, { embed: true }).split('?')[1]
    );
    expect(qs.get('ro')).toBe('1');
    expect(qs.get('comments')).toBe('0');
    expect(qs.get('embed')).toBe('1');
    expect(qs.get('canvas')).toBe('ui/a.tsx');
  });
  test('an ordinary tab is byte-identical to before', () => {
    const url = canvasUrl('.design/ui/a.tsx', cfg);
    expect(url).not.toContain('embed=');
    expect(url).not.toContain('ro=');
  });
});

describe('client/embed.js — the parameters and the contract', () => {
  const loc = (search: string) => ({ search }) as Location;

  test('embed mode is exactly embed=1', () => {
    expect(isEmbedLocation(loc('?embed=1&open=ui/a.tsx'))).toBe(true);
    expect(isEmbedLocation(loc('?embed=true'))).toBe(false);
    expect(isEmbedLocation(loc('?open=ui/a.tsx'))).toBe(false);
  });

  test('open is validated like a share link; the request is echoed; artboard is bounded', () => {
    expect(readEmbedParams(loc('?embed=1&open=.design/ui/My%20Board.tsx&artboard=home'))).toEqual({
      open: 'ui/My Board.tsx',
      requested: '.design/ui/My Board.tsx',
      artboard: 'home',
    });
    expect(readEmbedParams(loc('?embed=1&open=../secret')).open).toBeNull();
    expect(readEmbedParams(loc('?embed=1&open=a.tsx&open=b.tsx')).open).toBeNull();
    expect(validArtboardId('x'.repeat(121))).toBe(false);
    expect(validArtboardId('a\nb')).toBe(false);
  });

  test('the message shape is exact', () => {
    expect(embedMessage('ready', 'ui/a.tsx', 'Home')).toEqual({
      source: 'maude-hub',
      v: 1,
      type: 'ready',
      open: 'ui/a.tsx',
      title: 'Home',
    });
    expect(embedMessage('not-found', 'ui/x.tsx')).toEqual({
      source: 'maude-hub',
      v: 1,
      type: 'not-found',
      open: 'ui/x.tsx',
    });
  });

  test('never "*": only an allowlisted parent, by its exact origin', () => {
    expect(embedTarget(ORBIT, [ORBIT])).toBe(ORBIT);
    expect(embedTarget('https://evil.example', [ORBIT])).toBeNull();
    expect(embedTarget('null', ['null'])).toBeNull();
    expect(embedTarget(ORBIT, undefined)).toBeNull();
  });

  test('the parent origin comes from ancestorOrigins, else the referrer, else nothing', () => {
    const parent = {};
    expect(parentOrigin({ parent, location: { ancestorOrigins: [ORBIT] } })).toBe(ORBIT);
    expect(
      parentOrigin({ parent, location: {}, document: { referrer: `${ORBIT}/tasks/ORB-1` } })
    ).toBe(ORBIT);
    const top: { parent?: unknown } = {};
    top.parent = top;
    expect(parentOrigin(top)).toBeNull();
  });

  test('postToEmbedder posts once to the allowed parent and to no one else', () => {
    const sent: Array<[unknown, string]> = [];
    const parent = { postMessage: (m: unknown, t: string) => sent.push([m, t]) };
    const win = { parent, location: { ancestorOrigins: [ORBIT] } };
    expect(postToEmbedder(win, [ORBIT], 'ready', 'ui/a.tsx', 'Home')).toBe(true);
    expect(sent).toEqual([
      [{ source: 'maude-hub', v: 1, type: 'ready', open: 'ui/a.tsx', title: 'Home' }, ORBIT],
    ]);
    expect(postToEmbedder(win, ['https://other.example'], 'ready', 'ui/a.tsx')).toBe(false);
    expect(sent.length).toBe(1);
  });
});

describe('installEmbedEscapeRelay — Escape leaves the embed (a11y)', () => {
  function fakeWin(search: string, framed = true) {
    const listeners: Array<(e: KeyboardEvent) => void> = [];
    const posted: unknown[] = [];
    const win: Record<string, unknown> = {
      location: { search },
      addEventListener: (_t: string, fn: (e: KeyboardEvent) => void) => listeners.push(fn),
      removeEventListener: () => {},
    };
    win.parent = framed ? { postMessage: (m: unknown) => posted.push(m) } : win;
    const press = (key: string, prevented = false) => {
      for (const fn of listeners)
        fn({ key, isComposing: false, defaultPrevented: prevented } as KeyboardEvent);
    };
    return { win: win as unknown as Window, listeners, posted, press };
  }

  test('an unconsumed Escape in an embedded canvas is relayed to the studio page', async () => {
    const w = fakeWin('?canvas=ui/a.tsx&embed=1');
    installEmbedEscapeRelay(w.win);
    w.press('Escape');
    w.press('Escape', true); // consumed inside — stays inside
    w.press('Enter');
    await Bun.sleep(5);
    expect(w.posted).toEqual([{ dgn: 'embed-escape' }]);
  });

  test('never outside embed mode, and never when not framed', () => {
    const studio = fakeWin('?canvas=ui/a.tsx');
    installEmbedEscapeRelay(studio.win);
    expect(studio.listeners.length).toBe(0);
    const top = fakeWin('?embed=1', false);
    installEmbedEscapeRelay(top.win);
    expect(top.listeners.length).toBe(0);
  });

  test('escape is part of the v1 message shape', () => {
    expect(embedMessage('escape', 'ui/a.tsx')).toEqual({
      source: 'maude-hub',
      v: 1,
      type: 'escape',
      open: 'ui/a.tsx',
    });
  });
});

async function readCanvasOrigin(designRoot: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('a booted studio frames with the allowlist', () => {
  test('studio page + canvas shell carry the embedder; /_config exposes only valid origins', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'A.tsx'), 'export default function A(){return <main/>}\n');
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_CANVAS_ORIGIN_SPLIT: '1',
      MAUDE_EMBED_ORIGINS: `${ORBIT}/whatever * not-a-url`,
    });
    try {
      const canvas = await readCanvasOrigin(designRoot);
      // The full studio: shells only — an embedder may frame the embed, never this.
      for (const path of ['/', '/index.html', '/?open=ui/A.tsx']) {
        const res = await fetch(`http://localhost:${port}${path}`);
        expect(res.status).toBe(200);
        const csp = res.headers.get('content-security-policy') ?? '';
        expect(csp).toBe(
          `frame-ancestors 'self' http://localhost:${port} http://127.0.0.1:${port}`
        );
      }
      // The embed: the embedder may frame it, and it frames only its canvas.
      for (const path of ['/?open=ui/A.tsx&embed=1', '/index.html?embed=1']) {
        const res = await fetch(`http://localhost:${port}${path}`);
        expect(res.status).toBe(200);
        const csp = res.headers.get('content-security-policy') ?? '';
        expect(csp).toContain(
          `frame-ancestors 'self' http://localhost:${port} http://127.0.0.1:${port} ${ORBIT}`
        );
        expect(csp).toContain(`frame-src 'self' ${new URL(canvas).origin}`);
        expect(csp).not.toContain('*');
      }
      const shellCsp = (await fetch(`${canvas}/_canvas-shell.html`)).headers.get(
        'content-security-policy'
      );
      expect(shellCsp).toContain(`frame-ancestors 'self' http://localhost:${port}`);
      expect(shellCsp).toContain(ORBIT);
      const cfg = await (await fetch(`http://localhost:${port}/_config`)).json();
      expect(cfg.embedOrigins).toEqual([ORBIT]);
    } finally {
      await killProc(proc);
    }
  }, 30_000);

  test('without MAUDE_EMBED_ORIGINS the studio page still refuses foreign framers', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_EMBED_ORIGINS: '' });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toBe(`frame-ancestors 'self' http://localhost:${port} http://127.0.0.1:${port}`);
      const cfg = await (await fetch(`http://localhost:${port}/_config`)).json();
      expect(cfg.embedOrigins).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  }, 30_000);
});
