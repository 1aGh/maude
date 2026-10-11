// _fake-studio.ts — a throwaway project plus a loopback "studio" that answers the routes a
// `maude design <verb>` helper calls (V2-2.4b history / comments / exports verbs).
//
// The project has `.design/config.json` and a `_server.json` naming this process's pid and the
// fake's port; `/_health` names the project's rootId, so cli/lib/studio-locate.mjs accepts it.
// Every request is recorded. The helper runs as a CHILD (async Bun.spawn — a sync spawn would
// block the event loop this server answers on).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rootIdentity } from '../../../cli/lib/studio-locate.mjs';

export interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}
export type Handler = (req: Seen) => Response | Promise<Response> | undefined;

export const json = (v: unknown, status = 200) => Response.json(v, { status });

export function fakeStudio(handler: Handler) {
  const root = mkdtempSync(join(tmpdir(), 'maude-verb-'));
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(join(root, '.design', 'config.json'), '{}');
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/_health') return json({ app: 'design', rootId: rootIdentity(root) });
      const text = req.method === 'GET' ? '' : await req.text();
      const s: Seen = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: text ? JSON.parse(text) : undefined,
      };
      seen.push(s);
      return (await handler(s)) ?? new Response('not found', { status: 404 });
    },
  });
  writeFileSync(
    join(root, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port: server.port })
  );
  const BIN = join(import.meta.dir, '..', 'bin');
  async function run(verb: string, args: string[], env: Record<string, string> = {}) {
    const p = Bun.spawn(['bash', join(BIN, `${verb}.sh`), ...args, '--root', root], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { stdout, stderr, code };
  }
  return {
    root,
    seen,
    run,
    stop() {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
