// V2-2.4b — `maude design exports list` and `exports again <id>` (contract V2-1.11 §5.3, S8).
// `again` re-submits a history entry through the same jobs path the Export sheet's "Export
// again" row uses (POST /_api/export-jobs, replayExportJob), waits for the job and writes the
// file inside the project. The UI ↔ verb payload parity is test/exports-again-parity.test.tsx.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const HISTORY = [
  {
    id: 'job-a',
    format: 'png',
    scope: 'artboard',
    options: { scale: 2, artboardId: 'a1' },
    filename: 'home.png',
    at: '2026-10-10T10:03:00.000Z',
    status: 'done',
  },
  { format: 'pdf', scope: 'project-raw', filename: 'home.pdf', at: '2026-10-10T10:02:00.000Z' },
];

function handler(opts: { fail?: boolean; filename?: string } = {}) {
  let polls = 0;
  return (s: Seen) => {
    if (s.path === '/_api/export-history') return json({ history: HISTORY });
    if (s.path === '/_api/export-jobs' && s.method === 'POST') return json({ jobId: 'new-1' }, 202);
    if (s.path === '/_api/export-jobs') {
      polls++;
      const status = polls < 2 ? 'running' : opts.fail ? 'failed' : 'done';
      return json({
        jobs: [
          {
            id: 'new-1',
            status,
            filename: opts.filename ?? 'home.png',
            error: opts.fail ? 'render failed' : undefined,
          },
        ],
      });
    }
    if (s.path === '/_api/export-jobs/download' && s.query.id === 'new-1')
      return new Response('PNGBYTES', { headers: { 'content-type': 'image/png' } });
  };
}

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});
const posts = (seen: Seen[]) => seen.filter((s) => s.method === 'POST');

describe('maude design exports list', () => {
  test('lists the history, newest first, read-only', async () => {
    studio = fakeStudio(handler());
    const r = await studio.run('exports', ['list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('job-a');
    expect(r.stdout).toContain('home.pdf');
    const j = await studio.run('exports', ['list', '--json']);
    expect(JSON.parse(j.stdout).history).toEqual(HISTORY);
    expect(posts(studio.seen)).toEqual([]);
  });
});

describe('maude design exports again', () => {
  test('by id: posts the replayed job, waits, writes the file into the project', async () => {
    studio = fakeStudio(handler());
    const r = await studio.run('exports', ['again', 'job-a', '--out', 'out/']);
    expect(r.code).toBe(0);
    expect(posts(studio.seen).map((s) => s.body)).toEqual([
      { format: 'png', scope: 'artboard', options: { scale: 2, artboardId: 'a1' } },
    ]);
    const file = join(studio.root, 'out', 'home.png');
    expect(readFileSync(file, 'utf8')).toBe('PNGBYTES');
  });

  test('by index, with the scope fallback (pdf × project-raw → pdf’s default scope)', async () => {
    studio = fakeStudio(handler());
    const r = await studio.run('exports', ['again', '1', '--no-wait', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).jobId).toBe('new-1');
    const body = posts(studio.seen)[0]?.body as { format: string; scope: string };
    expect(body.format).toBe('pdf');
    expect(body.scope).not.toBe('project-raw');
  });

  test('a server-supplied file name cannot leave the --out folder', async () => {
    studio = fakeStudio(handler({ filename: '../../escape.png' }));
    const r = await studio.run('exports', ['again', 'job-a', '--out', 'out/']);
    expect(r.code).toBe(0);
    expect(existsSync(join(studio.root, 'out', 'escape.png'))).toBe(true);
    expect(existsSync(join(studio.root, '..', 'escape.png'))).toBe(false);
  });

  test('--out outside the project is refused before anything is submitted (exit 2)', async () => {
    studio = fakeStudio(handler());
    const r = await studio.run('exports', ['again', 'job-a', '--out', '/etc/maude-x.png'], {
      CLAUDE_PROJECT_DIR: '',
    });
    expect(r.code).toBe(2);
    expect(posts(studio.seen)).toEqual([]);
  });

  test('a failed job exits 1 with its error; an unknown entry exits 1 before submitting', async () => {
    studio = fakeStudio(handler({ fail: true }));
    const r = await studio.run('exports', ['again', 'job-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('render failed');
    const miss = await studio.run('exports', ['again', 'nope']);
    expect(miss.code).toBe(1);
    expect(posts(studio.seen)).toHaveLength(1);
  });

  test('usage: unknown sub-verb or flag → 2, no request', async () => {
    studio = fakeStudio(handler());
    for (const args of [
      ['retry', 'x'],
      ['again'],
      ['again', 'job-a', '--cloud'],
      ['list', 'x'],
      [],
    ]) {
      const r = await studio.run('exports', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
    expect((await studio.run('exports', ['--help'])).code).toBe(0);
  });
});
