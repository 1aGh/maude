// P8 e2e live lanes — the SCRIPTED fake agent (apps/desktop/e2e/fixtures/fake-acp/scripted-agent.mjs) proven against
// the REAL AcpBridge, offline. The desktop e2e lanes that used to need a signed-in `claude` (acp-capability-picker,
// acp-write-scope, ai-quit) run on this agent, so the agent must do exactly what those specs rely on:
//   • a live mode roster (default / acceptEdits / plan) that a `set-mode` round-trips, reported back by a
//     config_option_update the bridge cross-derives into `currentModeId`;
//   • an in-project write that the bridge's gate approves with NO card, and an outside write it raises one for —
//     with the target resolved to an absolute path — while nothing is ever written outside the project;
//   • a shell call that waits for the person (Needs you);
//   • long turns (forty slow edits, a long stream) that Stop ends at once, keeping the partial work;
//   • a session that loads again after the app relaunches.
// No `claude`, no network, no home-directory write: the project is a temp dir and the outside probe is rejected.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { RequestPermissionRequest, SessionModeState } from '@agentclientprotocol/sdk';

import { AcpBridge, type PermissionScopeInfo } from '../acp/bridge.ts';

const AGENT = resolve(import.meta.dir, '../../desktop/e2e/fixtures/fake-acp/scripted-agent.mjs');
const TEST_ENV_KEYS = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'FAKE_ACP_SDK',
];

let tmp: string;
let project: string;
let canvas: string;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-scripted-agent-')));
  project = join(tmp, 'project');
  canvas = join(project, '.design', 'ui', 'home.tsx');
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  writeFileSync(canvas, 'export default function Home() { return null; }\n');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const key of TEST_ENV_KEYS) delete process.env[key];
});

function useScriptedAgent() {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = AGENT;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  process.env.FAKE_ACP_SDK = Bun.resolveSync('@agentclientprotocol/sdk', import.meta.dir);
}

interface Card {
  id: string;
  req: RequestPermissionRequest;
  scope?: PermissionScopeInfo;
}

function makeBridge(onCard?: (c: Card, bridge: AcpBridge) => string | undefined) {
  const cards: Card[] = [];
  const modes: SessionModeState[] = [];
  const updates: string[] = [];
  const bridge: AcpBridge = new AcpBridge({
    repoRoot: project,
    readBoundary: [project],
    permissionTimeoutMs: 8000,
    onUpdate: (u) => {
      const t = (u as { content?: { text?: string } }).content?.text;
      if (t) updates.push(t);
    },
    onCaps: (m) => {
      if (m) modes.push(m);
    },
    onPermissionRequest: (id, req, scope) => {
      const c = { id, req, scope };
      cards.push(c);
      const answer = onCard?.(c, bridge);
      if (answer) bridge.resolvePermission(id, answer);
    },
  });
  return { bridge, cards, modes, updates };
}

