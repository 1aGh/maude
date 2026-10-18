// feature-acp-write-path-scope — the gate proven END TO END through a real ACP
// round-trip (fixtures/mock-acp-agent-write.mjs replays the adapter's measured
// wire shape; see that file's header for where each field came from).
//
// acp-write-scope.test.ts covers the pure path logic. THIS file covers the part
// that logic cannot see:
//   • the tool NAME arriving only on a prior `tool_call` notification, and the
//     gate failing closed when it doesn't;
//   • the in-project write producing NO client frame at all (the DDR-184
//     regression guard — a prompt here is the user-visible bug this whole
//     feature promised not to introduce);
//   • Decision D — `allow_always` stripped from an out-of-project write, AND
//     rejected if a crafted response names it anyway;
//   • Task 11 — a session pinned to project A prompting for a write into
//     project B while B is the "open" project.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { AcpBridge, type PermissionScopeInfo } from '../acp/bridge.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-write.mjs');
const TEST_ENV_KEYS = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'MAUDE_TEST_WRITE_PATH',
  'MAUDE_TEST_WRITE_TOOL',
  'MAUDE_TEST_OMIT_TOOL_CALL',
];

let tmp: string;
let projectA: string;
let projectB: string;

beforeAll(() => {
  // realpath the base — on macOS `/var` symlinks to `/private/var`, which would
  // otherwise make every in-project case look like an escape.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-write-gate-')));
  projectA = join(tmp, 'project-a');
  projectB = join(tmp, 'project-b');
  mkdirSync(join(projectA, '.design', 'ui'), { recursive: true });
  mkdirSync(projectB, { recursive: true });
  writeFileSync(join(projectA, '.design', 'ui', 'home.tsx'), '// canvas\n');
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

afterEach(() => {
  for (const key of TEST_ENV_KEYS) delete process.env[key];
});

function useWriteAgent(opts: { path: string; tool?: string; omitToolCall?: boolean }) {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  process.env.MAUDE_TEST_WRITE_PATH = opts.path;
  process.env.MAUDE_TEST_WRITE_TOOL = opts.tool ?? 'Write';
  if (opts.omitToolCall) process.env.MAUDE_TEST_OMIT_TOOL_CALL = '1';
}

interface Captured {
  id: string;
  req: RequestPermissionRequest;
  scope?: PermissionScopeInfo;
}

/** Run one turn against the fixture and report what the client SAW. `text` is
 *  the mock's echo of the outcome it received, which is the only proof of what
 *  the bridge actually answered the adapter. */
async function runTurn(
  repoRoot: string,
  autoRespond?: (c: Captured) => string,
  readOnlyRoots?: () => readonly string[]
) {
  const prompts: Captured[] = [];
  const transparency: RequestPermissionRequest[] = [];
  const updates: Array<{ content?: { text?: string } }> = [];
  const bridge = new AcpBridge({
    repoRoot,
    readOnlyRoots,
    permissionTimeoutMs: 4000,
    onUpdate: (u) => updates.push(u as { content?: { text?: string } }),
    onPermission: (req) => transparency.push(req),
    onPermissionRequest: (id, req, scope) => {
      const c = { id, req, scope };
      prompts.push(c);
      if (autoRespond) bridge.resolvePermission(id, autoRespond(c));
    },
  });
  try {
    await bridge.prompt('go', 'c1');
    return {
      prompts,
      transparency,
      outcome: updates.map((u) => u?.content?.text ?? '').join(''),
      scopeRoot: bridge.writeScopeRoot,
    };
  } finally {
    await bridge.stop();
  }
}

// S5.10 — a folder the person allowed AI to read is read-only to the bridge's gate, inside the
// project too: the same in-project write that auto-approves above goes to the prompt.
describe('write gate — a granted read-only folder is never a write path (S5.10)', () => {
  test('an in-project write inside a granted folder prompts, with allow_always stripped', async () => {
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx') });
    const r = await runTurn(
      projectA,
      () => 'reject',
      () => [join(projectA, '.design', 'ui')]
    );
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]?.scope?.reason).toBe('read-only-grant');
    expect(r.prompts[0]?.req.options?.some((o) => o.kind === 'allow_always')).toBe(false);
  });

  test('a getter that throws fails closed — every write prompts', async () => {
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx') });
    const r = await runTurn(
      projectA,
      () => 'reject',
      () => {
        throw new Error('grants unreadable');
      }
    );
    expect(r.prompts).toHaveLength(1);
  });
});

