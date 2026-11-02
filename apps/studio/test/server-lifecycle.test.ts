// Smoke: boot → /_health 200 → _server.json written → shutdown.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { actionsManifestVersion } from '../actions/manifest-version.ts';
import { rootIdentity } from '../http.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('server lifecycle', () => {
  test('boots, writes _server.json, responds to /_health', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const h = await fetch(`http://localhost:${port}/_health`);
      expect(h.status).toBe(200);
      const body = (await h.json()) as { ok: boolean; app: string; rootId: string };
      expect(body.ok).toBe(true);
      expect(body.app).toBe('design');
      // Cloud Phase 27 D5 — the supervisor asks this route WHICH TREE it is
      // serving, and kills a child that answers about another one. That check
      // is only worth anything if both ends compute the identity the same way,
      // which is what this asserts: the hash the server reports for the root it
      // resolved is the hash the supervisor would compute for the root it
      // handed over. And it is a hash, not the path — this route is on the
      // untrusted canvas origin's allowlist.
      expect(body.rootId).toBe(rootIdentity(root));
      expect(body.rootId).not.toContain('/');
      // V2-1.11 §5.6 — the app side of the app↔plugin↔CLI handshake: the design plugin's
      // session-start hook compares its bundled manifest copy with these two.
      const hs = body as unknown as { manifestVersion?: unknown; version?: unknown };
      expect(hs.manifestVersion).toBe(actionsManifestVersion());
      expect(typeof hs.version).toBe('string');

      const info = await Bun.file(join(designRoot, '_server.json')).json();
      expect(info.port).toBe(port);
      expect(info.pid).toBeGreaterThan(0);
      expect(info.url).toBe(`http://localhost:${port}`);
    } finally {
      await killProc(proc);
    }
  });
});
