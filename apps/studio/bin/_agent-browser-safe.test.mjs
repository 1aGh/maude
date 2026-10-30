// DDR-185 security addendum, round 3 — the hardened agent-browser wrapper
// behind `maude design agent-browser-safe`
// (apps/studio/bin/_agent-browser-safe.mjs). This suite locks the SECURITY
// CORE: the closed subcommand allow-list (no cookies/clipboard/storage/
// connect/chat/eval reachable — `eval` was REMOVED in round 3, see below),
// the fixed positional-argument ARITY per subcommand with NO flag
// vocabulary at all, and the `--config`-pin + full env-clearing that closes
// the project-level `agent-browser.json` auto-discovery bypass a live
// adversarial pass found round 2 never considered.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  ALLOWED_SUBCOMMANDS,
  CLEARED_ENV_KEYS,
  SUBCOMMAND_ARITY,
  safeEnv,
  validateArgv,
} from './_agent-browser-safe.mjs';

describe('validateArgv — subcommand allow-list', () => {
  for (const sub of ALLOWED_SUBCOMMANDS) {
    test(`accepts "${sub}" with its minimum expected argument count`, () => {
      const [min] = SUBCOMMAND_ARITY[sub];
      // `open` takes a URL, and only http(s) to this Mac passes (V2-8.9 B2).
      const args = Array.from({ length: min }, (_, i) =>
        sub === 'open' ? 'http://localhost:4399/' : `arg${i}`
      );
      expect(validateArgv([sub, ...args])).toBeNull();
    });
  }

  test('round 3: "eval" is REMOVED — arbitrary JS execution can\'t be argv-constrained (ethical-hacker Finding 1)', () => {
    // Round 2 kept eval on the allow-list; a live adversarial pass proved
    // eval defeats --allowed-domains entirely (window.location.href escapes
    // the navigation gate; a no-cors fetch() exfiltrates without even
    // needing a domain match) — no argv check can close that, so the
    // capability itself is cut, mirroring this DDR's own `find` precedent.
    expect(ALLOWED_SUBCOMMANDS).not.toContain('eval');
    const reason = validateArgv(['eval', '1+1']);
    expect(reason).toContain('eval');
  });

  for (const sub of [
    'cookies',
    'clipboard',
    'storage',
    'connect',
    'chat',
    'upload',
    'auth',
    'profiles',
  ]) {
    test(`rejects the credential/session-hijack-capable subcommand "${sub}" (ethical-hacker Finding D)`, () => {
      const reason = validateArgv([sub, 'get']);
      expect(reason).toContain(sub);
    });
  }

  test('rejects when no subcommand is given', () => {
    expect(validateArgv([])).not.toBeNull();
  });
});

describe('validateArgv — fixed arity, NO flag vocabulary at all', () => {
  test('rejects an extra argument beyond the expected arity, whatever it looks like', () => {
    const reason = validateArgv(['open', 'http://localhost:1', 'extra']);
    expect(reason).toContain('exactly 1');
  });

  test('rejects the --provider/-p remote-cloud-browser PoC verbatim (round-2 finding)', () => {
    expect(
      validateArgv(['open', 'http://localhost:1', '--provider', 'browserbase'])
    ).not.toBeNull();
    expect(validateArgv(['open', '-p', 'browserbase', 'http://localhost:1'])).not.toBeNull();
  });

  test('rejects the persistent-profile PoC verbatim (still closed under the arity model)', () => {
    expect(
      validateArgv(['open', '--profile', 'Default', 'https://github.com/settings/tokens'])
    ).not.toBeNull();
  });

  test('rejects the CDP-attach PoC verbatim (still closed under the arity model)', () => {
    expect(validateArgv(['snapshot', '--cdp', '9222'])).not.toBeNull();
  });

  test('a positional value that itself starts with "-" is NOT mistaken for a flag (arity-based, not prefix-based)', () => {
    // agent-browser-safe get "-weird-thing" must still work — the arity
    // model looks at COUNT, not at whether a token happens to start with a
    // dash.
    expect(validateArgv(['get', '-weird-thing'])).toBeNull();
  });

  test('screenshot accepts 0 or 1 positional args (optional path)', () => {
    expect(validateArgv(['screenshot'])).toBeNull();
    expect(validateArgv(['screenshot', '/tmp/out.png'])).toBeNull();
    expect(validateArgv(['screenshot', '/tmp/out.png', 'extra'])).not.toBeNull();
  });

  test('get accepts 1 or 2 positional args (thing + optional selector)', () => {
    expect(validateArgv(['get', 'text'])).toBeNull();
    expect(validateArgv(['get', 'text', '.selector'])).toBeNull();
    expect(validateArgv(['get'])).not.toBeNull();
  });

  test('snapshot and close accept exactly 0 arguments', () => {
    expect(validateArgv(['snapshot'])).toBeNull();
    expect(validateArgv(['snapshot', '-i'])).not.toBeNull();
    expect(validateArgv(['close'])).toBeNull();
    expect(validateArgv(['close', '--all'])).not.toBeNull();
  });

  test('an ordinary allowed invocation with no extra args passes', () => {
    expect(validateArgv(['open', 'http://localhost:3000/'])).toBeNull();
    expect(validateArgv(['screenshot', '/tmp/out.png'])).toBeNull();
  });
});

