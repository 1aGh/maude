// `maude hub purge` against a stub hub: dry run, then confirm until done.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseList, runPurge } from './hub-purge.mjs';

function stubHub(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return { status: next.status, json: async () => next.json };
  };
  return { calls, fetchImpl };
}

function io(extra = {}) {
  let out = '';
  let err = '';
  return {
    env: { MAUDE_HUB_TOKEN: 'owner-token' },
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
    sleep: async () => {},
    get stdout() {
      return out;
    },
    get stderr() {
      return err;
    },
    ...extra,
  };
}

describe('maude hub purge', () => {
  it('the dry run lists the set and prints the exact confirm command', async () => {
    const hub = stubHub([
      {
        status: 200,
        json: {
          ok: true,
          dryRun: true,
          count: 3,
          bytes: 2048,
          sample: ['assets/a.png', 'assets/b.png'],
          missing: 0,
          confirm: 'TOKEN123',
          expiresAt: 0,
        },
      },
    ]);
    const o = io();
    const code = await runPurge({
      args: ['https://hub.example.test', '--prefix', 'assets/'],
      fetchImpl: hub.fetchImpl,
      ...o,
    });
    assert.equal(code, 0, o.stderr);
    assert.equal(hub.calls.length, 1);
    assert.equal(hub.calls[0].url, 'https://hub.example.test/api/file-purge');
    assert.deepEqual(hub.calls[0].body, { prefix: 'assets/', dryRun: true });
    assert.equal(hub.calls[0].init.headers.authorization, 'Bearer owner-token');
    assert.match(o.stdout, /nothing was deleted/i);
    assert.match(o.stdout, /3 file\(s\)/);
    assert.match(o.stdout, /assets\/a\.png/);
    assert.match(o.stdout, /--prefix assets\/ --confirm TOKEN123/);
  });

  it('the confirm runs batch after batch until the hub says done', async () => {
    const hub = stubHub([
      { status: 200, json: { ok: true, purged: 100, remaining: 50, done: false } },
      { status: 429, json: { ok: false, code: 'paced', retryAfterMs: 400 } },
      { status: 200, json: { ok: true, purged: 50, remaining: 0, done: true, trash: '_trash/x' } },
    ]);
    const o = io();
    const code = await runPurge({
      args: ['http://127.0.0.1:4400', '--prefix', 'assets/', '--confirm', 'TOKEN123'],
      fetchImpl: hub.fetchImpl,
      ...o,
    });
    assert.equal(code, 0, o.stderr);
    assert.equal(hub.calls.length, 3);
    assert.ok(hub.calls.every((c) => c.body.confirm === 'TOKEN123' && c.body.prefix === 'assets/'));
    assert.match(o.stdout, /Done\./);
  });

  it('stops with a non-zero exit when the set changed', async () => {
    const hub = stubHub([
      { status: 409, json: { ok: false, code: 'set-changed', error: 'the files changed' } },
    ]);
    const o = io();
    const code = await runPurge({
      args: ['https://hub.example.test', '--prefix', 'assets/', '--confirm', 'T'],
      fetchImpl: hub.fetchImpl,
      ...o,
    });
    assert.equal(code, 1);
    assert.match(o.stderr, /409/);
  });

  it('never sends the owner token over plain http to a remote host', async () => {
    const hub = stubHub([]);
    const o = io();
    const code = await runPurge({
      args: ['http://hub.example.test', '--prefix', 'assets/'],
      fetchImpl: hub.fetchImpl,
      ...o,
    });
    assert.equal(code, 2);
    assert.equal(hub.calls.length, 0);
  });

  it('needs the token in the environment, and exactly one set', async () => {
    const hub = stubHub([]);
    const noToken = io({ env: {} });
    assert.equal(
      await runPurge({
        args: ['https://h.test', '--prefix', 'a/'],
        fetchImpl: hub.fetchImpl,
        ...noToken,
      }),
      2
    );
    const both = io();
    assert.equal(
      await runPurge({
        args: ['https://h.test', '--prefix', 'a/', '--list', 'x'],
        fetchImpl: hub.fetchImpl,
        ...both,
      }),
      2
    );
    assert.equal(hub.calls.length, 0);
  });

  it('reads a --list file of paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'purge-cli-'));
    try {
      const file = join(dir, 'list.txt');
      writeFileSync(file, '# unused\nassets/a.png\n\nassets/b.png\n');
      const hub = stubHub([{ status: 200, json: { ok: true, dryRun: true, count: 0, bytes: 0 } }]);
      const o = io();
      const code = await runPurge({
        args: ['https://h.test', '--list', file],
        fetchImpl: hub.fetchImpl,
        ...o,
      });
      assert.equal(code, 0, o.stderr);
      assert.deepEqual(hub.calls[0].body, {
        paths: ['assets/a.png', 'assets/b.png'],
        dryRun: true,
      });
      assert.match(o.stdout, /Nothing to delete/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.deepEqual(parseList('["a/b.png", 3, ""]'), ['a/b.png']);
  });
});
