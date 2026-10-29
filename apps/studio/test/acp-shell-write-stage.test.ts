// p8-t-video-3 — a shell write verb opens the run's stage the way an edit tool does.
//
// The Maude chat's AI cut places each shot with `maude design reel-place …` — a Bash tool call (ACP kind
// `execute`), never an edit tool. The stage used to open only on an edit-kind call, so every shot the verb wrote
// landed as its own "changed outside the app" action: the run published nothing, the finished cut was never
// "Made by AI" and had no one-step Undo. (Found by the video-ai-chat desktop e2e: the history held 14 `outside`
// rows and no `ai` row.)

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
// p8-a1-claims — a window names the canvases its command names, so they exist on disk here
for (const f of ['V.tsx', 'W.tsx', 'C.tsx', 'Alligators Cinematic Cut.tsx'])
  writeFileSync(join(DESIGN, 'ui', f), 'export default () => null;\n');
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

// p8-a1-claims (Michal 2026-10-29) — a verb claims its own writes (ai/write-claim.ts), so a verb call no longer
// opens a window: a person's outside save during it is never folded into the run. Only a call that may write
// WITHOUT claiming (the S7 interpreter fallback below) keeps the per-call window.
describe('acp / a shell write verb opens no window — it claims its own writes', () => {
  test('`maude design reel-place …` opens nothing: its writes are claimed by bytes, not by time', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c3');
    t.beginTurn?.('make a recap', 'r_cut');
    shell(t, 'maude design reel-place recap --next --canvas ui/V.tsx#recap', 'b1');
    done(t, 'b1');
    shell(t, 'cd /tmp && maude design reel-place recap --next --canvas ui/V.tsx#recap', 'b2');
    done(t, 'b2');
    shell(t, 'maude design export ui/V.tsx --png', 'b3');
    done(t, 'b3');
    t.endTurn('done');
    expect(calls).toEqual([]); // no window, no `end`: the registry ends a registry run
  });

  test('A1 — an interpreter call that waits on a card is shut until a grant; a denied one stays shut', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c5');
    t.beginTurn?.('cut it', 'r_card');
    shell(t, 'python3 cut.py ui/V.tsx', 'b1');
    t.onPermission?.('b1');
    t.onPermission?.('b1', { granted: true });
    done(t, 'b1');
    shell(t, 'python3 cut.py ui/W.tsx', 'b2');
    t.onPermission?.('b2');
    t.onPermission?.('b2', { granted: false });
    done(t, 'b2');
    t.endTurn('done');
    const meta = (call: string, open: boolean) => ({
      runId: 'r_card',
      chatId: 'c5',
      claimOnly: true,
      shell: { call, open, files: ['.design/ui/V.tsx'] },
    });
    expect(calls[0]).toEqual(['begin', 'acp:c5', 'cut it', meta('b1', true)]);
    const windows = calls.map((c) =>
      ((s) => ({ call: s.call, open: s.open }))(
        (c[3] as { shell: { call: string; open: boolean } }).shell
      )
    );
    expect(windows).toEqual([
      { call: 'b1', open: true },
      { call: 'b1', open: false }, // the card waits
      { call: 'b1', open: true }, // granted
      { call: 'b1', open: false }, // completed
      { call: 'b2', open: true },
      { call: 'b2', open: false }, // the card waits; denied: never reopened
    ]);
  });

  test('A1 — text that names a verb opens nothing; `bash -c` can run anything, so it keeps the fallback', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c6');
    t.beginTurn?.('x', 'r_x');
    shell(t, 'echo maude design export', 'e1');
    shell(t, 'grep "maude design annotate" docs', 'e2');
    // p8-a1-claims — the fallback window covers only the canvases the command names: none, nothing
    shell(t, 'bash -c "maude design reel-place recap --next"', 's0');
    shell(t, 'bash -c "maude design reel-place recap --next --canvas ui/V.tsx"', 's1');
    expect(calls.length).toBe(1);
    expect((calls[0][3] as { shell: { files: string[] } }).shell.files).toEqual([
      '.design/ui/V.tsx',
    ]);
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
    const windows = calls.map((c) =>
      ((s) => ({ call: s.call, open: s.open }))(
        (c[3] as { shell: { call: string; open: boolean } }).shell
      )
    );
    expect(windows.slice(0, 2)).toEqual([
      { call: 'p1', open: true },
      { call: 'p1', open: false },
    ]);
    // p8-a1-claims — `node -e "x"` names no canvas: no window (perl and the redirect name ui/C.tsx)
    expect(windows.filter((w) => w.open).length).toBe(3);
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

// p8-secfix-hook (V2-8.9 final delta F2) — `nohup python3 w.py &` or Claude Code's
// `run_in_background` completes at once while the process keeps writing. Its window stays open until
// the turn ends, so those writes land in the run, not as the person's "changed outside the app".
describe('acp / a call that outlives itself keeps its window until the turn ends', () => {
  const windowsOf = (calls: Call[]) =>
    calls.map((c) =>
      ((s) => ({ call: s.call, open: s.open }))(
        (c[3] as { shell: { call: string; open: boolean } }).shell
      )
    );
  test('a background job, nohup / setsid / disown and run_in_background', () => {
    for (const [id, rawInput] of [
      ['g1', { command: 'nohup python3 w.py ui/C.tsx &' }],
      ['g2', { command: `(sleep 2; node -e 'require("fs").writeFileSync("ui/C.tsx","")') &` }],
      ['g3', { command: 'setsid python3 w.py ui/C.tsx' }],
      ['g4', { command: 'python3 w.py ui/C.tsx & disown' }],
      ['g5', { command: 'python3 w.py ui/C.tsx', run_in_background: true }],
    ] as const) {
      const calls: Call[] = [];
      const t = createAgentActivityTracker(mkCtx(calls), ai, `c-${id}`);
      t.beginTurn?.('cut it', `r_${id}`);
      t.onUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: id,
        kind: 'execute',
        status: 'in_progress',
        rawInput,
      } as unknown as SessionUpdate);
      done(t, id);
      // the call returned: its window is still open
      expect(windowsOf(calls), id).toEqual([{ call: id, open: true }]);
      t.endTurn('done');
      expect(windowsOf(calls), id).toEqual([
        { call: id, open: true },
        { call: id, open: false }, // the turn ended
      ]);
    }
  });
  test('a call that waits for its process still shuts at its return', () => {
    const calls: Call[] = [];
    const t = createAgentActivityTracker(mkCtx(calls), ai, 'c-fg');
    t.beginTurn?.('cut it', 'r_fg');
    shell(t, 'python3 w.py ui/C.tsx && echo done', 'f1');
    done(t, 'f1');
    expect(windowsOf(calls)).toEqual([
      { call: 'f1', open: true },
      { call: 'f1', open: false },
    ]);
    t.endTurn('done');
    expect(calls.length).toBe(2);
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
