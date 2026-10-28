// p8-t-video-3 — a shell write verb opens the run's stage the way an edit tool does.
//
// The Maude chat's AI cut places each shot with `maude design reel-place …` — a Bash tool call (ACP kind
// `execute`), never an edit tool. The stage used to open only on an edit-kind call, so every shot the verb wrote
// landed as its own "changed outside the app" action: the run published nothing, the finished cut was never
// "Made by AI" and had no one-step Undo. (Found by the video-ai-chat desktop e2e: the history held 14 `outside`
// rows and no `ai` row.)

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SessionUpdate } from '@agentclientprotocol/sdk';

import { runsDesignWriteVerb } from '../acp/design-write-verb.ts';
import { createAgentActivityTracker } from '../acp/index.ts';
import type { AiActivity } from '../collab/ai-activity.ts';
import { type Context, createBus } from '../context.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'acp-shell-stage-'));
const DESIGN = join(ROOT, '.design');
mkdirSync(join(DESIGN, 'ui'), { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

type Call = [string, ...unknown[]];

function mkCtx(calls: Call[]): Context {
  const runtime = {
    beginAiAction: (...a: unknown[]) => void calls.push(['begin', ...a]),
    claimAiWrite: (...a: unknown[]) => void calls.push(['claim', ...a]),
    endAiAction: async (...a: unknown[]) => {
      calls.push(['end', ...a]);
      return null;
    },
  };
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: ROOT,
      designRel: '.design',
      designRoot: DESIGN,
      serverInfoFile: join(DESIGN, '_server.json'),
      activeFile: join(DESIGN, '_active.json'),
      commentsDir: join(DESIGN, '_comments'),
      canvasStateDir: join(DESIGN, '_canvas-state'),
      historyDir: join(DESIGN, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
    syncControl: { current: () => runtime },
  } as unknown as Context;
}

const ai: AiActivity = {
  start: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  heartbeat: (file) => ({ file, author: 'x', startedAt: 0, lastHeartbeat: 0 }),
  end: () => true,
  list: () => [],
  get: () => null,
  stop: () => {},
};

const shell = (t: ReturnType<typeof createAgentActivityTracker>, command: string, id: string) =>
  t.onUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command },
  } as unknown as SessionUpdate);

const done = (t: ReturnType<typeof createAgentActivityTracker>, id: string) =>
  t.onUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    status: 'completed',
  } as unknown as SessionUpdate);

describe('acp / a shell write verb opens the run stage', () => {
  test('`maude design reel-place …` begins the stage under the run id, one window per call; the registry ends it', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c3');
    t.beginTurn?.('make a recap', 'r_cut');
    shell(t, 'maude design reel-place recap --next --canvas ui/V.tsx#recap', 'b1');
    done(t, 'b1');
    shell(t, 'cd /tmp && maude design reel-place recap --next --canvas ui/V.tsx#recap', 'b2');
    done(t, 'b2');
    t.endTurn('done');
    const meta = (call: string, open: boolean) => ({
      runId: 'r_cut',
      chatId: 'c3',
      shell: { call, open },
    });
    expect(calls).toEqual([
      ['begin', 'acp:c3', 'make a recap', meta('b1', true)],
      ['begin', 'acp:c3', 'make a recap', meta('b1', false)],
      ['begin', 'acp:c3', 'make a recap', meta('b2', true)],
      ['begin', 'acp:c3', 'make a recap', meta('b2', false)],
    ]); // no `end`: the registry ends a registry run
  });

  test('A1 — a call that waits on a card is shut until a grant; a denied one stays shut', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c5');
    t.beginTurn?.('export it', 'r_card');
    shell(t, 'maude design export ui/V.tsx --png', 'b1');
    t.onPermission?.('b1');
    t.onPermission?.('b1', { granted: true });
    done(t, 'b1');
    shell(t, 'maude design export ui/W.tsx --png', 'b2');
    t.onPermission?.('b2');
    t.onPermission?.('b2', { granted: false });
    done(t, 'b2');
    t.endTurn('done');
    const windows = calls.map((c) => (c[3] as { shell: { call: string; open: boolean } }).shell);
    expect(windows).toEqual([
      { call: 'b1', open: true },
      { call: 'b1', open: false }, // the card waits
      { call: 'b1', open: true }, // granted
      { call: 'b1', open: false }, // completed
      { call: 'b2', open: true },
      { call: 'b2', open: false }, // the card waits; denied: never reopened
    ]);
  });

  test('A1 — the window opens for every way of running the verb, never for text that names it', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c6');
    t.beginTurn?.('x', 'r_x');
    shell(t, 'echo maude design export', 'e1');
    shell(t, 'grep "maude design annotate" docs', 'e2');
    shell(t, 'bash -c "maude design reel-place recap --next"', 's1');
    expect(calls.length).toBe(1);
  });

  test('a read verb, a plain shell command and a look-alike open nothing', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c4');
    t.beginTurn?.('look', 'r_look');
    shell(t, 'maude design screenshot --full', 'b1');
    shell(t, 'ls -la .design', 'b2');
    shell(t, 'echo "run maude design-reel-place later"', 'b3');
    shell(t, 'maude design not-a-verb', 'b4');
    t.endTurn('done');
    expect(calls).toEqual([]);
  });
});

