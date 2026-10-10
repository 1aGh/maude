// End-to-end bridge test against a mock ACP agent (test/fixtures/mock-acp-agent.mjs)
// so no real `claude` install is needed. Proves: spawn + handshake + streamed
// update + turn completion, AND that ANTHROPIC_API_KEY never reaches the child
// (DDR-123 guardrail #1, verified end-to-end — the mock echoes its own env).

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AcpBridge } from '../acp/bridge.ts';
import {
  getClaudeAuthStatus,
  probeAcpAvailability,
  probeAcpAvailabilityAuthed,
} from '../acp/probe.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent.mjs');
const TEST_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
];

afterEach(() => {
  for (const key of TEST_ENV_KEYS) delete process.env[key];
});

describe('AcpBridge — round-trip + subscription guardrail', () => {
  test('connects, streams an update, completes a turn, and scrubs ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-must-be-scrubbed';
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath; // run the mock under this bun
    process.env.MAUDE_CLAUDE_BIN = process.execPath; // satisfy the claude-present check

    const updates: unknown[] = [];
    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: (u) => updates.push(u) });
    try {
      const result = await bridge.prompt('hello', 'c1');
      expect(bridge.connected).toBe(true);
      expect(bridge.sessionId).toBe('mock-session-1');
      expect(result.stopReason).toBe('end_turn');

      // The mock streamed its own ANTHROPIC_API_KEY — it must read `<unset>`,
      // proving scrubAgentEnv stripped it from the child env before spawn.
      const streamed = JSON.stringify(updates);
      expect(streamed).toContain('apiKey=<unset>');
      expect(streamed).not.toContain('sk-must-be-scrubbed');
      // DDR-123 guardrail #2 — the bridge pins the adapter to the user's own
      // `claude` (here MAUDE_CLAUDE_BIN = this bun) via CLAUDE_CODE_EXECUTABLE, so
      // it never falls back to the unshipped ~210 MB native binary.
      expect(streamed).toContain(`claudeExe=${process.execPath}`);
      // V2-2.4b — the bridge marks its adapter (and so `claude` and every design-plugin hook it
      // runs) as the Maude chat: `maude design hook` tells it from a terminal Claude Code by this.
      expect(streamed).toContain('actor=maude-chat');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('model/effort are no longer env-at-spawn — a config change never respawns the running adapter', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;

    const updates: unknown[] = [];
    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: (u) => updates.push(u) });
    try {
      // A persisted pick this mock doesn't advertise (it has no configOptions at
      // all) is skipped best-effort, never forwarded to ANTHROPIC_MODEL/env.
      bridge.setConfig('opus', 'thorough');
      await bridge.prompt('hi', 'c1');
      const sid = bridge.sessionId;
      const first = JSON.stringify(updates);
      expect(first).toContain('model=<unset>');
      expect(first).toContain('thinking=<unset>');

      // Changing the config again must NOT tear down / respawn the live process
      // (Task A3 — the old configChanged()-triggered stop() is gone).
      updates.length = 0;
      bridge.setConfig(null, 'fast');
      await bridge.prompt('again', 'c1');
      expect(bridge.sessionId).toBe(sid); // same session — no respawn happened
      const second = JSON.stringify(updates);
      expect(second).toContain('model=<unset>');
      expect(second).toContain('thinking=<unset>');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('a second prompt reuses the same live session', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;

    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    try {
      await bridge.prompt('first', 'c1');
      const sid = bridge.sessionId;
      await bridge.prompt('second', 'c1');
      expect(bridge.sessionId).toBe(sid);
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('different chat ids get separate claude sessions; same id reuses its own', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;

    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    try {
      await bridge.prompt('a', 'chatA');
      const sa = bridge.sessionId;
      await bridge.prompt('b', 'chatB');
      const sb = bridge.sessionId;
      expect(sa).not.toBe(sb); // separate per-chat contexts
      await bridge.prompt('a again', 'chatA');
      expect(bridge.sessionId).toBe(sa); // chatA reuses its own session
    } finally {
      await bridge.stop();
    }
  }, 15000);
});

describe('AcpBridge — cross-restart session resume (DDR-125 gap)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test('a persisted sessionId resumes via loadSession instead of spawning a new session', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    dir = await mkdtemp(join(tmpdir(), 'acp-bridge-test-'));
    const storePath = join(dir, 'c1.session.json');
    await Bun.write(storePath, JSON.stringify({ sessionId: 'persisted-session-abc' }));

    const updates: unknown[] = [];
    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: (u) => updates.push(u) });
    try {
      bridge.setSessionStorePath(storePath);
      await bridge.prompt('pokracuj', 'c1');
      // Resumed the persisted id verbatim — never fell through to session/new
      // (which would have minted a fresh `mock-session-N`).
      expect(bridge.sessionId).toBe('persisted-session-abc');
      // The mock's replay notification must NOT reach the UI sink.
      expect(JSON.stringify(updates)).not.toContain('REPLAYED-HISTORY-SHOULD-NOT-SURFACE');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('a resume that fails (pruned session) falls back to newSession and re-persists the new id', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    dir = await mkdtemp(join(tmpdir(), 'acp-bridge-test-'));
    const storePath = join(dir, 'c1.session.json');
    await Bun.write(storePath, JSON.stringify({ sessionId: 'not-found' }));

    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    try {
      bridge.setSessionStorePath(storePath);
      await bridge.prompt('pokracuj', 'c1');
      expect(bridge.sessionId).toBe('mock-session-1'); // fresh session, not the stale id
      const stored = JSON.parse(await readFile(storePath, 'utf8'));
      expect(stored.sessionId).toBe('mock-session-1'); // re-persisted so the NEXT restart resumes it
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('no prior chat for this sidecar behaves exactly as before — a brand new session is created and persisted', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    dir = await mkdtemp(join(tmpdir(), 'acp-bridge-test-'));
    const storePath = join(dir, 'brand-new.session.json');

    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    try {
      bridge.setSessionStorePath(storePath);
      await bridge.prompt('hi', 'c1');
      expect(bridge.sessionId).toBe('mock-session-1');
      const stored = JSON.parse(await readFile(storePath, 'utf8'));
      expect(stored.sessionId).toBe('mock-session-1');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('no sidecar wired at all (e.g. a warm-up before any prompt) never touches disk and behaves exactly as before', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;

    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    try {
      // setSessionStorePath is never called — sessionStorePath stays null.
      await bridge.prompt('hi', 'c1');
      expect(bridge.sessionId).toBe('mock-session-1');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('a malformed persisted sessionId (not a plausible shape) is rejected — falls back to newSession', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    dir = await mkdtemp(join(tmpdir(), 'acp-bridge-test-'));
    const storePath = join(dir, 'c1.session.json');
    // Not a plausible sessionId shape (embedded newline + non-UUID charset) —
    // must never reach the wire as a `loadSession` sessionId.
    await Bun.write(storePath, JSON.stringify({ sessionId: 'evil\nsessionId; rm -rf /' }));

    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    try {
      bridge.setSessionStorePath(storePath);
      await bridge.prompt('hi', 'c1');
      expect(bridge.sessionId).toBe('mock-session-1'); // rejected — fresh session instead
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('warm and prompt racing for the same chat share one resume attempt (no replaying race)', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    dir = await mkdtemp(join(tmpdir(), 'acp-bridge-test-'));
    const storePath = join(dir, 'c1.session.json');
    await Bun.write(storePath, JSON.stringify({ sessionId: 'persisted-race-session' }));

    const updates: unknown[] = [];
    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: (u) => updates.push(u) });
    try {
      bridge.setSessionStorePath(storePath);
      // Fire warmUp and prompt concurrently for the same chatId — both call
      // sessionFor('c1') before either has resolved.
      const [, result] = await Promise.all([bridge.warmUp('c1'), bridge.prompt('pokracuj', 'c1')]);
      expect(bridge.sessionId).toBe('persisted-race-session');
      expect(result.stopReason).toBe('end_turn');
      // Only ONE resume attempt happened — the mock's replay text never leaked,
      // and the prompt's own turn still streamed normally.
      expect(JSON.stringify(updates)).not.toContain('REPLAYED-HISTORY-SHOULD-NOT-SURFACE');
    } finally {
      await bridge.stop();
    }
  }, 15000);
});

describe('probeAcpAvailability — not-connected detection', () => {
  test('reports not-available with a Claude-Code reason when the CLI is absent', () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = join(import.meta.dir, 'no-such-claude-bin');
    const probe = probeAcpAvailability();
    expect(probe.available).toBe(false);
    expect(probe.reason ?? '').toMatch(/Claude Code/i);
  });

  test('reports available when both the adapter and a claude binary resolve', () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    const probe = probeAcpAvailability();
    expect(probe.available).toBe(true);
    expect(probe.adapterEntry).toBe(FIXTURE);
  });
});

describe('probeAcpAvailabilityAuthed — DDR-166 T0d, logged-out must not read as available', () => {
  const AUTH_FIXTURE = join(import.meta.dir, 'fixtures', 'fake-claude-auth.mjs');

  afterEach(() => {
    delete process.env.FAKE_CLAUDE_LOGGED_IN;
    delete process.env.FAKE_CLAUDE_STDOUT_NOISE;
  });

  test('installed but NOT signed in reports available:false (the bug this closes)', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = AUTH_FIXTURE;
    process.env.FAKE_CLAUDE_LOGGED_IN = '0';
    const probe = await probeAcpAvailabilityAuthed();
    expect(probe.available).toBe(false);
    expect(probe.reason ?? '').toMatch(/signed in/i);
  });

  test('installed AND signed in reports available:true', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = AUTH_FIXTURE;
    process.env.FAKE_CLAUDE_LOGGED_IN = '1';
    const probe = await probeAcpAvailabilityAuthed();
    expect(probe.available).toBe(true);
  });

  test('not installed still reports the plain not-installed reason (no auth spawn attempted)', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = join(import.meta.dir, 'no-such-claude-bin');
    const probe = await probeAcpAvailabilityAuthed();
    expect(probe.available).toBe(false);
    expect(probe.reason ?? '').toMatch(/Claude Code/i);
  });

  // Issue #107 — the reported `claude` was a mise shim printing a banner to
  // STDOUT before the JSON. Parsing the whole blob threw, the catch returned
  // null, and a signed-in user was told they were signed out.
  test('signed in through a stdout-noisy shim still reports available:true (#107)', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = AUTH_FIXTURE;
    process.env.FAKE_CLAUDE_LOGGED_IN = '1';
    process.env.FAKE_CLAUDE_STDOUT_NOISE = '1';
    const probe = await probeAcpAvailabilityAuthed();
    expect(probe.available).toBe(true);
  });

  test('an UNREADABLE status says so — it does not accuse the user of being signed out (#107)', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = join(import.meta.dir, 'fixtures', 'noisy-claude-auth.mjs');
    process.env.FAKE_CLAUDE_OUT = 'mise: something went sideways\nno json here\n';
    try {
      const probe = await probeAcpAvailabilityAuthed();
      expect(probe.available).toBe(false);
      expect(probe.reason ?? '').toContain("couldn't read");
      expect(probe.reason ?? '').not.toMatch(/not signed in/i);
    } finally {
      delete process.env.FAKE_CLAUDE_OUT;
    }
  });

  test('signed OUT through a stdout-noisy shim is still reported as signed out (no false positive)', async () => {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_CLAUDE_BIN = AUTH_FIXTURE;
    process.env.FAKE_CLAUDE_LOGGED_IN = '0';
    process.env.FAKE_CLAUDE_STDOUT_NOISE = '1';
    const probe = await probeAcpAvailabilityAuthed();
    expect(probe.available).toBe(false);
    expect(probe.reason ?? '').toMatch(/signed in/i);
  });
});

