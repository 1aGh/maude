// Universal ACP B3/F5 — the bridge-enforced permission gate (acp/policy/enforce.ts), replayed against the
// B0 spike's recorded `session/request_permission` frames (.ai/plans/notes/universal-acp-frames/) plus
// synthetic ones, on a tmp project OUTSIDE git and one INSIDE a git repo (contract contradiction 6).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { MAUDE_VERBS, verbTier } from '../actions/verbs.ts';
import type { AgentDescriptor, PolicyCtx } from '../acp/agents/descriptor.ts';
import {
  APPROVABLE_READ_BASH,
  credentialPathsFor,
  credentialRefusal,
  MAY_ALL,
  mayRefusal,
  READ_ONLY_BASH,
  readBoundaryRoots,
} from '../acp/may-scope.ts';
import {
  answerCard,
  createPermissionGate,
  type EnforcedDescriptor,
  gatePermission,
  isForbiddenClientMethod,
  isRefusedMode,
  newTripwireMemory,
  PERSISTENT_OPTION_IDS,
  refusalNotice,
  toPermissionResponse,
  tripwire,
} from '../acp/policy/enforce.ts';
import { pinScopeRoot, resolveWriteTargets } from '../acp/write-scope.ts';

const FRAMES = resolve(import.meta.dir, '../../../.ai/plans/notes/universal-acp-frames');

const launchPolicy = () => ({ env: {} });
const CODEX: EnforcedDescriptor = {
  id: 'codex',
  label: 'Codex',
  vendor: 'OpenAI',
  detect: { bins: ['codex'], versionArgs: [], versionRe: /x/, minVersion: '0', testedMax: '9' },
  launch: { kind: 'adapter-js', adapterPkg: 'x', adapterBin: 'x' },
  auth: { gate: 'session-new' },
  envAllow: [],
  policy: 'bridge-enforced',
  plugins: 'harness:codex',
  enforcement: {
    launchPolicy,
    readGate: 'os-sandbox',
    shellGate: 'os-sandbox',
    pinMode: { modeId: 'workspace-write', refuse: ['agent', 'agent-full-access'] },
    rejectEndsTurn: true,
    targetKeys: ['path', 'file_path'],
  },
};
const OPENCODE: EnforcedDescriptor = {
  ...CODEX,
  id: 'opencode',
  label: 'opencode',
  vendor: 'opencode',
  plugins: 'harness:opencode',
  enforcement: {
    launchPolicy,
    readGate: 'agent-permission-engine',
    shellGate: 'command-text',
    rejectEndsTurn: false,
    targetKeys: ['filepath', 'filePath', 'path'],
  },
};

interface Fixture {
  root: string;
  proj: string;
  home: string;
  scratch: string;
  ctx: PolicyCtx;
}

const made: string[] = [];

function fixture(git: boolean): Fixture {
  const root = pinScopeRoot(mkdtempSync(join(tmpdir(), 'acp-enforce-')));
  made.push(root);
  const proj = join(root, 'proj');
  const home = join(root, 'home');
  const scratch = join(root, 'scratch');
  for (const d of [proj, join(proj, '.design', 'assets'), join(root, 'outside'), scratch])
    mkdirSync(d, { recursive: true });
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(join(home, '.config', 'maude'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'id_rsa'), 'FAKE-KEY');
  writeFileSync(join(root, 'outside', 'secret.txt'), 'FAKE-SECRET');
  writeFileSync(join(proj, 'notes.txt'), 'notes');
  if (git) Bun.spawnSync(['git', 'init', '-q', root]);
  const scopeRoot = pinScopeRoot(proj);
  return {
    root,
    proj,
    home,
    scratch,
    ctx: {
      scopeRoot,
      readRoots: readBoundaryRoots({ repoRoot: scopeRoot, designRoot: '.design' }),
      writeRoots: [scopeRoot, scratch],
      credentialPaths: credentialPathsFor({ HOME: home }, home, 'darwin'),
      may: MAY_ALL,
      designRoots: [join(scopeRoot, '.design')],
      agentBin: '/usr/bin/true',
    },
  };
}