describe('write gate — in-project writes never prompt (DDR-184 regression guard)', () => {
  test('Write to an existing in-project file is auto-approved with NO client frame', async () => {
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx') });
    const r = await runTurn(projectA);
    // The load-bearing assertion of this entire feature's "no friction" half:
    // zero prompts forwarded to the UI.
    expect(r.prompts).toHaveLength(0);
    expect(r.outcome).toContain('"outcome":"selected"');
    // Auto-approval uses the ONCE-only option, never `allow_always` — the
    // latter makes the adapter install a session-wide standing rule for the
    // tool NAME, which would silently restore the unscoped Write grant this
    // change removes, from inside the code that removed it.
    expect(r.outcome).toContain('"optionId":"allow"');
    expect(r.outcome).not.toContain('allow_always');
    // Transparency still fires for EVERY request regardless of how it resolves
    // — auto-approving must not make a write invisible to an audit consumer.
    expect(r.transparency).toHaveLength(1);
  }, 20000);

  test('Write to a NEW in-project file is auto-approved', async () => {
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'brand-new.tsx') });
    const r = await runTurn(projectA);
    expect(r.prompts).toHaveLength(0);
    expect(r.outcome).toContain('"outcome":"selected"');
  }, 20000);

  test('Edit is gated the same way as Write', async () => {
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx'), tool: 'Edit' });
    const r = await runTurn(projectA);
    expect(r.prompts).toHaveLength(0);
  }, 20000);

  test('NotebookEdit — no `locations` at all — is judged via rawInput.notebook_path', async () => {
    useWriteAgent({ path: join(projectA, 'nb.ipynb'), tool: 'NotebookEdit' });
    const r = await runTurn(projectA);
    expect(r.prompts).toHaveLength(0);
  }, 20000);
});

describe('write gate — out-of-project writes prompt', () => {
  test('an absolute escape prompts and names the RESOLVED path', async () => {
    useWriteAgent({ path: join(projectB, 'stolen.conf') });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    const { scope } = r.prompts[0];
    expect(scope?.outOfProjectWrite).toBe(true);
    expect(scope?.reason).toBe('outside');
    expect(scope?.resolvedPaths).toEqual([join(projectB, 'stolen.conf')]);
    expect(scope?.scopeRoot).toBe(projectA);
  }, 20000);

  test('a `../` escape prompts with the path RESOLVED, not as the model wrote it', async () => {
    // `<projectA>/.design/../../project-b/stolen.conf` reads like a `.design`
    // edit. Rendering the model's string is what makes the prompt useless.
    const sneaky = join(projectA, '.design', '..', '..', 'project-b', 'stolen.conf');
    useWriteAgent({ path: sneaky });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0].scope?.resolvedPaths).toEqual([join(projectB, 'stolen.conf')]);
  }, 20000);

  test('DECISION D — `allow_always` is stripped from the offered options', async () => {
    useWriteAgent({ path: join(projectB, 'stolen.conf') });
    const r = await runTurn(projectA, () => 'reject');
    const kinds = r.prompts[0].req.options.map((o) => o.kind);
    expect(kinds).not.toContain('allow_always');
    // The reject path must survive the filter, or the card would have no way out.
    expect(kinds).toContain('reject_once');
    expect(kinds).toContain('allow_once');
  }, 20000);

  test('DECISION D — a crafted response naming `allow_always` FAILS CLOSED', async () => {
    // Filtering the option out of the UI is cosmetic on its own; the control is
    // that `resolvePermission` validates against the same filtered set, so a
    // hand-written WS frame can't pin the option that was never offered.
    useWriteAgent({ path: join(projectB, 'stolen.conf') });
    const r = await runTurn(projectA, () => 'allow_always');
    expect(r.outcome).toContain('"outcome":"cancelled"');
    expect(r.outcome).not.toContain('allow_always');
  }, 20000);

  test('an out-of-project write CAN still be approved per-call', async () => {
    // The gate is a consent boundary, not a prohibition — proving the allow
    // path works matters as much as proving the deny path does.
    useWriteAgent({ path: join(projectB, 'stolen.conf') });
    const r = await runTurn(projectA, () => 'allow');
    expect(r.outcome).toContain('"optionId":"allow"');
  }, 20000);
});

describe('write gate — fail-closed shapes', () => {
  test('a MISSING `tool_call` notification (no tool name) prompts instead of auto-approving', async () => {
    // The tool name has exactly one carrier. If a future adapter reorders or
    // drops that notification, the gate must degrade to "the user is asked" —
    // never to a silent allow. An in-project path is used deliberately: this
    // proves the miss itself is what forces the prompt.
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx'), omitToolCall: true });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    // No `scope` — the gate never judged it as a write, so the client must NOT
    // claim "outside this project" (it isn't; the name was simply unknown).
    expect(r.prompts[0].scope).toBeUndefined();
  }, 20000);

  test('a READ tool with an out-of-project path is NOT treated as a write', async () => {
    // Reads are deliberately unscoped (this change closes write egress, not
    // read). Read isn't on the allow-list in this test's bridge either, so it
    // prompts — but as an ORDINARY prompt, with no out-of-project write copy
    // and no option filtering.
    useWriteAgent({ path: join(projectB, 'secret.txt'), tool: 'Read' });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0].scope).toBeUndefined();
    expect(r.prompts[0].req.options.map((o) => o.kind)).toContain('allow_always');
  }, 20000);
});

