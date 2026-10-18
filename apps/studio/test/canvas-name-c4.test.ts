// S6.1 — C4: "Untitled canvas", "Untitled canvas 2", … and the create endpoint that uses it.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { nextFreeCanvasName } from '../canvas-create.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('nextFreeCanvasName', () => {
  test('a free base is the name', () => {
    expect(nextFreeCanvasName('Untitled canvas', () => false)).toBe('Untitled canvas');
  });

  test('collisions count up from 2', () => {
    const taken = new Set(['Untitled canvas']);
    expect(nextFreeCanvasName('Untitled canvas', (n) => taken.has(n))).toBe('Untitled canvas 2');
    taken.add('Untitled canvas 2');
    expect(nextFreeCanvasName('Untitled canvas', (n) => taken.has(n))).toBe('Untitled canvas 3');
  });

  test('a gap is filled (a trashed "2" frees its name)', () => {
    const taken = new Set(['Untitled canvas', 'Untitled canvas 3']);
    expect(nextFreeCanvasName('Untitled canvas', (n) => taken.has(n))).toBe('Untitled canvas 2');
  });

  test('a prompt-derived base counts the same way', () => {
    const taken = new Set(['Poster']);
    expect(nextFreeCanvasName('Poster', (n) => taken.has(n))).toBe('Poster 2');
  });

  test('an empty base is "Untitled canvas"; a broken isTaken cannot loop forever', () => {
    expect(nextFreeCanvasName('  ', () => false)).toBe('Untitled canvas');
    expect(nextFreeCanvasName('X', () => true)).toMatch(/^X \d+$/);
  });
});

async function post(port: number, body: unknown) {
  const r = await fetch(`http://localhost:${port}/_api/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, string> };
}

describe('POST /_api/canvas — a blank canvas named by C4', () => {
  test('{} makes "Untitled canvas", then "Untitled canvas 2"', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const a = await post(port, {});
      expect(a.status).toBe(201);
      expect(a.json.rel).toBe('ui/Untitled canvas.tsx');
      expect(existsSync(join(designRoot, 'ui', 'Untitled canvas.tsx'))).toBe(true);
      const b = await post(port, { kind: 'blank' });
      expect(b.status).toBe(201);
      expect(b.json.rel).toBe('ui/Untitled canvas 2.tsx');
      const meta = JSON.parse(
        readFileSync(join(designRoot, 'ui', 'Untitled canvas 2.meta.json'), 'utf8')
      );
      expect(meta.kind).toBe('canvas');
      expect(meta.title).toBe('Untitled canvas 2');
    } finally {
      await killProc(proc);
    }
  });

  test('eight creates at the same instant get eight different names', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const all = await Promise.all(Array.from({ length: 8 }, () => post(port, {})));
      expect(all.map((r) => r.status)).toEqual(Array(8).fill(201));
      expect(new Set(all.map((r) => r.json.rel)).size).toBe(8);
    } finally {
      await killProc(proc);
    }
  });

  test('a canvas moved to the trash gives its name back', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const a = await post(port, {});
      const del = await fetch(
        `http://localhost:${port}/_api/canvas?file=${encodeURIComponent(a.json.file)}`,
        { method: 'DELETE' }
      );
      expect(del.status).toBe(200);
      const again = await post(port, {});
      expect(again.json.rel).toBe('ui/Untitled canvas.tsx');
    } finally {
      await killProc(proc);
    }
  });

  test('fromPrompt names the canvas from the sentence; a second one counts up', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const a = await post(port, {
        kind: 'blank',
        fromPrompt: 'A poster for my open studio on Thursday',
      });
      expect(a.json.rel).toBe('ui/Poster.tsx');
      const b = await post(port, { kind: 'blank', fromPrompt: 'Another poster, bigger' });
      expect(b.json.rel).toBe('ui/Poster 2.tsx');
      const c = await post(port, { kind: 'blank', fromPrompt: 'Make it pop' });
      expect(c.json.rel).toBe('ui/Untitled canvas.tsx');
    } finally {
      await killProc(proc);
    }
  });

  test('an explicit name still wins, and a taken one is still a 409', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const a = await post(port, { kind: 'blank', name: 'My own' });
      expect(a.json.rel).toBe('ui/My own.tsx');
      const dup = await post(port, { kind: 'blank', name: 'My own' });
      expect(dup.status).toBe(409);
      writeFileSync(join(designRoot, 'ui', 'Untitled canvas.tsx'), 'export default () => null;\n');
      const next = await post(port, {});
      expect(next.json.rel).toBe('ui/Untitled canvas 2.tsx');
    } finally {
      await killProc(proc);
    }
  });

  test('the brief board is still named by its caller (no kind + a name)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const a = await post(port, { name: 'Onboarding Brief' });
      expect(a.status).toBe(201);
      const meta = JSON.parse(
        readFileSync(join(designRoot, 'ui', 'Onboarding Brief.meta.json'), 'utf8')
      );
      expect(meta.kind).toBe('brief-board');
      const none = await post(port, { kind: 'brief-board' });
      expect(none.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });
});
