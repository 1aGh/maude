// V2-2.8 S5 — an export job belongs to the member who asked for it.
//
// One studio process serves every member of a cell (DDR-209), and the export
// job queue kept ONE list: `GET /_api/export-jobs` returned every member's
// jobs, `/download?id=` served any job's bytes to anyone holding the id (which
// the list handed out), `/_api/export-history` showed everyone's exports, and
// the `export:job` socket push reached every member's shell. V2-1.16 L7 files
// this as an "everyone-fix": it leaks other members' work whatever the role.
//
// The proxy already vouches WHO each request is (`x-maude-session`, minted per
// member at sign-in — session-scope.ts). Jobs are now stamped with it, and every
// read is filtered to it. An invisible job answers exactly like a missing one
// (V2-1.16 U1): the same 404 body as an id that never existed. No role sees
// another member's jobs — V2-1.7 grants no owner exception for them.
//
// The desktop answer is unchanged (no session header ⇒ one shared list), which
// the existing exporters/jobs.test.ts and exporters/history.test.ts pin.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const ALICE = 'aaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbb';
const CAROL = 'cccccccccccccccc'; // the project owner

function as(session: string, role = 'member') {
  return { 'x-maude-session': session, 'x-maude-role': role, 'x-maude-readonly': '0' };
}

const WORKSPACE_ENV = {
  MAUDE_WORKSPACE_MODE: '1',
  // A dev checkout resolves Playwright (a devDependency) — see
  // session-runtime-state.test.ts for why the containment assert needs this.
  MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
  MAUDE_NO_AUTOBUILD: '1',
};

interface Job {
  id: string;
  status: string;
}

async function jobsOf(base: string, session: string, role?: string): Promise<Job[]> {
  const r = await fetch(`${base}/_api/export-jobs`, { headers: as(session, role) });
  expect(r.status).toBe(200);
  return ((await r.json()) as { jobs: Job[] }).jobs;
}

async function historyOf(base: string, session: string): Promise<Array<{ id?: string }>> {
  const r = await fetch(`${base}/_api/export-history`, { headers: as(session) });
  expect(r.status).toBe(200);
  return ((await r.json()) as { history: Array<{ id?: string }> }).history;
}

async function download(base: string, session: string, id: string) {
  const r = await fetch(`${base}/_api/export-jobs/download?id=${encodeURIComponent(id)}`, {
    headers: as(session),
  });
  return { status: r.status, body: await r.text() };
}

/** Collect every `export:job` frame one member's shell socket receives. */
function listen(
  port: number,
  session: string
): { frames: string[]; close(): void; ready: Promise<void> } {
  const frames: string[] = [];
  const ws = new WebSocket(`ws://localhost:${port}/_ws`, {
    headers: as(session),
  } as unknown as string[]);
  const ready = new Promise<void>((resolve) => {
    ws.addEventListener('open', () => resolve());
  });
  ws.addEventListener('message', (ev) => {
    const text = String(ev.data);
    if (text.includes('"export:job"')) frames.push(text);
  });
  return { frames, close: () => ws.close(), ready };
}

describe('export jobs are scoped to the requesting member (V2-2.8 S5)', () => {
  test("a member never lists, downloads, or hears another member's export", async () => {
    const { root, designRoot } = makeSandbox();
    let port = nextPort();
    let proc = await bootServer(root, port, WORKSPACE_ENV);
    try {
      let base = `http://localhost:${port}`;
      const aliceWs = listen(port, ALICE);
      const bobWs = listen(port, BOB);
      await Promise.all([aliceWs.ready, bobWs.ready]);

      // Alice exports the project as a ZIP (browser-free, runs in any lane).
      const start = await fetch(`${base}/_api/export-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...as(ALICE) },
        body: JSON.stringify({ format: 'zip', scope: 'project-raw' }),
      });
      expect(start.status).toBe(202);
      const { jobId } = (await start.json()) as { jobId: string };

      const deadline = Date.now() + 15_000;
      let done = false;
      while (Date.now() < deadline && !done) {
        done = (await jobsOf(base, ALICE)).some((j) => j.id === jobId && j.status === 'done');
        if (!done) await Bun.sleep(25);
      }
      expect(done).toBe(true);
      await Bun.sleep(100); // let the last socket frame land

      // Alice: her job, her bytes, her history row, her socket frames.
      expect((await jobsOf(base, ALICE)).map((j) => j.id)).toContain(jobId);
      expect((await download(base, ALICE, jobId)).status).toBe(200);
      expect((await historyOf(base, ALICE)).map((h) => h.id)).toContain(jobId);
      expect(aliceWs.frames.some((f) => f.includes(jobId))).toBe(true);

      // Bob: nothing — and the refusal looks exactly like a missing id (U1).
      expect((await jobsOf(base, BOB)).map((j) => j.id)).not.toContain(jobId);
      const missing = await download(base, BOB, crypto.randomUUID());
      const hidden = await download(base, BOB, jobId);
      expect(hidden).toEqual(missing);
      expect(hidden.status).toBe(404);
      expect((await historyOf(base, BOB)).map((h) => h.id)).not.toContain(jobId);
      expect(bobWs.frames.some((f) => f.includes(jobId))).toBe(false);

      // The owner role carries no exception for other members' jobs (V2-1.7).
      expect((await jobsOf(base, CAROL, 'owner')).map((j) => j.id)).not.toContain(jobId);

      aliceWs.close();
      bobWs.close();

      // Ownership survives a restart: the ledger remembers whose row it is.
      await killProc(proc);
      port = nextPort();
      proc = await bootServer(root, port, WORKSPACE_ENV);
      base = `http://localhost:${port}`;
      expect((await historyOf(base, ALICE)).map((h) => h.id)).toContain(jobId);
      expect((await historyOf(base, BOB)).map((h) => h.id)).not.toContain(jobId);

      // …and the ledger's PUBLIC rows never carry the session key itself.
      const aliceRow = (await historyOf(base, ALICE)).find((h) => h.id === jobId);
      expect(JSON.stringify(aliceRow)).not.toContain(ALICE);
      expect(readFileSync(join(designRoot, '_export-history.json'), 'utf8')).toContain(jobId);
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