let nonGit: Fixture;
let inGit: Fixture;
beforeAll(() => {
  nonGit = fixture(false);
  inGit = fixture(true);
});
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const CODEX_OPTS = [
  { optionId: 'allow_once', name: 'Yes, proceed', kind: 'allow_once' },
  { optionId: 'accept_execpolicy_amendment', name: 'Yes, and…', kind: 'allow_always' },
  { optionId: 'cancel', name: 'No', kind: 'reject_once' },
] as const;
const OC_OPTS = [
  { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
  { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
  { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
] as const;

// biome-ignore lint/suspicious/noExplicitAny: synthetic ACP frames
const req = (toolCall: any, options: readonly any[] = OC_OPTS) =>
  ({ sessionId: 's', toolCall, options: [...options] }) as never;
const live = (f: Fixture) => ({ stopped: false, home: f.home });

// ---------------------------------------------------------------------------------------------------

interface Recorded {
  file: string;
  // biome-ignore lint/suspicious/noExplicitAny: recorded frame
  params: any;
}

function loadFrames(f: Fixture, which: 'git' | 'nongit'): Recorded[] {
  const out: Recorded[] = [];
  for (const file of readdirSync(FRAMES).filter((n) => n.endsWith('.ndjson'))) {
    const nongit = file.includes('nongit');
    if ((which === 'nongit') !== nongit) continue;
    let text = readFileSync(join(FRAMES, file), 'utf8');
    text = text
      .replaceAll('<scratch-nongit>', f.root)
      .replaceAll('<scratch>', f.root)
      .replaceAll('<home>', f.home);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (frame.payload?.method === 'session/request_permission')
        out.push({ file, params: frame.payload.params });
    }
  }
  return out;
}

function expected(r: Recorded): string {
  const tc = r.params.toolCall;
  if (r.file.startsWith('codex')) return 'ask'; // an escalation or an outside edit: the person's card
  if (tc.kind === 'read') return 'reject'; // opencode read:"ask" carries no path
  if (tc.kind === 'execute') return 'ask'; // `cat ../outside/secret.txt`
  return String(tc.locations?.[0]?.path ?? '').includes('/proj/') ? 'allow_once' : 'ask';
}

describe('recorded request_permission frames', () => {
  for (const which of ['nongit', 'git'] as const) {
    test(`every recorded frame (${which} fixture) gets the contract's answer, never an "always"`, () => {
      const f = which === 'git' ? inGit : nonGit;
      const frames = loadFrames(f, which);
      expect(frames.length).toBeGreaterThan(which === 'git' ? 8 : 0);
      for (const r of frames) {
        const d = r.file.startsWith('codex') ? CODEX : OPENCODE;
        const res = gatePermission(r.params, d, f.ctx, live(f));
        expect({ id: `${r.file}#${r.params.toolCall.toolCallId}`, d: res.decision }).toEqual({
          id: `${r.file}#${r.params.toolCall.toolCallId}`,
          d: expected(r) as never,
        });
        // rule 9 — never chosen, never shown
        for (const o of res.strippedOptions) {
          expect(o.kind).not.toBe('allow_always');
          expect(PERSISTENT_OPTION_IDS.has(o.optionId)).toBe(false);
        }
        if (res.optionId) expect(PERSISTENT_OPTION_IDS.has(res.optionId)).toBe(false);
        if (res.decision === 'reject') {
          const rej = r.params.options.find((o: { kind: string }) => o.kind === 'reject_once');
          expect(res.optionId).toBe(rej.optionId);
        }
      }
    });
  }

  test('inside a git repo, the scope is the project, not the git root (contradiction 6)', () => {
    const outside = loadFrames(inGit, 'git').find(
      (r) =>
        r.params.toolCall.kind === 'edit' && r.params.toolCall.locations[0].path.includes('outside')
    );
    expect(outside).toBeDefined();
    const res = gatePermission(outside?.params, OPENCODE, inGit.ctx, live(inGit));
    expect(res.decision).toBe('ask');
    expect(res.reason).toBe('write-outside');
  });
});

// ---------------------------------------------------------------------------------------------------

describe('rule 3 — credentials, no card', () => {
  test('a credential path in locations / rawInput is refused', () => {
    const f = nonGit;
    for (const tc of [
      { toolCallId: 'a', kind: 'read', locations: [{ path: join(f.home, '.ssh', 'id_rsa') }] },
      {
        toolCallId: 'b',
        kind: 'edit',
        rawInput: { filePath: join(f.home, '.config/maude/cloud.json') },
      },
      { toolCallId: 'c', kind: 'read', rawInput: { path: '~/.ssh/' } },
    ]) {
      const res = gatePermission(req(tc), OPENCODE, f.ctx, live(f));
      expect(res.decision).toBe('reject');
      expect(res.reason).toBe('credentials');
      expect(res.optionId).toBe('reject');
    }
  });

  test('a credential path only as a token inside a shell command is refused', () => {
    const f = nonGit;
    for (const command of [
      'cat ../home/.ssh/id_rsa', // relative, resolved from the project
      'grep -r key --file=../home/.ssh/config .',
      'cat $HOME/.ssh/id_rsa',
      `tar czf /tmp/x.tgz ${join(f.home, '.SSH')}`, // case-folded
    ]) {
      for (const d of [OPENCODE, CODEX]) {
        const res = gatePermission(
          req({ toolCallId: 'x', kind: 'execute', rawInput: { command, cwd: f.proj } }, CODEX_OPTS),
          d,
          f.ctx,
          live(f)
        );
        expect({ command, r: res.reason }).toEqual({ command, r: 'credentials' });
        expect(res.optionId).toBe('cancel');
      }
    }
  });

  test('an argv command is joined and judged the same', () => {
    const f = nonGit;
    const res = gatePermission(
      req({
        toolCallId: 'x',
        kind: 'execute',
        rawInput: { command: ['cat', '../home/.ssh/id_rsa'] },
      }),
      OPENCODE,
      f.ctx,
      live(f)
    );
    expect(res.reason).toBe('credentials');
  });
});

describe('rule 4 — "AI may", no card', () => {
  test('web off: fetch kind, a web URL, a downloader → refused', () => {
    const f = nonGit;
    const ctx = { ...f.ctx, may: { assets: true, web: false } };
    for (const tc of [
      { toolCallId: 'a', kind: 'fetch', locations: [], rawInput: {} }, // opencode webfetch shape
      { toolCallId: 'b', kind: 'other', rawInput: { url: 'https://example.com' } },
      { toolCallId: 'c', kind: 'execute', rawInput: { command: 'curl https://example.com' } },
    ]) {
      expect(gatePermission(req(tc), OPENCODE, ctx, live(f)).reason).toBe('web');
    }
  });

  test('web on: a fetch is the person’s card, never auto', () => {
    const f = nonGit;
    const res = gatePermission(req({ toolCallId: 'a', kind: 'fetch' }), OPENCODE, f.ctx, live(f));
    expect(res.decision).toBe('ask');
  });

  test('assets off: a path under the assets folder → refused', () => {
    const f = nonGit;
    const ctx = { ...f.ctx, may: { assets: false, web: true } };
    const res = gatePermission(
      req({ toolCallId: 'a', kind: 'read', locations: [{ path: '.design/assets/clip.mp4' }] }),
      OPENCODE,
      ctx,
      live(f)
    );
    expect(res.reason).toBe('assets');
  });
});

describe('rule 5 — writes', () => {
  const edit = (path: string) => ({ toolCallId: 'e', kind: 'edit', locations: [{ path }] });

  test('in scope → allow_once (with the audience hold); the chat scratch counts', () => {
    const f = nonGit;
    for (const p of [join(f.proj, 'a.tsx'), 'b.tsx', join(f.scratch, 'shot.png')]) {
      const res = gatePermission(req(edit(p), CODEX_OPTS), CODEX, f.ctx, live(f));
      expect({ p, d: res.decision }).toEqual({ p, d: 'allow_once' });
      expect(res.optionId).toBe('allow_once');
      expect(res.audienceHold).toBe(true);
    }
  });

  test('out of scope, protected, runtime state, a read grant → the card, no "always"', () => {
    const f = nonGit;
    const state = { ...live(f), grantRoots: [join(f.root, 'outside')] };
    for (const p of [
      join(f.root, 'outside', 'x.txt'),
      '../outside/x.txt',
      '.git/config',
      '.design/_state/consent.json',
      '~/x.txt',
    ]) {
      const res = gatePermission(req(edit(p), CODEX_OPTS), CODEX, f.ctx, state);
      expect({ p, d: res.decision }).toEqual({ p, d: 'ask' });
      expect(res.strippedOptions.map((o) => o.optionId)).toEqual(['allow_once', 'cancel']);
    }
  });

  test('no target → refused (fail closed); a NUL → refused', () => {
    const f = nonGit;
    for (const tc of [
      { toolCallId: 'e', kind: 'edit', locations: [], rawInput: {} },
      { toolCallId: 'e', kind: 'delete', rawInput: { cwd: f.proj } }, // a cwd is not a write target
      { toolCallId: 'e', kind: 'move', locations: [{ path: 'a\0b' }] },
    ]) {
      const res = gatePermission(req(tc), OPENCODE, f.ctx, live(f));
      expect(res.decision).toBe('reject');
      expect(res.reason).toBe('write-no-target');
    }
  });

  test('a run with its own write scope narrows the allow', () => {
    const f = nonGit;
    const res = gatePermission(req(edit('a.tsx')), OPENCODE, f.ctx, {
      ...live(f),
      onlyPaths: ['b.tsx'],
    });
    expect(res.decision).toBe('ask');
  });
});

describe('rule 6 — reads', () => {
  test('in roots → allow_once; outside → card; a grant counts; no path → refused', () => {
    const f = nonGit;
    const read = (p: string) => req({ toolCallId: 'r', kind: 'read', locations: [{ path: p }] });
    expect(gatePermission(read('notes.txt'), OPENCODE, f.ctx, live(f)).decision).toBe('allow_once');
    expect(gatePermission(read('../outside/secret.txt'), OPENCODE, f.ctx, live(f)).decision).toBe(
      'ask'
    );
    expect(
      gatePermission(read('../outside/secret.txt'), OPENCODE, f.ctx, {
        ...live(f),
        grantRoots: [join(f.root, 'outside')],
      }).decision
    ).toBe('allow_once');
    expect(
      gatePermission(
        req({ toolCallId: 'r', kind: 'search', rawInput: { path: 'src/**/../../..' } }),
        OPENCODE,
        f.ctx,
        live(f)
      ).decision
    ).toBe('ask');
    const empty = gatePermission(
      req({ toolCallId: 'r', kind: 'read', locations: [], rawInput: {} }),
      OPENCODE,
      f.ctx,
      live(f)
    );
    expect(empty.decision).toBe('reject');
    expect(empty.reason).toBe('read-no-target');
  });
});

describe('rule 7 — shell', () => {
  const exec = (command: string, extra: Record<string, unknown> = {}) =>
    req({ toolCallId: 'x', kind: 'execute', rawInput: { command, ...extra } });

  test('codex (os-sandbox): every execute is the person’s card, even an in-project read', () => {
    const f = nonGit;
    for (const c of ['ls', 'maude design prep', 'cat notes.txt']) {
      const res = gatePermission(exec(c, { cwd: f.proj }), CODEX, f.ctx, live(f));
      expect(res.decision).toBe('ask');
      expect(res.reason).toBe('shell-escalation');
      expect(res.shown.command).toBe(c);
    }
  });

  test('opencode: an auto-tier `maude design` verb → allow_once', () => {
    const f = nonGit;
    const auto = MAUDE_VERBS.find((v) => v.scope === 'design' && verbTier(v) === 'auto');
    const res = gatePermission(exec(`maude design ${auto?.verb} --json`), OPENCODE, f.ctx, live(f));
    expect(res.decision).toBe('allow_once');
    expect(res.reason).toBe('shell-auto-verb');
  });

  test('opencode: a prompt-tier verb, a chained or expanded verb call → the card', () => {
    const f = nonGit;
    const prompt = MAUDE_VERBS.find((v) => v.scope === 'design' && verbTier(v) === 'prompt');
    for (const c of [
      `maude design ${prompt?.verb}`,
      'maude design prep; cat ../outside/secret.txt',
      'maude design prep $(cat x)',
      'maude design prep > out.txt',
    ]) {
      expect({ c, d: gatePermission(exec(c), OPENCODE, f.ctx, live(f)).decision }).toEqual({
        c,
        d: 'ask',
      });
    }
  });

  test('opencode: a plain read inside the roots → allow_once; outside or a writer → the card', () => {
    const f = nonGit;
    expect(gatePermission(exec('cat notes.txt'), OPENCODE, f.ctx, live(f)).decision).toBe(
      'allow_once'
    );
    expect(gatePermission(exec('grep -n "a b" notes.txt'), OPENCODE, f.ctx, live(f)).decision).toBe(
      'allow_once'
    );
    for (const c of [
      'cat ../outside/secret.txt',
      'cp notes.txt x',
      'find . -exec rm {} ;',
      'cat *',
      'cat ~/x',
      'grep -f/etc/passwd x notes.txt',
      'ls',
    ]) {
      const cwd = c === 'ls' ? join(f.root, 'outside') : undefined;
      const d = gatePermission(exec(c, cwd ? { cwd } : {}), OPENCODE, f.ctx, live(f)).decision;
      expect({ c, d }).toEqual({ c, d: 'ask' });
    }
  });

  test('an execute with no command → refused', () => {
    const f = nonGit;
    expect(gatePermission(exec(''), OPENCODE, f.ctx, live(f)).decision).toBe('reject');
  });

  test('the approvable readers are a subset of the Claude read-only list', () => {
    for (const c of APPROVABLE_READ_BASH) expect(READ_ONLY_BASH.has(c)).toBe(true);
  });
});

describe('rules 1, 8, 9 — fail closed', () => {
  test('unknown kind / think / switch_mode / other / missing kind or toolCall → refused', () => {
    const f = nonGit;
    for (const kind of ['think', 'switch_mode', 'other', 'banana', undefined]) {
      const res = gatePermission(
        req({ toolCallId: 'k', kind, locations: [{ path: 'notes.txt' }] }),
        OPENCODE,
        f.ctx,
        live(f)
      );
      expect({ kind, d: res.decision }).toEqual({ kind, d: 'reject' });
    }
    const none = gatePermission(req(undefined), OPENCODE, f.ctx, live(f));
    expect(none.reason).toBe('no-tool-call');
  });

  test('no reject_once option → cancelled; a stopped session → cancelled', () => {
    const f = nonGit;
    const res = gatePermission(
      req({ toolCallId: 'k', kind: 'think' }, [OC_OPTS[0]]),
      OPENCODE,
      f.ctx,
      live(f)
    );
    expect(res.optionId).toBeUndefined();
    expect(toPermissionResponse(res)).toEqual({ outcome: { outcome: 'cancelled' } });
    const stopped = gatePermission(
      req({ toolCallId: 'k', kind: 'read', locations: [{ path: 'notes.txt' }] }),
      OPENCODE,
      f.ctx,
      { stopped: true, home: f.home }
    );
    expect(toPermissionResponse(stopped)).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  test('a persistent option is stripped even when it claims allow_once; the card cannot pick it', () => {
    const f = nonGit;
    const forged = [
      { optionId: 'accept_execpolicy_amendment', kind: 'allow_once', name: 'x' },
      { optionId: 'cancel', kind: 'reject_once', name: 'No' },
    ];
    const res = gatePermission(
      req({ toolCallId: 'e', kind: 'edit', locations: [{ path: 'a.tsx' }] }, forged),
      CODEX,
      f.ctx,
      live(f)
    );
    expect(res.decision).toBe('ask');
    expect(res.reason).toBe('no-allow-option');
    expect(res.strippedOptions.map((o) => o.optionId)).toEqual(['cancel']);
    const card = gatePermission(
      req({ toolCallId: 'e', kind: 'edit', locations: [{ path: '../outside/a' }] }, CODEX_OPTS),
      CODEX,
      f.ctx,
      live(f)
    );
    expect(answerCard(card, 'accept_execpolicy_amendment')).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(answerCard(card, 'allow_once')).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
  });

  test('a descriptor that is not bridge-enforced is refused outright', () => {
    const f = nonGit;
    const res = gatePermission(
      req({ toolCallId: 'r', kind: 'read', locations: [{ path: 'notes.txt' }] }),
      { ...OPENCODE, policy: 'unrestricted' } as AgentDescriptor,
      f.ctx,
      live(f)
    );
    expect(res.reason).toBe('not-enforced');
  });
});

describe('rules 10, 11, 13', () => {
  test('refused modes', () => {
    expect(isRefusedMode(CODEX, 'agent')).toBe(true);
    expect(isRefusedMode(CODEX, 'agent-full-access')).toBe(true);
    expect(isRefusedMode(CODEX, 'workspace-write')).toBe(false);
    expect(isRefusedMode(OPENCODE, 'agent')).toBe(false);
  });

  test('fs/* and terminal/* are forbidden for a bridge-enforced agent', () => {
    expect(isForbiddenClientMethod(CODEX, 'fs/read_text_file')).toBe(true);
    expect(isForbiddenClientMethod(OPENCODE, 'terminal/create')).toBe(true);
    expect(isForbiddenClientMethod(CODEX, 'session/update')).toBe(false);
  });

  test('a refusal that ends a Codex turn says why; opencode carries on', () => {
    const f = nonGit;
    const res = gatePermission(
      req({ toolCallId: 'e', kind: 'edit', rawInput: {} }, CODEX_OPTS),
      CODEX,
      f.ctx,
      live(f)
    );
    expect(refusalNotice(CODEX, res)).toBe(
      'Codex stopped: Maude refused a write that names no file'
    );
    expect(refusalNotice(OPENCODE, res)).toBeNull();
  });
});

describe('rule 12 — tripwire', () => {
  const replay = (file: string, f: Fixture, d: AgentDescriptor) => {
    const memory = newTripwireMemory();
    const hits: string[] = [];
    const text = readFileSync(join(FRAMES, file), 'utf8').replaceAll('<scratch>', f.root);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const u = JSON.parse(line).payload?.params?.update;
      if (!u) continue;
      const v = tripwire(u, d, f.ctx, memory, f.home);
      if (v.violated) hits.push(`${u.toolCallId}: ${v.reason}`);
    }
    return hits;
  };

  test('codex: a completed read outside the roots trips (codex-mock-ws call_1)', () => {
    expect(replay('codex-mock-ws.ndjson', inGit, CODEX)).toEqual([
      'call_1: completed read outside the read roots',
    ]);
  });

  test('os-sandbox: an in-roots read does not trip; an outside read and an outside write do', () => {
    // opencode-mock-default's frames, judged as if an os-sandbox agent had sent them
    const hits = replay('opencode-mock-default.ndjson', inGit, {
      ...OPENCODE,
      enforcement: { ...OPENCODE.enforcement, readGate: 'os-sandbox' },
    } as AgentDescriptor);
    expect(hits).toEqual([
      'call_2: completed read outside the read roots',
      'call_5: completed edit outside the write roots',
    ]);
  });

  test('agent-permission-engine: no roots check (git-root boundary), a credential still trips', () => {
    expect(replay('opencode-mock-default.ndjson', inGit, OPENCODE)).toEqual([]);
    const f = nonGit;
    const v = tripwire(
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'z',
        kind: 'read',
        status: 'completed',
        locations: [{ path: join(f.home, '.ssh', 'id_rsa') }],
      },
      OPENCODE,
      f.ctx,
      undefined,
      f.home
    );
    expect(v.violated).toBe(true);
  });

  test('a write the person approved on a card does not trip', () => {
    const f = nonGit;
    const gate = createPermissionGate(CODEX, f.ctx);
    const out = join(f.root, 'outside', 'patch.txt');
    const card = gate.decide(
      req({ toolCallId: 'call_5', kind: 'edit', locations: [{ path: out }] }, CODEX_OPTS),
      live(f)
    );
    expect(card.decision).toBe('ask');
    gate.answer(card, 'allow_once');
    gate.observe({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_5',
      kind: 'edit',
      locations: [{ path: out }],
    });
    expect(
      gate.observe({ sessionUpdate: 'tool_call_update', toolCallId: 'call_5', status: 'completed' })
        .violated
    ).toBe(false);
    gate.observe({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_6',
      kind: 'edit',
      locations: [{ path: out }],
    });
    expect(
      gate.observe({ sessionUpdate: 'tool_call_update', toolCallId: 'call_6', status: 'completed' })
        .violated
    ).toBe(true);
  });
});

describe('the Claude-name-keyed gates are unchanged', () => {
  test('credentialRefusal / mayRefusal / resolveWriteTargets on existing shapes', () => {
    const f = nonGit;
    const cp = f.ctx.credentialPaths;
    const r = f.ctx.scopeRoot;
    expect(credentialRefusal({ rawInput: { command: 'cat ~/.ssh/id_rsa' } }, cp, r, f.home)).toBe(
      'credentials'
    );
    expect(credentialRefusal({ rawInput: { file_path: ' ~/.SSH/id_rsa' } }, cp, r, f.home)).toBe(
      'credentials'
    );
    expect(credentialRefusal({ rawInput: { pattern: '~/.ssh/*' } }, cp, r, f.home)).toBe(
      'credentials'
    );
    // the Claude gate does NOT resolve relative command words (the kind-keyed one adds that)
    expect(
      credentialRefusal({ rawInput: { command: 'cat ../home/.ssh/id_rsa' } }, cp, r, f.home)
    ).toBeNull();
    expect(credentialRefusal({ rawInput: { file_path: 'notes.txt' } }, cp, r, f.home)).toBeNull();
    const assets = [join(r, '.design', 'assets')];
    const off = { assets: false, web: false };
    expect(mayRefusal('WebFetch', {}, off, r, assets)).toBe('web');
    expect(mayRefusal(undefined, { kind: 'fetch' }, off, r, assets)).toBe('web');
    expect(mayRefusal('Bash', { rawInput: { command: 'wget x' } }, off, r, assets)).toBe('web');
    expect(
      mayRefusal('Bash', { rawInput: { command: 'maude design assets' } }, off, r, assets)
    ).toBe('assets');
    expect(
      mayRefusal('Read', { rawInput: { file_path: '.design/assets/a.mp4' } }, off, r, assets)
    ).toBe('assets');
    expect(mayRefusal('Read', { rawInput: { file_path: 'notes.txt' } }, off, r, assets)).toBeNull();
    expect(resolveWriteTargets({ locations: [{ path: 'a.tsx' }] }, r).reason).toBe('inside');
    expect(resolveWriteTargets({ locations: [{ path: '.git/config' }] }, r).reason).toBe(
      'in-project-denied'
    );
    expect(resolveWriteTargets({ locations: [{ path: '../x' }] }, r).reason).toBe('outside');
    expect(resolveWriteTargets({ locations: [{ path: join(f.scratch, 'x') }] }, r).reason).toBe(
      'outside'
    );
  });
});
