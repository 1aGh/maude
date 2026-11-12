// E2E finding (scripts/acp-e2e-local.ts, 2026-11-12) — "AI may search the web: off" did not hold a
// downloader named by its PATH: opencode's `bash` asked to run `/usr/bin/curl -sS http://…`, the
// gate did not refuse it (rule 4), it raised a card instead, and when the person approved, curl
// reached the server. `DOWNLOADER_RE` matched `curl` only after whitespace or a shell operator, so
// `/usr/bin/curl`, `"curl"` and `\curl` all slipped past the web-off switch — for Claude too
// (`mayRefusal`), and in the bridge gate for every bridge-enforced agent (`mayRefusalByKind`).

import { describe, expect, test } from 'bun:test';

import { agentById } from '../acp/agents/catalog.ts';
import type { PolicyCtx } from '../acp/agents/descriptor.ts';
import { type AiMay, mayRefusal } from '../acp/may-scope.ts';
import { gatePermission } from '../acp/policy/enforce.ts';

const repo = '/tmp/maude-may-abs/project';
const NO_WEB: AiMay = { assets: true, web: false };
const call = (command: string) => ({ kind: 'execute', rawInput: { command } });

describe('web off refuses a downloader however it is spelled', () => {
  for (const command of [
    '/usr/bin/curl -sS -m 5 http://127.0.0.1:9/',
    '/opt/homebrew/bin/wget https://a.test',
    'env /usr/bin/curl https://a.test',
    'cd x && ./bin/aria2c https://a.test',
    '"curl" https://a.test',
    "'wget' https://a.test",
    '\\curl https://a.test',
  ]) {
    test(command, () => {
      expect(mayRefusal('Bash', call(command), NO_WEB, repo, [])).toBe('web');
    });
  }
  test('what is not a downloader stays allowed', () => {
    for (const command of [
      'echo curly',
      'cat notes.md',
      'maude design curl-local http://127.0.0.1:4399/_health',
      'ls /usr/bin/curlish',
    ]) {
      expect(mayRefusal('Bash', call(command), NO_WEB, repo, [])).toBeNull();
    }
  });
  test('web on: no refusal', () => {
    expect(
      mayRefusal(
        'Bash',
        call('/usr/bin/curl https://a.test'),
        { assets: true, web: true },
        repo,
        []
      )
    ).toBeNull();
  });
});

describe('the bridge gate (rule 4) refuses it for a bridge-enforced agent, no card', () => {
  test('opencode bash /usr/bin/curl with web off → reject web', () => {
    const d = agentById('opencode');
    if (!d) throw new Error('no opencode');
    const ctx: PolicyCtx = {
      scopeRoot: repo,
      readRoots: [repo],
      writeRoots: [repo],
      credentialPaths: { dirs: [], files: [] },
      may: NO_WEB,
      designRoots: [`${repo}/.design`],
      agentBin: '/opt/homebrew/bin/opencode',
      hostEnv: { HOME: '/tmp/maude-may-abs/home' },
      chatKeyStored: false,
    };
    const r = gatePermission(
      {
        toolCall: {
          toolCallId: 'call_1',
          kind: 'execute',
          title: '/usr/bin/curl -sS -m 5 http://127.0.0.1:9/',
          rawInput: { command: '/usr/bin/curl -sS -m 5 http://127.0.0.1:9/' },
        },
        options: [
          { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
      d,
      ctx,
      { home: '/tmp/maude-may-abs/home' }
    );
    expect(r.decision).toBe('reject');
    expect(r.reason).toBe('web');
  });
});
