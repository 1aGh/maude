// DDR-184 (+ DDR-185, hardened per its security addendum) — the curated tool
// allow-list the bridge auto-approves so the design workflow never stalls on
// a per-edit / per-`maude` permission prompt (the "Manual mode blocks every
// edit" complaint). Three things under test:
//
//   (1) WIRE contract — the list lands on `_meta.claudeCode.options.allowedTools`
//       (SDK `allowedTools`, sdk.d.ts:1331), coexisting with the DDR-144
//       `settingSources` narrowing and the DDR-143 `plugins` carrier. Same
//       adapter/SDK-INTERNAL `_meta` path as acp-session-plugins.test.ts — a
//       bump that stops forwarding it must fail HERE, not silently re-prompt.
//   (2) SOURCE-OF-TRUTH guard — the Bash rules are EXACTLY `Bash(maude:*)`
//       plus a closed read-only fs verb set (DDR-185) — nothing else. A
//       security fan-out found the ORIGINAL DDR-185 cut's `Bash(agent-browser:*)`
//       entry was a zero-confirmation session-hijack primitive (agent-browser's
//       own bundled skill recommends a persistent, real-login Chrome profile)
//       and `Bash(find:*)` was unrestricted command execution via `-exec`, not
//       "mutation" as first characterized — both are cut, not patched, because
//       neither residual is fixable via prefix-matching. `agent-browser` is
//       now reached ONLY through the hardened `agent-browser-safe` verb
//       (`Bash(maude:*)` covers it — no separate allow-list entry). If any of
//       this drifts, this test fails loudly.
//   (3) `WebSearch`/`WebFetch` (DDR-185) are present as bare native tool names
//       — no prefix-matching involved, so no source-of-truth guard needed the
//       way the Bash rules need one.
//   (4) NO WRITE TOOL is on this list (feature-acp-write-path-scope). This
//       file used to assert the exact opposite — that Edit/Write/NotebookEdit
//       WERE present — so read the test's own comment before "restoring" it.
//       Write auto-approval moved into the bridge's path gate, which is the
//       only place a per-call target path exists; see acp-write-scope.test.ts.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MAUDE_DEFAULT_ALLOWED_TOOLS, newSessionParams } from '../acp/bridge.ts';
import type { SdkPluginConfig } from '../acp/plugin-bootstrap.ts';
import { WRITE_TOOL_NAMES } from '../acp/write-scope.ts';

type Meta = {
  systemPrompt?: { append?: string };
  claudeCode?: {
    options?: {
      allowedTools?: string[];
      plugins?: SdkPluginConfig[];
      settingSources?: string[];
    };
  };
};

const PLUGINS: SdkPluginConfig[] = [
  { type: 'local', path: '/bundle/plugins/design', skipMcpDiscovery: true },
];

describe('newSessionParams — allowedTools carrier shape (DDR-184)', () => {
  test('the allow-list rides _meta.claudeCode.options.allowedTools', () => {
    const opts = (newSessionParams('/repo', undefined)._meta as Meta).claudeCode?.options;
    expect(opts?.allowedTools).toEqual([...MAUDE_DEFAULT_ALLOWED_TOOLS]);
  });

  test('allowedTools is a COPY, not the shared module constant (no accidental mutation)', () => {
    const opts = (newSessionParams('/repo')._meta as Meta).claudeCode?.options;
    expect(opts?.allowedTools).not.toBe(MAUDE_DEFAULT_ALLOWED_TOOLS);
  });

  test('coexists with settingSources (DDR-144) and plugins (DDR-143) under one options', () => {
    const opts = (newSessionParams('/repo', 'BRIEF', PLUGINS)._meta as Meta).claudeCode?.options;
    expect(opts?.settingSources).toEqual(['user']);
    expect(opts?.plugins).toEqual(PLUGINS);
    expect(opts?.allowedTools).toEqual([...MAUDE_DEFAULT_ALLOWED_TOOLS]);
  });

  test('present even with no plugins (npm / web / power-user path)', () => {
    const opts = (newSessionParams('/repo', 'BRIEF', [])._meta as Meta).claudeCode?.options;
    expect(opts?.plugins).toBeUndefined();
    expect(opts?.allowedTools).toEqual([...MAUDE_DEFAULT_ALLOWED_TOOLS]);
  });
});