// Issue #107 — direct coverage of the stdout shape tolerated by the auth probe.
// A wrapper on PATH (mise/asdf/volta, corporate `bin` shims) can prepend noise
// to stdout; the fast path (clean JSON) and the honest failure (nothing
// parseable → null) both have to keep working alongside it.
describe('getClaudeAuthStatus — wrapper-stdout tolerance', () => {
  const NOISY = join(import.meta.dir, 'fixtures', 'noisy-claude-auth.mjs');

  afterEach(() => {
    delete process.env.FAKE_CLAUDE_OUT;
    delete process.env.FAKE_CLAUDE_HEAD;
    delete process.env.FAKE_CLAUDE_PAD_BYTES;
    delete process.env.FAKE_CLAUDE_TAIL;
  });

  const statusFor = async (stdout: string) => {
    process.env.MAUDE_CLAUDE_BIN = NOISY;
    process.env.FAKE_CLAUDE_OUT = stdout;
    return getClaudeAuthStatus();
  };

  const PAYLOAD = '{"loggedIn":true,"apiProvider":"firstParty","subscriptionType":"max"}';

  test('clean JSON — the unchanged fast path', async () => {
    expect(await statusFor(PAYLOAD)).toEqual({
      loggedIn: true,
      apiProvider: 'firstParty',
      subscriptionType: 'max',
    });
  });

  test('a banner line ahead of the JSON (the reported mise shim)', async () => {
    const out = `mise ~/.config/mise/config.toml tools: claude@2.1.246\n${PAYLOAD}`;
    expect((await statusFor(out))?.loggedIn).toBe(true);
  });

  test('noise carrying braces of its own does not outrank the real payload', async () => {
    const out = `warning: {"loggedIn":false} is not a real status\nresolving {claude}\n${PAYLOAD}`;
    expect((await statusFor(out))?.subscriptionType).toBe('max');
  });

  test('trailing noise after the JSON', async () => {
    expect((await statusFor(`${PAYLOAD}\nmise: done in 12ms\n`))?.loggedIn).toBe(true);
  });

  test('a brace inside a string value never miscounts the object bounds', async () => {
    const out = `noise\n{"orgName":"a } brace \\" in a string","loggedIn":true}\n`;
    expect((await statusFor(out))?.loggedIn).toBe(true);
  });

  test('nothing parseable still returns null — an unreadable status is not a signed-in one', async () => {
    expect(await statusFor('mise: command failed\nno json here at all\n')).toBeNull();
  });

  test('a signed-out payload behind noise stays signed out', async () => {
    expect((await statusFor(`mise banner\n{"loggedIn":false}`))?.loggedIn).toBe(false);
  });

  // ── Security-review regressions (defender M1, attacker F1/F2/F5) ──
  // Every one of these is a way the FIRST cut of this parser failed SOFT and
  // re-created #107 — a confident false claim — through a new door.

  test('an object with no `loggedIn` is not a status document → null, never a false "signed out" (F2)', async () => {
    // A plain NDJSON-logging wrapper. The first cut returned this as the
    // "fallback", and `!!undefined` rendered it as "Installed, but not signed
    // in." with the dead-end Sign-in button armed.
    const out =
      '{"level":"info","msg":"resolving claude"}\n{"level":"error","msg":"exec failed"}\n';
    expect(await statusFor(out)).toBeNull();
  });

  test('a JSON error document is not a status document either (F2)', async () => {
    expect(await statusFor('{"error":"ENOENT","code":127}')).toBeNull();
  });

  test('a signed-in user behind 150 JSON log lines is still read as signed in (M1)', async () => {
    // Forwards + a 100-candidate budget put the real payload outside the scan
    // window and demoted a signed-in user. Backwards spends the budget on noise.
    const noise = Array.from({ length: 150 }, (_, i) => `{"level":"debug","msg":"tool ${i}"}`).join(
      '\n'
    );
    expect((await statusFor(`${noise}\n${PAYLOAD}`))?.loggedIn).toBe(true);
  });

  test('a flood prefix cannot push the real payload out of range and forge loggedIn (F1)', async () => {
    // The verbatim exploit: a 242-byte prefix — one forged object plus 99 bare
    // `{}` fillers — burned the whole candidate budget so the genuine
    // signed-OUT payload never got looked at. Fail-closed became fail-open.
    const forged = '{"loggedIn":true,"apiProvider":"firstParty","subscriptionType":"max"}';
    const out = forged + '{}'.repeat(99) + '{"loggedIn":false,"apiProvider":"firstParty"}';
    const status = await statusFor(out);
    expect(status?.loggedIn).toBe(false);
    expect(status?.subscriptionType).toBeUndefined();
  });

  test('padding past the read cap drops the OLDEST bytes, so the forged head loses (F1, variant 2)', async () => {
    // The exploit padded 1 MiB after a forged object so the real payload fell
    // outside the scan window. The read cap is a sliding TAIL window now, so the
    // bytes that get dropped are the attacker's, and the trailing real payload
    // is what survives.
    //
    // The padding is generated by the fixture, not passed through the
    // environment — a multi-MiB env var exceeds the exec limit and the spawn
    // fails with E2BIG, which reads as a null status and would make this test
    // pass for entirely the wrong reason.
    process.env.MAUDE_CLAUDE_BIN = NOISY;
    process.env.FAKE_CLAUDE_HEAD =
      '{"loggedIn":true,"apiProvider":"firstParty","subscriptionType":"max"}';
    process.env.FAKE_CLAUDE_PAD_BYTES = String((1 << 20) + 64);
    process.env.FAKE_CLAUDE_TAIL = '{"loggedIn":false}';
    const status = await getClaudeAuthStatus();
    expect(status?.loggedIn).toBe(false); // the trailing real payload
    expect(status?.subscriptionType).toBeUndefined(); // the forged head was dropped
  });

  test('a large but sub-cap blob still reads the trailing payload', async () => {
    const out = `${'noise\n'.repeat(20000)}${PAYLOAD}`; // ~120 kB, well under the cap
    expect((await statusFor(out))?.subscriptionType).toBe('max');
  });

  test('a `{` at index 0 that does not parse costs one candidate, not the whole budget (R2-1)', async () => {
    // `lastIndexOf(needle, -1)` clamps to 0, so index 0 was re-tested for the
    // rest of the budget — a 116x cost amplification measured at ~2.2 s of
    // blocked event loop per probe, at a 1.5-2 s poll cadence. The payload must
    // still be found, and fast.
    const out = `{unparseable at index zero\n${PAYLOAD}`;
    const started = Date.now();
    expect((await statusFor(out))?.subscriptionType).toBe('max');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('a payload whose `{` IS index 0 is still found (the R2-1 fix must not skip it)', async () => {
    expect((await statusFor(PAYLOAD))?.subscriptionType).toBe('max');
  });

  test('the read cap drops the exact overflow, not a whole chunk (R3-2)', async () => {
    // Chunk-granular shifting over-dropped up to `sizeof(oldest chunk) - 1` —
    // 262 144 B measured for a 150-byte overflow against a real Bun pipe. Here
    // the payload sits 50 bytes into the stream and the stream is 10 bytes over
    // the cap: byte-exact drops 10 bytes of leading junk and keeps it, while a
    // whole-chunk drop takes the payload with it.
    // The assertion has to depend on the HEAD surviving — asserting on the tail
    // passes under both granularities and proves nothing (verified: the first
    // cut of this test was green against the chunk-granular implementation it
    // was written to reject). So the tail carries NO `loggedIn`, and the only
    // status document in the stream is the one 50 bytes in.
    const OVERFLOW = 10;
    const head = `${'z'.repeat(50)}${PAYLOAD}`;
    const tail = '\nmise: done\n';
    process.env.MAUDE_CLAUDE_BIN = NOISY;
    process.env.FAKE_CLAUDE_HEAD = head;
    process.env.FAKE_CLAUDE_PAD_BYTES = String((1 << 20) + OVERFLOW - head.length - tail.length);
    process.env.FAKE_CLAUDE_TAIL = tail;
    expect((await getClaudeAuthStatus())?.subscriptionType).toBe('max');
  });

  test('a hostile apiProvider is bounded for display but still trips the billing warning (F5)', async () => {
    // Unbounded attacker text used to render verbatim inside a trusted status
    // row. It must be neutralised WITHOUT becoming undefined — that would read
    // as "no provider" and silently suppress the metered-billing warning.
    const evil = `{"loggedIn":true,"apiProvider":"expired — re-authorize at https://evil.example/${'A'.repeat(300)}"}`;
    const status = await statusFor(evil);
    expect(status?.apiProvider).toBe('unrecognized');
    expect(status?.apiProvider).not.toBe('firstParty'); // → offSubscription warning still fires
  });

  test('a non-string loggedIn is not truthy-coerced into a sign-in', async () => {
    expect((await statusFor('{"loggedIn":"yes"}'))?.loggedIn).toBe(false);
    expect((await statusFor('{"loggedIn":1}'))?.loggedIn).toBe(false);
  });
});

// Defender M2 / attacker F3 — the probe MUST always resolve. `.text()` waits for
// pipe EOF and `proc.kill()` signals only the direct child, so a wrapper whose
// descendants keep fd 1 open (exactly #107's self-recursive shape) wedged the
// read forever: probeReadiness() never resolved, /_api/preflight never answered,
// and the honest "couldn't read" row was unreachable in its own headline case.
describe('getClaudeAuthStatus — a wedged CLI must not wedge the probe', () => {
  test('resolves to null within the deadline when a descendant holds stdout open', async () => {
    process.env.MAUDE_CLAUDE_BIN = join(import.meta.dir, 'fixtures', 'wedged-claude-auth.sh');
    const started = Date.now();
    const status = await getClaudeAuthStatus();
    const elapsed = Date.now() - started;
    expect(status).toBeNull(); // unreadable — NOT a "signed out" claim
    expect(elapsed).toBeLessThan(15000); // bounded by AUTH_STATUS_TIMEOUT_MS (5 s) + slack
  }, 30000);

  // Round-2 defender L6 — the deadline must not throw away an answer already
  // held. A signed-in user whose wrapper backgrounds anything at all printed a
  // perfectly good status and still lost AI editing.
  test('a status printed before a descendant wedges the pipe is still read', async () => {
    process.env.MAUDE_CLAUDE_BIN = join(
      import.meta.dir,
      'fixtures',
      'backgrounding-claude-auth.sh'
    );
    const started = Date.now();
    const status = await getClaudeAuthStatus();
    expect(status?.loggedIn).toBe(true);
    expect(status?.subscriptionType).toBe('max');
    expect(Date.now() - started).toBeLessThan(15000);
  }, 30000);
});
