// V2-8.9 re-check B2 — the browser helpers the AI chat runs without a prompt open only http(s) to
// this Mac. `screenshot --url file:///…/.ssh/id_ed25519` rendered a key into a PNG the agent read.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { urlRefusal } from './_url-guard.mjs';

const BIN = import.meta.dir;

describe('urlRefusal', () => {
  test.each([
    'http://localhost:4399/_canvas-shell.html?canvas=ui/a.tsx',
    'http://localhost:4399/_canvas-shell.html?canvas=ui/a.tsx&dsMode=dark',
    'http://127.0.0.1:5173/',
    'https://127.0.0.2/',
    'http://[::1]:4399/',
    'http://127.1/',
    'http://LOCALHOST:4399/',
  ])('allows %s', (url) => {
    expect(urlRefusal(url)).toBeNull();
  });

  test.each([
    'file:///etc/passwd',
    'file:///Users/u/.ssh/id_ed25519',
    'FILE:///etc/hosts',
    'view-source:http://localhost/',
    'data:text/html,<script>fetch("https://x.example")</script>',
    'javascript:alert(1)',
    'chrome://settings',
    'about:blank',
    'https://example.com/',
    'http://192.168.1.1/',
    'http://10.0.0.1/',
    'http://0.0.0.0:4399/',
    'http://localhost.evil.example/',
    'http://127.0.0.1.nip.io/',
    'http://localhost:80@evil.example/',
    'http://user:pw@localhost/',
    'http://local\thost/',
    'http://localhost\\@evil.example/',
    ' http://localhost/',
    '',
  ])('refuses %s', (url) => {
    expect(urlRefusal(url)).not.toBeNull();
  });
});

describe('the helpers call it before any browser starts', () => {
  test('screenshot.sh --url file:// exits 2 and names the rule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'url-guard-'));
    try {
      const probe = join(dir, 'probe.txt');
      writeFileSync(probe, 'SECRET\n');
      const r = spawnSync(
        'bash',
        [
          join(BIN, 'screenshot.sh'),
          '--url',
          `file://${probe}`,
          '--full',
          '--out',
          join(dir, 'k.png'),
        ],
        // A browser that would succeed if reached: the guard must stop the run before it.
        { encoding: 'utf8', env: { ...process.env, MAUDE_AGENT_BROWSER: '/usr/bin/true' } }
      );
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('only http(s) URLs to this Mac');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('agent-browser-safe open file:// exits 2', () => {
    const r = spawnSync(
      'node',
      [join(BIN, '_agent-browser-safe.mjs'), 'open', 'file:///etc/passwd'],
      {
        encoding: 'utf8',
      }
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('only http(s) URLs to this Mac');
  });

  test.each([
    'canvas-rects.sh',
    'perf.sh',
    'smoke.sh',
    'visual-sanity.sh',
    'photo-bg-remove.sh',
  ])('%s checks its URL with the guard', (helper) => {
    const src = readFileSync(join(BIN, helper), 'utf8');
    expect(src).toContain('maude_url_guard "$URL" || exit 2');
  });
});

// V2-8.9 re-check 2 H-a — "loopback" was every Maude server on this Mac: from project X the agent
// opened http://127.0.0.1:4400/.mcp.json (project Y's terminal server) and read it. In a Maude chat
// the bridge exports this session's own ports (MAUDE_OWN_PORTS); any other port is refused, and a
// chat without the key fails closed. A terminal keeps the plain loopback rule.
describe('H-a — a Maude chat opens only its own server ports', () => {
  const chat = (extra = {}) => ({ MAUDE_AGENT_ACTOR: 'maude-chat', ...extra });
  test('own main / canvas / capture ports pass', () => {
    const env = chat({ MAUDE_OWN_PORTS: '4399,51000,51001' });
    for (const u of [
      'http://localhost:4399/_canvas-shell.html',
      'http://127.0.0.1:51000/',
      'http://[::1]:51001/x',
    ])
      expect(urlRefusal(u, env)).toBeNull();
  });
  test('another Maude server on this Mac is refused', () => {
    const env = chat({ MAUDE_OWN_PORTS: '4399,51000,51001' });
    expect(urlRefusal('http://127.0.0.1:4400/.mcp.json', env)).toContain('port');
    expect(urlRefusal('http://localhost/', env)).toContain('port'); // implicit :80
    expect(urlRefusal('https://localhost/', env)).toContain('port'); // implicit :443
  });
  test('a chat with no (or a garbled) port list fails closed', () => {
    expect(urlRefusal('http://localhost:4399/', chat())).not.toBeNull();
    expect(urlRefusal('http://localhost:4399/', chat({ MAUDE_OWN_PORTS: 'x,4399' }))).not.toBeNull();
    expect(
      urlRefusal('http://localhost:4399/', { MAUDE_CHAT_ID: 'c1', MAUDE_OWN_PORTS: '' })
    ).not.toBeNull();
  });
  test('a terminal (no chat markers) keeps the loopback rule', () => {
    expect(urlRefusal('http://127.0.0.1:4400/', {})).toBeNull();
  });
  test('the CLI reads the env: another port exits 2', () => {
    const r = spawnSync('node', [join(BIN, '_url-guard.mjs'), 'http://127.0.0.1:4400/.mcp.json'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, MAUDE_AGENT_ACTOR: 'maude-chat', MAUDE_OWN_PORTS: '4399' },
    });
    expect(r.status).toBe(2);
  });
});
