// /_api/annotations — Phase 5 GET / PUT round-trip + validation gates.
//
// Verifies:
//   - GET returns empty body for a canvas with no annotations file
//   - PUT writes `<designRoot>/<slug>.annotations.svg`
//   - GET subsequently returns the saved SVG
//   - PUT rejects non-SVG bodies (400)
//   - PUT rejects oversized bodies (>1 MB)
//   - Unknown method → 405

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SVG_OK =
  '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">' +
  '<path data-id="p1" data-tool="pen" stroke="#d63b1f" stroke-width="2" fill="none" d="M0 0 L10 10"/>' +
  '</svg>';

describe('/_api/annotations — GET/PUT', () => {
  test('accepts bounded write identities without changing SVG and rejects invalid identities', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const post = (writeId: unknown) =>
        fetch(`http://localhost:${port}/_api/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: '.design/ui/Identity.tsx', svg: SVG_OK, writeId }),
        });
      expect((await post('session-operation-1')).status).toBe(204);
      expect(readFileSync(join(designRoot, 'ui-identity.annotations.svg'), 'utf8')).toBe(SVG_OK);
      for (const invalid of ['', 'a'.repeat(97), {}, 17, '<script>']) {
        expect((await post(invalid)).status).toBe(400);
      }
      expect(readFileSync(join(designRoot, 'ui-identity.annotations.svg'), 'utf8')).toBe(SVG_OK);
    } finally {
      await killProc(proc);
    }
  });

  test('GET on a canvas with no annotations returns empty body (200)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'Phase5.tsx'),
        'export default function P(){return <main/>}\n'
      );
      const r = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent(
          '.design/ui/Phase5.tsx'
        )}`
      );
      expect(r.status).toBe(200);
      const body = await r.text();
      expect(body).toBe('');
    } finally {
      await killProc(proc);
    }
  });

  test('PUT writes <designRoot>/<slug>.annotations.svg and GET round-trips', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      writeFileSync(
        join(designRoot, 'ui', 'Round.tsx'),
        'export default function P(){return <main/>}\n'
      );
      const put = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/Round.tsx', svg: SVG_OK }),
      });
      expect(put.status).toBe(204);

      // File slug derives from the path under designRoot: `ui-round`.
      const written = join(designRoot, 'ui-round.annotations.svg');
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written, 'utf8')).toBe(SVG_OK);

      const get = await fetch(
        `http://localhost:${port}/_api/annotations?file=${encodeURIComponent(
          '.design/ui/Round.tsx'
        )}`
      );
      expect(get.status).toBe(200);
      expect(get.headers.get('content-type')).toContain('image/svg+xml');
      expect(await get.text()).toBe(SVG_OK);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT rejects non-SVG bodies with 400', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/X.tsx', svg: '<p>nope</p>' }),
      });
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT rejects missing file', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ svg: SVG_OK }),
      });
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('PUT rejects bodies above the 1 MB ceiling', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const huge = `<svg>${'x'.repeat(1024 * 1024 + 100)}</svg>`;
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: '.design/ui/X.tsx', svg: huge }),
      });
      // readJson throws on body too large → readJson returns null → 400.
      // saveAnnotations would also reject on length, so either path yields 400.
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('Unknown method (DELETE) returns 405', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/annotations`, {
        method: 'DELETE',
      });
      expect(r.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  });
});