describe('MAUDE_DEFAULT_ALLOWED_TOOLS — source-of-truth guard (DDR-184 / DDR-062)', () => {
  const bashRules = MAUDE_DEFAULT_ALLOWED_TOOLS.filter((t) => t.startsWith('Bash'));

  test('the READ-ONLY file tools are present', () => {
    for (const t of ['Read', 'Glob', 'Grep']) {
      expect(MAUDE_DEFAULT_ALLOWED_TOOLS).toContain(t);
    }
  });

  test('NO write tool is name-allowed — they are path-gated instead (feature-acp-write-path-scope)', () => {
    // This assertion is the whole point of the change, so it is worth being
    // explicit about WHY it inverts what this file used to assert.
    //
    // A bare tool name on this list means the CLI approves the call itself and
    // `requestPermission` is NEVER invoked — so a path condition cannot be
    // attached to an entry here, at all. Auto-approving a write therefore had
    // to be moved into the bridge's own gate (`classifyWrite` →
    // `writeTargetsInsideProject`), where a per-call path exists. DDR-184's
    // no-prompt-per-edit outcome is fully preserved for in-project writes; what
    // changed is that a write to `~/.zshenv` now prompts instead of landing
    // silently with no rollback.
    //
    // If someone "fixes" a re-prompting regression by putting Write back on this
    // list, this test is what tells them they just reopened the hole.
    for (const t of [...WRITE_TOOL_NAMES]) {
      expect(MAUDE_DEFAULT_ALLOWED_TOOLS).not.toContain(t);
    }
    // Guard the shape too — an `Edit(...)`-style scoped entry would also bypass
    // the bridge gate, and `not.toContain` on the bare name would miss it.
    for (const t of MAUDE_DEFAULT_ALLOWED_TOOLS) {
      const bare = t.replace(/\(.*$/, '');
      expect(WRITE_TOOL_NAMES.has(bare)).toBe(false);
    }
  });

  test('WebSearch and WebFetch are present (DDR-185)', () => {
    for (const t of ['WebSearch', 'WebFetch']) {
      expect(MAUDE_DEFAULT_ALLOWED_TOOLS).toContain(t);
    }
  });

  test('the Bash rules are EXACTLY this closed set — never a bare/un-scoped Bash', () => {
    // A bare `Bash` (or `Bash(*)`) would auto-approve arbitrary command execution
    // — exactly the blanket surface DDR-179 kept behind the prompt. Guard against
    // anyone widening it: the list may auto-approve `maude` and the closed
    // read-only fs verb set (DDR-185) — nothing else. In particular:
    //   - `Bash(curl:*)` must NEVER appear — curl is routed through the
    //     `curl-local` verb (covered by `Bash(maude:*)`) instead.
    //   - `Bash(agent-browser:*)` must NEVER appear — a security fan-out found
    //     it was a zero-confirmation session-hijack primitive; agent-browser is
    //     routed through the `agent-browser-safe` verb instead.
    //   - `Bash(find:*)` must NEVER appear — `find -exec` is unrestricted
    //     command execution, not "mutation"; there is no verb substitute, it
    //     is simply cut.
    //   - the read-only fs verb group must NEVER appear — every one of them
    //     accepts `>`, making the rule an arbitrary-write grant. See the
    //     dedicated test below.
    expect(bashRules).toEqual(['Bash(maude:*)']);
  });

  test('NO redirect-capable bare-command Bash rule — `cat > file` is an arbitrary write (F1)', () => {
    // SECURITY (security-auditor F1, PoC'd live against claude 2.1.220). The
    // read-only fs group (ls/cat/pwd/head/tail/wc/tree/file/stat) USED to be on
    // this list, justified as adding no incremental READ capability. True, and
    // beside the point: Claude Code's `Bash(<cmd>:*)` prefix rule does not
    // reject shell redirection, so `cat > ~/.zshenv <<'EOF' … EOF` matched
    // `Bash(cat:*)`, was self-approved by the CLI, never reached
    // `requestPermission`, and wrote model-authored arbitrary content to an
    // arbitrary path — with no write tool involved at all. That is the A2
    // primitive the write-path gate exists to close, reachable by a CHEAPER
    // route than the write tools themselves.
    //
    // Cut rather than patched (same call DDR-185 made for `find` and
    // `agent-browser`): a prefix rule cannot inspect what follows the command
    // name, so there is nothing to patch. If they come back, they must come
    // back as a hardened `maude design` wrapper verb, which CAN reject `>`.
    //
    // This test is what makes re-adding any of them a loud failure rather than
    // a silent reopening of the hole.
    for (const verb of ['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'tree', 'file', 'stat']) {
      expect(MAUDE_DEFAULT_ALLOWED_TOOLS).not.toContain(`Bash(${verb}:*)`);
    }
  });

  test('the `maude` Bash rule is load-bearing on DDR-062: every design helper is a `maude design <verb>`', () => {
    // Resolve cli/commands/design.mjs relative to this test file's real path
    // (mirrors acp-session-plugins.test.ts's realpath dance for compiled roots).
    const here = dirname(realpathSync(import.meta.url.replace('file://', '')));
    const designCli = join(here, '..', '..', '..', 'cli', 'commands', 'design.mjs');
    expect(existsSync(designCli)).toBe(true);
    const src = readFileSync(designCli, 'utf8');
    // The dispatch table the `Bash(maude:*)` scope rests on — helpers reached via
    // `maude design <verb>`, not raw `bash <path>.sh` (DDR-062). If this marker
    // disappears, the one-rule assumption needs re-checking.
    expect(src).toContain('BIN_VERBS');
    expect(src).toMatch(/maude design <verb>/);
  });

  test('the `curl-local` verb exists and is reached via `maude design <verb>` (DDR-185)', () => {
    // The mechanism the `Bash(agent-browser:*)`/fs-list comment in bridge.ts
    // promises for curl: real host enforcement via a first-party verb, not a
    // Bash prefix rule. If this verb disappears from BIN_VERBS, the DDR-185
    // curl story (and the bootstrap-brief nudge pointing at it) goes stale.
    const here = dirname(realpathSync(import.meta.url.replace('file://', '')));
    const designCli = join(here, '..', '..', '..', 'cli', 'commands', 'design.mjs');
    const src = readFileSync(designCli, 'utf8');
    expect(src).toMatch(/'curl-local'/);
  });

  test('the `agent-browser-safe` verb exists and is reached via `maude design <verb>` (DDR-185 security addendum)', () => {
    // The replacement for the reverted `Bash(agent-browser:*)` entry — real
    // subcommand/flag enforcement via a first-party verb, not a Bash prefix
    // rule. If this verb disappears from BIN_VERBS, motion-critic.md/edit.md's
    // documented raw agent-browser calls go back to prompting (not silently
    // insecure — but the friction-reduction this DDR promises goes stale).
    const here = dirname(realpathSync(import.meta.url.replace('file://', '')));
    const designCli = join(here, '..', '..', '..', 'cli', 'commands', 'design.mjs');
    const src = readFileSync(designCli, 'utf8');
    expect(src).toMatch(/'agent-browser-safe'/);
  });

  test('plugin markdown no longer documents a RAW agent-browser SCREENSHOT/OPEN/NAVIGATE call (DDR-185 security addendum)', () => {
    // motion-critic.md and edit.md are the two files that originally justified
    // `Bash(agent-browser:*)` (raw calls not reached via `maude design <verb>`).
    // screenshot/open/navigate now go through the hardened wrapper — a
    // regression here means either those calls silently went back to
    // prompting every time, or (worse) someone re-introduced a raw call the
    // allow-list no longer covers. `eval` is the deliberate exception (round
    // 3: removed from the wrapper's own allow-list entirely — arbitrary JS
    // execution can't be argv-constrained — so it's EXPECTED to stay a raw,
    // prompting `agent-browser eval` call; see both files' own comments).
    const here = dirname(realpathSync(import.meta.url.replace('file://', '')));
    const pluginsDir = join(here, '..', '..', '..', 'plugins', 'design');
    // A command is an index plus linked stage files (per-host packaging):
    // read the index and every local markdown file it links, one level deep.
    const withLinked = (rel: string) => {
      const text = readFileSync(join(pluginsDir, rel), 'utf8');
      const dir = dirname(join(pluginsDir, rel));
      const linked = [...text.matchAll(/\]\((\.{0,2}\/?[^)#\s]+\.md)\)/g)].map((m) => {
        try {
          return readFileSync(join(dir, m[1] as string), 'utf8');
        } catch {
          return '';
        }
      });
      return [text, ...linked].join('\n');
    };
    for (const rel of ['agents/motion-critic.md', 'commands/edit.md']) {
      const src = withLinked(rel);
      expect(src).not.toMatch(/(?<!maude design )agent-browser (screenshot|open|navigate)\b/);
      expect(src).toContain('agent-browser eval'); // deliberately raw — see comment above
    }
    // Only motion-critic.md actually calls the wrapper (for `screenshot`) —
    // edit.md's sole agent-browser use was `eval`, which reverted fully to
    // raw, so it has no `agent-browser-safe` invocation left at all.
    const motionCritic = readFileSync(join(pluginsDir, 'agents/motion-critic.md'), 'utf8');
    expect(motionCritic).toContain('maude design agent-browser-safe');
  });

  test('agent-browser-safe does NOT support eval (DDR-185 round-3 security addendum)', () => {
    // A future accidental re-add of eval to the wrapper's own allow-list
    // would silently reopen the zero-click session-hijack chain (ethical-
    // hacker Finding 1: eval's fetch()/window.location defeat
    // --allowed-domains entirely, and no argv check can constrain arbitrary
    // JS execution). Source-of-truth guard against bridge.ts's own wrapper.
    const here = dirname(realpathSync(import.meta.url.replace('file://', '')));
    const wrapperPath = join(here, '..', 'bin', '_agent-browser-safe.mjs');
    const src = readFileSync(wrapperPath, 'utf8');
    expect(src).not.toMatch(/^\s*eval:\s*\[/m);
  });
});
