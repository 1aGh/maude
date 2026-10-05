// The change signal, hub side (2026-10-05, "an idle desktop lets its cloud
// cell sleep"). The hub tells its own cell's DO that content changed, so a
// parked desktop's `/_cell/state` probe can see it without waking anything.
//
// Pinned: throttled to one send per window with a trailing send for a burst;
// never blocks or throws into the write path; bounded retry; a self-hosted hub
// (no store URL) does nothing; the control document never counts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  CHANGE_SIGNAL_MIN_MS,
  CHANGE_SIGNAL_PATH,
  createCellChangeSignal,
} from '../src/cell-change-signal.mjs';

/** A manual clock + timer queue, so throttling is tested without waiting. */
function harness({ ok = true } = {}) {
  let t = 1_000_000;
  const timers = [];
  const calls = [];
  let answer = ok;
  const sig = createCellChangeSignal({
    url: 'http://project-store.internal/',
    now: () => t,
    setTimeoutImpl: (fn, ms) => {
      const timer = { fn, at: t + ms, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => {
      const i = timers.indexOf(timer);
      if (i >= 0) timers.splice(i, 1);
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init, at: t });
      if (answer instanceof Error) throw answer;
      return { ok: answer };
    },
    log: { warn() {} },
  });
  const flush = () => new Promise((r) => setImmediate(r));
  return {
    sig,
    calls,
    setAnswer: (a) => {
      answer = a;
    },
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        t = Math.max(t, due.at);
        due.fn();
        await flush();
      }
      t = target;
      await flush();
    },
    flush,
  };
}

describe('createCellChangeSignal', () => {
  it('the first change goes at once, to the store host', async () => {
    const h = harness();
    h.sig.note();
    await h.flush();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, `http://project-store.internal${CHANGE_SIGNAL_PATH}`);
    assert.equal(h.calls[0].init.method, 'POST');
  });

  it('a burst is one send now and one trailing send, at most one per window', async () => {
    const h = harness();
    h.sig.note();
    await h.flush();
    for (let i = 0; i < 50; i += 1) {
      await h.advance(100);
      h.sig.note();
    }
    assert.equal(h.calls.length, 1);
    await h.advance(CHANGE_SIGNAL_MIN_MS);
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls[1].at - h.calls[0].at >= CHANGE_SIGNAL_MIN_MS);
    await h.advance(CHANGE_SIGNAL_MIN_MS * 3);
    assert.equal(h.calls.length, 2, 'nothing new, nothing sent');
  });

  it('note() never throws and never waits, even when the store is down', async () => {
    const h = harness();
    h.setAnswer(new Error('ECONNREFUSED'));
    assert.doesNotThrow(() => h.sig.note());
    await h.flush();
    // Bounded retry, then it gives up until the next change.
    await h.advance(60_000);
    assert.equal(h.calls.length, 3);
    assert.equal(h.sig.failed(), 1);
    await h.advance(600_000);
    assert.equal(h.calls.length, 3);
  });

  it('a self-hosted hub (no store URL) does nothing', async () => {
    let called = false;
    const sig = createCellChangeSignal({
      url: null,
      fetchImpl: async () => {
        called = true;
        return { ok: true };
      },
    });
    sig.note();
    await new Promise((r) => setImmediate(r));
    assert.equal(called, false);
    assert.equal(sig.enabled(), false);
  });

  it('stop() cancels a pending trailing send', async () => {
    const h = harness();
    h.sig.note();
    await h.flush();
    h.sig.note();
    h.sig.stop();
    await h.advance(CHANGE_SIGNAL_MIN_MS * 2);
    assert.equal(h.calls.length, 1);
  });
});

describe('wiring', () => {
  const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  it('document changes signal — never the control document', () => {
    assert.match(
      src,
      /async onChange\(\{ documentName \}\) \{\n\s+if \(!isFilesCtlDoc\(documentName\)\) cellChange\.note\(\);/
    );
  });
  it('journal appends signal', () => {
    assert.match(src, /filesPoke\.schedule\(journal\.head\(\)\);\n\s+cellChange\.note\(\);/);
  });
  it('the store URL is the only switch', () => {
    assert.match(src, /createCellChangeSignal\(\{\n\s+url: process\.env\.MAUDE_PROJECT_STORE_URL/);
  });
});
