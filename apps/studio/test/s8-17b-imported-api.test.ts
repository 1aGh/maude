// S8.17b — the studio's read boundary for a Figma comment pin (`/_comments`, the reply route and the comment
// door): a pin written by an import (or arriving from a peer) is re-clamped when read; a hostile writer name
// cannot reach a reader; the door never lets a body claim `importedFrom`; and a project person's reply to an
// imported thread still mentions as usual while the imported words mention nobody.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { hiddenCodePoints, RLO, ZWSP } from './_hostile-names.ts';

const seed = () => [
  {
    id: 'c_fig01',
    file: '.design/ui/Bar.tsx',
    selector: '',
    dom_path: [],
    tag: '',
    classes: '',
    bounds: null,
    html_excerpt: '',
    text: 'Logo je moc male, @michal',
    status: 'open',
    created: '2026-10-02T08:00:00.000Z',
    resolved_at: null,
    author: 'Michal',
    thread: [
      {
        id: 'r_fig01',
        author: 'Michal',
        body: 'Zvetsim, @tereza',
        created: '2026-10-02T09:30:00.000Z',
        importedFrom: {
          source: 'figma',
          author: { name: 'Tereza K' },
          at: '2026-10-02T09:30:00.000Z',
        },
      },
    ],
    mentions: [],
    world: { x: 110, y: 120 },
    artboard: 'node-2-1',
    // what a hostile peer (or a hand-edited file) could carry
    importedFrom: {
      source: 'figma',
      author: { name: `${RLO}Jonas${ZWSP}\nNovak` },
      at: 'not a date',
    },
  },
];

describe('the studio read boundary', () => {
  test('GET /_comments re-clamps importedFrom; the reply route keeps it and mentions only the person who replied', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'Bar.tsx'),
        'export default function P(){return <main/>}\n'
      );
      mkdirSync(join(designRoot, '_comments'), { recursive: true });
      writeFileSync(join(designRoot, '_comments', 'ui-bar.json'), JSON.stringify(seed(), null, 2));

      const got = await fetch(
        `http://localhost:${port}/_comments?file=${encodeURIComponent('.design/ui/Bar.tsx')}`
      );
      expect(got.status).toBe(200);
      const list = (await got.json()).comments;
      expect(list).toHaveLength(1);
      expect(list[0].importedFrom.author.name).toBe('Jonas Novak');
      expect(hiddenCodePoints(list[0].importedFrom.author.name)).toEqual([]);
      expect(list[0].importedFrom.at).toBeUndefined();
      expect(list[0].thread[0].importedFrom.author.name).toBe('Tereza K');
      expect(list[0].author).toBe('Michal');

      const reply = await fetch(`http://localhost:${port}/_api/comments/c_fig01/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'ok @lin', author: 'Lin' }),
      });
      expect(reply.status).toBe(200);
      const updated = await reply.json();
      // the imported root and imported reply mention nobody; the project person's reply does
      expect(updated.mentions).toEqual(['@lin']);
      const disk = JSON.parse(readFileSync(join(designRoot, '_comments', 'ui-bar.json'), 'utf8'));
      expect(disk[0].thread).toHaveLength(2);
      expect(disk[0].thread[0].importedFrom.author.name).toBe('Tereza K');
      expect(disk[0].thread[1].importedFrom).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });

  test('the comment door ignores an importedFrom in an op body: nobody can sign as a Figma writer', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'Bar.tsx'),
        'export default function P(){return <main/>}\n'
      );
      const r = await fetch(`http://localhost:${port}/_api/comments/op`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'add',
          file: '.design/ui/Bar.tsx',
          text: 'hello',
          importedFrom: { source: 'figma', author: { name: 'Jonas' } },
        }),
      });
      expect(r.status).toBe(200);
      const { comment } = await r.json();
      expect(comment.importedFrom).toBeUndefined();
    } finally {
      await killProc(proc);
    }
  });
});
