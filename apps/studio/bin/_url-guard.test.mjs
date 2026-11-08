// V2-8.9 re-check B2 — the browser helpers the AI chat runs without a prompt open only http(s) to
// this Mac. `screenshot --url file:///…/.ssh/id_ed25519` rendered a key into a PNG the agent read.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkFileDir, redactUrl, takeLinkFile, urlRefusal } from './_url-guard.mjs';

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
    expect(
      urlRefusal('http://localhost:4399/', chat({ MAUDE_OWN_PORTS: 'x,4399' }))
    ).not.toBeNull();
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

// sec-loopback-bearer §7.5, re-check B/C — a one-time opening link opens a full studio session, so no
// browser helper may take one from the caller (screenshot --url, canvas-rects, agent-browser-safe …).
// Only a link the helper minted itself, or the server handed it, passes (`allowLaunch`).
describe('B/C — never a Maude opening link', () => {
  const tok = `1800000000.${'a'.repeat(32)}.${'b'.repeat(64)}`;
  test.each([
    `http://localhost:4399/?maude-launch=${tok}`,
    `http://localhost:4399/index.html?open=a.tsx&maude-launch=${tok}`,
    `http://localhost:4399/?%6Daude-launch=${tok}`,
    `http://localhost:4399/?a=%zz&%6Daude-launch=${tok}`,
    `http://localhost:4399/?MAUDE-LAUNCH=${tok}`,
    `http://localhost:4399/?Maude%2DLaunch=${tok}`,
    `http://localhost:4399/?next=%2F%3Fmaude-launch%3D${tok}`,
    'http://localhost:4399/?x=%E0%A4%A',
  ])('refuses %s', (url) => {
    expect(urlRefusal(url)).not.toBeNull();
  });
  test('a link the helper minted itself passes with allowLaunch', () => {
    expect(
      urlRefusal(`http://localhost:4399/?maude-launch=${tok}`, {}, { allowLaunch: true })
    ).toBeNull();
    // the other rules still hold with it
    expect(urlRefusal('file:///etc/passwd', {}, { allowLaunch: true })).not.toBeNull();
  });
  test('a plain studio or capture URL passes', () => {
    expect(urlRefusal('http://localhost:4399/?open=a%20b.tsx')).toBeNull();
    expect(urlRefusal('http://localhost:51001/_canvas-shell.html?canvas=a.tsx&fc=abc')).toBeNull();
  });
  test('screenshot.sh --url <opening link> exits 2 before any browser starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'url-guard-'));
    try {
      const r = spawnSync(
        'bash',
        [
          join(BIN, 'screenshot.sh'),
          '--url',
          `http://localhost:4399/?a=%zz&%6Daude-launch=${tok}`,
          '--shell',
          '--out',
          join(dir, 'k.png'),
        ],
        { encoding: 'utf8', env: { ...process.env, MAUDE_AGENT_BROWSER: '/usr/bin/true' } }
      );
      expect(r.status).toBe(2);
      expect(r.stderr).not.toContain(tok);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// re-check A / confinement — `screenshot --url-file` is an auto-tier flag: it read the first line of ANY
// path (echoed back in the refusal) and deleted the file. It now takes only a link file the server wrote
// into its private folder (`<state>/maude/servers/links/<32 hex>.url`, 0600 in 0700, this user's, not
// a symlink); anything else is refused without being read or removed.
describe('A — the link file is confined to the server private folder', () => {
  const setup = () => {
    const state = mkdtempSync(join(tmpdir(), 'url-file-'));
    const env = { XDG_STATE_HOME: state, HOME: state };
    const dir = linkFileDir(env);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    return { state, env, dir };
  };
  const NAME = `${'c'.repeat(32)}.url`;
  test('a server link file is read once and removed', () => {
    const { state, env, dir } = setup();
    try {
      const f = join(dir, NAME);
      writeFileSync(f, 'http://localhost:4399/?maude-launch=x\n', { mode: 0o600 });
      expect(takeLinkFile(f, env)).toEqual({ url: 'http://localhost:4399/?maude-launch=x' });
      expect(existsSync(f)).toBe(false);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
  test.each([
    ['a file outside the folder', (s) => join(s.state, NAME)],
    ['a file with another name', (s) => join(s.dir, 'id_ed25519')],
    ['a relative escape', (s) => join(s.dir, '..', NAME)],
  ])('%s is neither read nor removed', (_label, at) => {
    const s = setup();
    try {
      const f = at(s);
      writeFileSync(f, 'SECRET-LINE\n', { mode: 0o600 });
      const r = takeLinkFile(f, s.env);
      expect(r.error).toBeTruthy();
      expect(JSON.stringify(r)).not.toContain('SECRET');
      expect(existsSync(f)).toBe(true);
    } finally {
      rmSync(s.state, { recursive: true, force: true });
    }
  });
  test('a symlink, a group-readable file or an open folder is refused', () => {
    const s = setup();
    try {
      const target = join(s.state, 'secret');
      writeFileSync(target, 'SECRET\n', { mode: 0o600 });
      const link = join(s.dir, NAME);
      symlinkSync(target, link);
      expect(takeLinkFile(link, s.env).error).toBeTruthy();
      expect(existsSync(target)).toBe(true);
      rmSync(link);
      writeFileSync(link, 'http://localhost:1/\n', { mode: 0o644 });
      chmodSync(link, 0o644);
      expect(takeLinkFile(link, s.env).error).toBeTruthy();
      chmodSync(link, 0o600);
      chmodSync(s.dir, 0o755);
      expect(takeLinkFile(link, s.env).error).toBeTruthy();
      expect(existsSync(link)).toBe(true);
    } finally {
      rmSync(s.state, { recursive: true, force: true });
    }
  });
  test('screenshot.sh --url-file <any file> exits 2, leaves it and never prints it', () => {
    const s = setup();
    try {
      const f = join(s.state, 'notes.txt');
      writeFileSync(f, 'SECRET-LINE\n');
      const r = spawnSync(
        'bash',
        [join(BIN, 'screenshot.sh'), '--url-file', f, '--shell', '--out', join(s.state, 'k.png')],
        {
          encoding: 'utf8',
          env: { ...process.env, ...s.env, MAUDE_AGENT_BROWSER: '/usr/bin/true' },
        }
      );
      expect(r.status).toBe(2);
      expect(r.stderr).not.toContain('SECRET');
      expect(existsSync(f)).toBe(true);
    } finally {
      rmSync(s.state, { recursive: true, force: true });
    }
  });
  test('redactUrl hides opening links and frame capabilities', () => {
    expect(redactUrl('http://l:1/?a=1&maude-launch=1.2.3&fc=abc#x')).toBe(
      'http://l:1/?a=1&maude-launch=…&fc=…#x'
    );
  });
});