describe('write gate — Task 11: the scope is the session origin project', () => {
  test('a session created under project A prompts for a write into project B', async () => {
    // Today a bridge's lifetime IS one project's lifetime, so this reads as
    // belt-and-braces. It is the Addendum's load-bearing invariant: once a
    // session survives a project switch, a gate that re-reads "the open
    // project" would hand A's session write access to B silently.
    useWriteAgent({ path: join(projectB, 'canvas.tsx') });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0].scope?.scopeRoot).toBe(projectA);
    expect(r.scopeRoot).toBe(projectA);
  }, 20000);

  test('the pinned root is resolved once and exposed read-only', async () => {
    useWriteAgent({ path: join(projectA, 'x.tsx') });
    const bridge = new AcpBridge({ repoRoot: projectA, onUpdate: () => {} });
    try {
      expect(bridge.writeScopeRoot).toBe(projectA);
      // No setter exists — the pin cannot be re-pointed at runtime, which is
      // the whole mechanism behind Solution E.
      expect(Object.getOwnPropertyDescriptor(bridge, 'writeScopeRoot')?.set).toBeUndefined();
    } finally {
      await bridge.stop();
    }
  });
});

describe('write gate — F2: granting is strict, warning is generous', () => {
  test('an UNKNOWN-name out-of-project write still strips allow_always and names the path', async () => {
    // SECURITY (security-auditor F2). The first cut coupled BOTH the grant and
    // the hardening to the strict `WRITE_TOOL_NAMES` check, so a missed/evicted/
    // reordered `tool_call` notification failed closed for the grant but OPEN
    // for the hardening: no `scope` ⇒ `allow_always` was NOT stripped (one click
    // installs a session-wide standing rule for Write — Decision D defeated) and
    // the card fell back to the model's own `Write docs/../../../.zshenv`
    // headline. The fixture omits the notification, so the name is genuinely
    // unknown — exactly that state.
    useWriteAgent({ path: join(projectB, 'stolen.conf'), omitToolCall: true });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    const { scope, req } = r.prompts[0];
    // Warned about, despite the unknown name …
    expect(scope?.outOfProjectWrite).toBe(true);
    expect(scope?.resolvedPaths).toEqual([join(projectB, 'stolen.conf')]);
    // … and Decision D still enforced.
    expect(req.options.map((o) => o.kind)).not.toContain('allow_always');
  }, 20000);

  test('an unknown name is still NEVER granted, even in-project', async () => {
    // The other half of the asymmetry: generosity applies only to warning.
    // Auto-approval still requires a confirmed write tool.
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx'), omitToolCall: true });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    // …and it must NOT claim "outside this project" — the file is inside; the
    // NAME was the unknown. A false scope claim would be its own bug.
    expect(r.prompts[0].scope).toBeUndefined();
  }, 20000);

  test('a READ of an out-of-project file is still NOT treated as a write', async () => {
    // The heuristic is `kind:'edit'` / `notebook_path`, deliberately NOT "has a
    // file_path" — Read carries one too, and would otherwise get the write copy
    // plus a pointlessly stripped allow_always.
    useWriteAgent({ path: join(projectB, 'secret.txt'), tool: 'Read', omitToolCall: true });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts[0].scope).toBeUndefined();
    expect(r.prompts[0].req.options.map((o) => o.kind)).toContain('allow_always');
  }, 20000);
});

describe('write gate — F6: `allow_always` is stripped from EVERY write-shaped card', () => {
  test('an IN-PROJECT write-shaped card still offers no `allow_always`', async () => {
    // SECURITY (security-auditor F6). The first cut tied the option filter to
    // `info`, which is only set when the target is OUTSIDE the project. So an
    // in-project write-shaped card that reached the prompt still offered
    // `allow_always` — and selecting it makes the adapter install a
    // `{type:'addRules', rules:[{toolName}]}` standing rule keyed by the tool
    // NAME, carrying no path scope whatsoever. One click on an inside-the-
    // project card therefore permanently permits every subsequent write by that
    // tool, INCLUDING out-of-project ones: the whole gate, undone from the safe-
    // looking side of it.
    //
    // `info` (copy — only truthful when outside) and `stripAlways` (control —
    // needed whenever the call is write-shaped) are now separate.
    //
    // Reached via an unknown tool name so the call is write-SHAPED but not
    // grantable, which is what puts an in-project write on a card at all.
    useWriteAgent({ path: join(projectA, '.design', 'ui', 'home.tsx'), omitToolCall: true });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts).toHaveLength(1);
    // No false "outside this project" claim — the file IS inside …
    expect(r.prompts[0].scope).toBeUndefined();
    // … and yet no standing-exemption option either.
    expect(r.prompts[0].req.options.map((o) => o.kind)).not.toContain('allow_always');
  }, 20000);

  test('a NON-write tool keeps its `allow_always` — the strip is scoped to writes', async () => {
    // Guard against over-correcting: stripping everywhere would quietly remove a
    // legitimate affordance from every ordinary tool card.
    useWriteAgent({ path: join(projectA, 'x.txt'), tool: 'Read', omitToolCall: true });
    const r = await runTurn(projectA, () => 'reject');
    expect(r.prompts[0].req.options.map((o) => o.kind)).toContain('allow_always');
  }, 20000);
});