const until = async <T>(fn: () => T | undefined, ms = 15000): Promise<T> => {
  const t0 = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('scripted fake agent — the mode roster is live', () => {
  test('the session offers default / acceptEdits / plan, and set-mode round-trips with no respawn', async () => {
    useScriptedAgent();
    const { bridge, modes } = makeBridge();
    try {
      await bridge.warmUp('c1');
      const first = await until(() => modes[modes.length - 1]);
      expect(first.currentModeId).toBe('default');
      expect(first.availableModes.map((m) => m.id)).toEqual(['default', 'acceptEdits', 'plan']);
      const pid = (bridge as unknown as { proc?: { pid?: number } }).proc?.pid;

      await bridge.setMode('c1', 'plan');
      await until(() => (modes[modes.length - 1].currentModeId === 'plan' ? true : undefined));
      expect((bridge as unknown as { proc?: { pid?: number } }).proc?.pid).toBe(pid);

      // An id the roster does not offer is refused by the agent (the bridge's caller checks the roster first).
      await expect(bridge.setMode('c1', 'bogus')).rejects.toThrow();
    } finally {
      await bridge.stop();
    }
  }, 20000);
});

describe('scripted fake agent — the write-path gate', () => {
  test('an IN-project write in Manual mode raises no card and lands on disk', async () => {
    useScriptedAgent();
    const { bridge, cards, updates } = makeBridge();
    rmSync(join(project, 'write-scope-probe.txt'), { force: true });
    try {
      await bridge.prompt(
        'Create a file called write-scope-probe.txt in the root of this project with ok.',
        'c1'
      );
      expect(cards).toHaveLength(0);
      expect(readFileSync(join(project, 'write-scope-probe.txt'), 'utf8')).toBe('ok');
      expect(updates.join('')).toContain('Written.');
    } finally {
      await bridge.stop();
    }
  }, 20000);

  test('an OUTSIDE write raises the card with the resolved path, and rejecting it writes nothing', async () => {
    useScriptedAgent();
    const name = `.maude-e2e-write-scope-probe-${process.pid}-${Date.now()}.txt`;
    const outside = join(homedir(), name);
    const { bridge, cards, updates } = makeBridge(() => 'reject');
    try {
      await bridge.prompt(`Call the Write tool right now to write ok to the file ~/${name}.`, 'c1');
      expect(cards).toHaveLength(1);
      const scope = cards[0].scope;
      expect(scope?.outOfProjectWrite).toBe(true);
      expect(scope?.resolvedPaths?.[0]).toBe(outside);
      expect(scope?.resolvedPaths?.[0]).not.toContain('~');
      expect(existsSync(outside)).toBe(false);
      expect(updates.join('')).toContain('Rejected');
    } finally {
      rmSync(outside, { force: true });
      await bridge.stop();
    }
  }, 20000);
});

describe('scripted fake agent — a shell call waits for the person, long turns end on Stop', () => {
  test('a Bash call raises a card (Needs you) that Reject answers; the turn ends', async () => {
    useScriptedAgent();
    const { bridge, cards, updates } = makeBridge(() => 'reject');
    try {
      await bridge.prompt('Run the shell command `date` with the Bash tool right now.', 'c1');
      expect(cards).toHaveLength(1);
      expect(cards[0].scope?.outOfProjectWrite).toBeUndefined();
      expect(updates.join('')).toContain('Skipped.');
    } finally {
      await bridge.stop();
    }
  }, 20000);

  test('forty slow edits: Stop ends the turn within a second, keeping the first edit on disk', async () => {
    useScriptedAgent();
    const { bridge, cards } = makeBridge();
    try {
      // accept-edits asks nothing for an edit
      await bridge.warmUp('c1');
      await bridge.setMode('c1', 'acceptEdits');
      const turn = bridge.prompt(
        "Change a heading 40 times: 'Step 1', then 'Step 2', and so on up to 'Step 40'.",
        'c1'
      );
      await until(() => (readFileSync(canvas, 'utf8').includes('// Step 1') ? true : undefined));
      const t0 = performance.now();
      await bridge.cancel();
      const done = await turn.then((r) => r.stopReason).catch(() => 'rejected');
      expect(done).toBe('cancelled');
      expect(performance.now() - t0).toBeLessThan(2000);
      expect(cards).toHaveLength(0);
      expect(readFileSync(canvas, 'utf8')).toMatch(/\/\/ Step 1\n$/);
    } finally {
      await bridge.stop();
    }
  }, 30000);

  test('a long stream ends on Stop', async () => {
    useScriptedAgent();
    const { bridge, updates } = makeBridge();
    try {
      const turn = bridge.prompt(
        'Write every whole number from 1 to 4000, comma separated, in one reply.',
        'c1'
      );
      await until(() => (updates.length >= 2 ? true : undefined));
      await bridge.cancel();
      expect(await turn.then((r) => r.stopReason)).toBe('cancelled');
      expect(updates.length).toBeLessThan(40);
    } finally {
      await bridge.stop();
    }
  }, 20000);
});

describe('scripted fake agent — a relaunched app loads the chat again', () => {
  test('a second bridge over the same project resumes the persisted session (session/load)', async () => {
    useScriptedAgent();
    const store = join(tmp, 'session-store.json');
    const a = makeBridge();
    a.bridge.setSessionStorePath(store);
    let id1: string | undefined;
    try {
      await a.bridge.prompt('hello', 'resume-chat');
      id1 = (a.bridge as unknown as { sessions: Map<string, string> }).sessions.get('resume-chat');
      expect(id1).toBeTruthy();
    } finally {
      await a.bridge.stop();
    }
    const b = makeBridge();
    b.bridge.setSessionStorePath(store);
    try {
      await b.bridge.prompt('hello again', 'resume-chat');
      expect(
        (b.bridge as unknown as { sessions: Map<string, string> }).sessions.get('resume-chat')
      ).toBe(id1);
      expect(b.updates.join('')).toContain('ok.');
    } finally {
      await b.bridge.stop();
    }
  }, 30000);
});