// V2-8.16 S7 (acp) — the agent cut the shot with `python3 - <<'EOF' … open(p,'w').write(s) … EOF` in
// .design/ui. No verb, no edit tool: the stage never opened, so the change landed as "changed outside the
// app" — no AI version, no one-step Undo. Any Bash call that is not provably a read opens a claim-only
// window for its own duration, the same window a write verb gets (A1), whatever language does the writing.
describe('acp / any Bash call that may write opens a claim-only window', () => {
  const S7 =
    `cd "${DESIGN}/ui" && python3 - <<'EOF'\np='Alligators Cinematic Cut.tsx'\n` +
    `s=open(p).read()\nopen(p,'w').write(s.replace('56','30'))\nEOF\ngit diff --stat`;
  test('the S7 python heredoc opens and shuts its own window', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c7');
    t.beginTurn?.('shorten the huddle', 'r_s7');
    shell(t, S7, 'p1');
    done(t, 'p1');
    for (const cmd of ['node -e "x"', 'perl -pi -e s/a/b/ ui/C.tsx', 'cat x > ui/C.tsx'])
      shell(t, cmd, cmd);
    t.endTurn('done');
    const windows = calls.map((c) => (c[3] as { shell: { call: string; open: boolean } }).shell);
    expect(windows.slice(0, 2)).toEqual([
      { call: 'p1', open: true },
      { call: 'p1', open: false },
    ]);
    expect(windows.filter((w) => w.open).length).toBe(4);
  });
  test('a read-only call still opens nothing (a person’s save is never folded in by `ls`)', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c8');
    t.beginTurn?.('look', 'r_ro');
    shell(t, `cd "${DESIGN}" && ls; ls ui | head -50; wc -l "ui/C.tsx"`, 'r1');
    shell(t, 'grep -n "from={" ui/C.tsx | head', 'r2');
    t.endTurn('done');
    expect(calls).toEqual([]);
  });
});

describe('acp / runsDesignWriteVerb', () => {
  test('write verbs, in a pipeline or after a cd', () => {
    expect(runsDesignWriteVerb('maude design reel-place recap --next')).toBe(true);
    expect(runsDesignWriteVerb('cd x && maude design annotate --in a')).toBe(true);
    expect(runsDesignWriteVerb('(maude design reel-place a); echo')).toBe(true);
  });
  test('A1 — the same tokenizer as the bridge: every way of RUNNING the verb', () => {
    expect(runsDesignWriteVerb('bash -c "maude design reel-place recap --next"')).toBe(true);
    expect(runsDesignWriteVerb("sh -lc 'cd x && maude design annotate --in a'")).toBe(true);
    expect(runsDesignWriteVerb('$(which maude) design reel-place recap --next')).toBe(true);
    expect(runsDesignWriteVerb('`command -v maude` design annotate --in a')).toBe(true);
    expect(runsDesignWriteVerb('/usr/local/bin/maude design reel-place a')).toBe(true);
    expect(runsDesignWriteVerb('maude-safe design annotate --in a')).toBe(true);
    expect(runsDesignWriteVerb('env FOO=1 maude design annotate --in a')).toBe(true);
    expect(runsDesignWriteVerb('x=$(maude design reel-place a --next)')).toBe(true);
  });
  test('A1 — text that only names a verb runs nothing', () => {
    expect(runsDesignWriteVerb('echo maude design export')).toBe(false);
    expect(runsDesignWriteVerb('grep "maude design annotate" docs')).toBe(false);
    expect(runsDesignWriteVerb("printf '%s' 'maude design reel-place a'")).toBe(false);
    expect(runsDesignWriteVerb('cat notes.md # maude design annotate')).toBe(false);
  });
  test('reads and non-verbs', () => {
    expect(runsDesignWriteVerb('maude design canvas-rects')).toBe(false);
    expect(runsDesignWriteVerb('maude config show')).toBe(false);
    expect(runsDesignWriteVerb(undefined)).toBe(false);
    expect(runsDesignWriteVerb(42)).toBe(false);
  });
});
