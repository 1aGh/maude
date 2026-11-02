// /_api/fs-mkdir — feature-file-tree-drag-drop-folders (Task 4). Folder-name
// validation, containment, `.gitkeep`, collision.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateFolderName } from '../canvas-create.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('validateFolderName', () => {
  test('accepts ordinary names (letters, numbers, spaces, - and _)', () => {
    for (const n of ['Marketing', 'checkout-flow', 'Krok_1', 'Prihlaseni', 'Two words']) {
      const v = validateFolderName(n);
      expect(v.ok).toBe(true);
      expect(v.name).toBe(n);
    }
  });

  test('an accented folder name is refused with the accent-free suggestion (S1.23c)', () => {
    const v = validateFolderName('Přihlášení');
    expect(v.ok).toBe(false);
    expect(v.suggestion).toBe('Prihlaseni');
  });

  const REJECT: Array<[string, unknown]> = [
    ['empty', ''],
    ['non-string', 123],
    ['parent traversal', '../evil'],
    ['forward slash', 'a/b'],
    ['back slash', 'a\\b'],
    ['leading dot', '.hidden'],
    ['JSX break-out chars', 'a<b>'],
    ['double quote', 'a"b'],
    ['too long (61)', 'x'.repeat(61)],
  ];
  for (const [label, value] of REJECT) {
    test(`rejects ${label}`, () => {
      expect(validateFolderName(value).ok).toBe(false);
    });
  }
});

function mkdirReq(port: number, parent: string | undefined, name: string) {
  return fetch(`http://localhost:${port}/_api/fs-mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent, name }),
  });
}

describe('/_api/fs-mkdir — POST round-trip', () => {
  test('creates an empty folder with a .gitkeep', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await mkdirReq(port, 'ui', 'New Folder');
      expect(r.status).toBe(201);
      const j = (await r.json()) as { ok: boolean; dir: string };
      expect(j.ok).toBe(true);
      expect(j.dir).toBe('.design/ui/New Folder');
      expect(existsSync(join(designRoot, 'ui', 'New Folder'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', 'New Folder', '.gitkeep'))).toBe(true);
      expect(readFileSync(join(designRoot, 'ui', 'New Folder', '.gitkeep'), 'utf8')).toBe('');
    } finally {
      await killProc(proc);
    }
  });

  test('defaults parent to the design root when omitted', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      // "ui" IS a managed canvas group, so a folder directly under it works;
      // an omitted parent (designRoot itself) is NOT inside any canvas group
      // and must be refused — mirrors moveCanvas's group-membership rule.
      const r = await mkdirReq(port, undefined, 'Root Folder');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('supports nested parents', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      await mkdirReq(port, 'ui', 'Parent');
      const r = await mkdirReq(port, 'ui/Parent', 'Child');
      expect(r.status).toBe(201);
      expect(existsSync(join(designRoot, 'ui', 'Parent', 'Child', '.gitkeep'))).toBe(true);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses a parent that escapes the design root (400)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await mkdirReq(port, '../../../../tmp', 'Escape');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('refuses a parent inside the design-system group (400)', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'system'), { recursive: true });
      const r = await mkdirReq(port, 'system', 'NotAllowed');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects an invalid name (400)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await mkdirReq(port, 'ui', '../evil');
      expect(r.status).toBe(400);
    } finally {
      await killProc(proc);
    }
  });

  test('a collision with an existing folder returns 409', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui', 'Already'), { recursive: true });
      const r = await mkdirReq(port, 'ui', 'Already');
      expect(r.status).toBe(409);
    } finally {
      await killProc(proc);
    }
  });

  test('a collision with an existing FILE (not just a dir) also returns 409', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      mkdirSync(join(designRoot, 'ui'), { recursive: true });
      // NAME_RE forbids '.', so an extension-less file is the only way a
      // FILE can collide with a valid folder name — statp() must catch it
      // the same as a directory collision above.
      writeFileSync(join(designRoot, 'ui', 'Taken'), 'not a folder');
      const r = await mkdirReq(port, 'ui', 'Taken');
      expect(r.status).toBe(409);
    } finally {
      await killProc(proc);
    }
  });

  test('emits a canvas-list-update "mkdir" action over the inspector WS', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    let socket: WebSocket | null = null;
    try {
      const messages: Array<{ type: string; payload?: Record<string, unknown> }> = [];
      const sock = new WebSocket(`ws://localhost:${port}/_ws`);
      socket = sock;
      await new Promise<void>((res, rej) => {
        sock.addEventListener('open', () => res());
        sock.addEventListener('error', () => rej(new Error('ws error')));
        setTimeout(() => rej(new Error('ws open timeout')), 2000);
      });
      sock.addEventListener('message', (ev) => {
        try {
          messages.push(JSON.parse(String(ev.data)));
        } catch {
          /* ignore */
        }
      });
      const r = await mkdirReq(port, 'ui', 'Live Folder');
      expect(r.status).toBe(201);

      const deadline = Date.now() + 2000;
      let hit: (typeof messages)[number] | undefined;
      while (Date.now() < deadline && !hit) {
        hit = messages.find(
          (m) => m.type === 'canvas-list-update' && m.payload?.action === 'mkdir'
        );
        if (!hit) await Bun.sleep(25);
      }
      expect(hit?.payload?.dir).toBe('.design/ui/Live Folder');
    } finally {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      await killProc(proc);
    }
  }, 10_000);

  test('unknown method (GET) returns 405', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/fs-mkdir`, { method: 'GET' });
      expect(r.status).toBe(405);
    } finally {
      await killProc(proc);
    }
  });

  test('rejects a cross-origin mkdir (CSRF guard)', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const r = await fetch(`http://localhost:${port}/_api/fs-mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
        body: JSON.stringify({ parent: 'ui', name: 'Forged' }),
      });
      expect(r.status).toBe(403);
    } finally {
      await killProc(proc);
    }
  });

  // Security review finding — see the matching test in canvas-move-api.test.ts.
  test('refuses creating a folder under a symlinked parent', async () => {
    const { root, designRoot } = makeSandbox();
    const outside = join(root, 'OUTSIDE');
    mkdirSync(outside, { recursive: true });
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      symlinkSync(outside, join(designRoot, 'ui', 'link'));
      const r = await mkdirReq(port, 'ui/link', 'Nested');
      expect(r.status).toBe(400);
      expect(existsSync(join(outside, 'Nested'))).toBe(false);
    } finally {
      await killProc(proc);
    }
  });
});