describe('CLEARED_ENV_KEYS', () => {
  test('round 3: covers AGENT_BROWSER_CONFIG (defense in depth alongside the --config pin)', () => {
    expect(CLEARED_ENV_KEYS).toContain('AGENT_BROWSER_CONFIG');
  });

  test('round 2: covers the three vars a live verification pass found missing from round 1', () => {
    for (const key of [
      'AGENT_BROWSER_AUTO_CONNECT',
      'AGENT_BROWSER_PROXY',
      'AGENT_BROWSER_ENGINE',
    ]) {
      expect(CLEARED_ENV_KEYS).toContain(key);
    }
  });

  test('covers all four standard proxy env vars, both cases', () => {
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      expect(CLEARED_ENV_KEYS).toContain(key);
    }
  });

  test('still covers the original round-1 set', () => {
    for (const key of [
      'AGENT_BROWSER_PROFILE',
      'AGENT_BROWSER_SESSION_NAME',
      'AGENT_BROWSER_ACTION_POLICY',
      'AGENT_BROWSER_CONFIRM_ACTIONS',
      'AGENT_BROWSER_CONFIRM_INTERACTIVE',
    ]) {
      expect(CLEARED_ENV_KEYS).toContain(key);
    }
  });
});

describe('the forced --config target (round 3: closes ./agent-browser.json auto-discovery)', () => {
  test('_agent-browser-safe-config.json exists and is valid, empty JSON', () => {
    // Must stay valid JSON — agent-browser exits with an error if --config
    // points to a missing/invalid file, which would break every allowed
    // subcommand, not just fail safe.
    const raw = readFileSync(new URL('./_agent-browser-safe-config.json', import.meta.url), 'utf8');
    expect(JSON.parse(raw)).toEqual({});
  });
});

// V2-8.9 re-check 2 H-b — with "Search the web" off the bridge sets MAUDE_NO_EGRESS=1, but this
// wrapper cleared AGENT_BROWSER_PROXY and never set the dead proxy (_no-egress.sh is sourced by the
// shell helpers only): a repo .html opened here could navigate or <img> out. Same rule as the helpers.
describe('safeEnv — MAUDE_NO_EGRESS is honoured after the env is cleared', () => {
  test('web off: the dead loopback proxy, no bypass lists, WebRTC proxied-only, its own session', () => {
    const env = safeEnv({
      MAUDE_NO_EGRESS: '1',
      AGENT_BROWSER_PROXY: 'http://evil.example:8080',
      AGENT_BROWSER_PROXY_BYPASS: '*',
      NO_PROXY: '*',
      no_proxy: '*',
      HTTPS_PROXY: 'http://evil.example:8080',
    });
    expect(env.AGENT_BROWSER_PROXY).toBe('http://127.0.0.1:9');
    expect(env.AGENT_BROWSER_PROXY_BYPASS).toBeUndefined();
    expect(env.NO_PROXY).toBeUndefined();
    expect(env.no_proxy).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.AGENT_BROWSER_ARGS).toContain(
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
    );
    expect(env.AGENT_BROWSER_SESSION).toBe('default-noegress');
    expect(env.AGENT_BROWSER_ALLOWED_DOMAINS).toBe('localhost,127.0.0.1');
  });
  test('web on: no proxy at all, the ambient one cleared', () => {
    const env = safeEnv({ AGENT_BROWSER_PROXY: 'http://evil.example:8080' });
    expect(env.AGENT_BROWSER_PROXY).toBeUndefined();
    expect(env.AGENT_BROWSER_SESSION).toBeUndefined();
  });
});
