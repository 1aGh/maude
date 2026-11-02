// V2-8.9 round 2 L-R2-2 — a canvas frame carries no resource hints. Navigations are gated and the
// canvas CSP blocks connections, but `<link rel=dns-prefetch|preconnect|prefetch>` can still resolve a
// host (a DNS lookup carries data even while "Search the web" is off). The canvas shell turns prefetch
// control off and strips those hints — always, since the CSP leaves them no use in a canvas frame.
// The shell's guard script runs here in happy-dom against the hint shapes a canvas can make.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Window } from 'happy-dom';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);
const guard = [...SHELL.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1] ?? '')
  .find((s) => s.includes('L-R2-2'));

function frame() {
  const win = new Window();
  // the shell's own inline script, run against happy-dom
  new Function('window', guard ?? 'throw new Error("no L-R2-2 guard in _shell.html")')(win);
  return win;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the canvas shell neutralises resource hints', () => {
  test('prefetch control is off before any canvas content', () => {
    const head = SHELL.slice(0, SHELL.indexOf('</head>'));
    expect(head).toMatch(/<meta http-equiv="x-dns-prefetch-control" content="off"/i);
  });

  test('rel / setAttribute lose the hint tokens before the link lands', () => {
    const win = frame();
    const doc = win.document;
    const a = doc.createElement('link');
    a.setAttribute('rel', 'dns-prefetch');
    a.setAttribute('href', '//data.evil.test');
    const b = doc.createElement('link') as unknown as { rel: string; href: string };
    b.rel = 'preconnect stylesheet';
    expect(a.getAttribute('rel')).toBe('');
    expect(b.rel).toBe('stylesheet');
  });

  test('a hint that arrives by parsing or relList is removed when it lands', async () => {
    const win = frame();
    const doc = win.document;
    doc.head.innerHTML += '<link rel="prefetch" href="https://x.evil.test/a">';
    const c = doc.createElement('link');
    c.relList.add('dns-prefetch');
    doc.head.appendChild(c);
    const keep = doc.createElement('link');
    keep.setAttribute('rel', 'stylesheet');
    doc.head.appendChild(keep);
    await tick();
    const rels = [...doc.querySelectorAll('link')].map((l) => l.getAttribute('rel') ?? '');
    expect(rels.filter((r) => /prefetch|preconnect|prerender/i.test(r))).toEqual([]);
    expect(rels).toContain('stylesheet');
  });
});
