// Plumbing for hub-scenarios.mjs: processes (killed by pid / process group, never by name),
// an HTTP client that speaks to the hub the way a browser behind the reverse proxy does,
// the identity provider's own sign-in page (https, for the real browser), and an
// agent-browser wrapper.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The issuer the hub's test seam answers for (apps/hub/test/_fake-issuer.mjs). */
export const ISSUER = 'https://auth.example.test';
export const ISSUER_HOST = 'auth.example.test';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check, { timeoutMs = 30_000, everyMs = 250 } = {}) {
  const started = Date.now();
  for (;;) {
    let value = null;
    try {
      value = await check();
    } catch {
      value = null;
    }
    if (value) return { ok: true, ms: Date.now() - started, value };
    if (Date.now() - started > timeoutMs) return { ok: false, ms: Date.now() - started };
    await sleep(everyMs);
  }
}

export const freePort = () =>
  new Promise((res, rej) => {
    const s = createNetServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

/* --------------------------------------------------------------- processes */

/** Every process this run started, so the exit path can take all of them down by pid. */
const started = new Set();

/**
 * Spawn detached (its own process group) with output in a file. The group is what makes
 * "kill the hub" also end the studio child it supervises, without matching any name.
 */
export function spawnLogged(name, cmd, args, { env, cwd, logDir }) {
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${name}.log`);
  const fd = openSync(logPath, 'a');
  const proc = spawn(cmd, args, { env, cwd, detached: true, stdio: ['ignore', fd, fd] });
  proc.unref();
  const handle = { name, pid: proc.pid, proc, logPath, exited: false };
  proc.once('exit', () => {
    handle.exited = true;
  });
  started.add(handle);
  return handle;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** End a process group this run started. `hard` is SIGKILL at once (a crash, not a shutdown). */
export async function killGroup(handle, { hard = false } = {}) {
  if (!handle?.pid) return;
  const signal = (sig) => {
    try {
      process.kill(-handle.pid, sig);
    } catch {
      try {
        process.kill(handle.pid, sig);
      } catch {
        /* already gone */
      }
    }
  };
  if (!hard) {
    signal('SIGTERM');
    const gone = await waitFor(() => !alive(handle.pid), { timeoutMs: 8_000, everyMs: 100 });
    if (gone.ok) {
      // the group may still hold a grandchild that ignored SIGTERM
      signal('SIGKILL');
      started.delete(handle);
      return;
    }
  }
  signal('SIGKILL');
  await waitFor(() => !alive(handle.pid), { timeoutMs: 5_000, everyMs: 50 });
  started.delete(handle);
}

export async function killEverything() {
  for (const h of [...started]) await killGroup(h, { hard: true });
}

export function tail(path, chars = 1500) {
  try {
    return readFileSync(path, 'utf8').slice(-chars);
  } catch {
    return '';
  }
}

/* -------------------------------------------------------------- http client */

/**
 * One request to the hub on 127.0.0.1 with the Host a person's browser would send.
 * (`*.localhost` resolves in a browser, not reliably in Node.)
 */
export function rawRequest({ port, host, method = 'GET', path, headers = {}, body = null }) {
  return new Promise((res, rej) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host, ...headers } },
      (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(chunks);
          res({
            status: r.statusCode ?? 0,
            headers: r.headers,
            buffer: buf,
            text: buf.toString('utf8'),
            json() {
              try {
                return JSON.parse(buf.toString('utf8'));
              } catch {
                return null;
              }
            },
          });
        });
      }
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error', rej);
    if (body !== null) req.write(body);
    req.end();
  });
}

/**
 * A person's browser, minus the rendering: a cookie jar, the same-origin fetch metadata a
 * real page sends, and ONE client address (X-Forwarded-For, as the reverse proxy in front
 * of the production hub stamps it — the hub trusts it because HUB_TRUSTED_PROXIES names
 * the proxy). The per-address sign-in budget therefore stays ON and still separates people.
 */
export function person({ port, publicUrl, ip }) {
  const pub = new URL(publicUrl);
  const jar = new Map();
  const call = async (path, { method = 'GET', headers = {}, body = null, bare = false } = {}) => {
    const res = await rawRequest({
      port,
      host: pub.host,
      method,
      path,
      headers: {
        ...(bare ? {} : { 'sec-fetch-site': 'same-origin', origin: pub.origin }),
        'x-forwarded-for': ip,
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(body !== null ? { 'content-length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
      body,
    });
    for (const c of [].concat(res.headers['set-cookie'] ?? [])) {
      const m = /^([^=]+)=([^;]*)/.exec(c);
      if (!m) continue;
      if (m[2] === '' || /max-age=0/i.test(c)) jar.delete(m[1]);
      else jar.set(m[1], m[2]);
    }
    return res;
  };
  return {
    jar,
    ip,
    get: (path, headers = {}) => call(path, { headers: { accept: 'text/html', ...headers } }),
    form: (path, fields) =>
      call(path, {
        method: 'POST',
        headers: { accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    json: (path, body) =>
      call(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body),
      }),
    call,
  };
}

/** A caller with a bearer credential and no browser about it (the desktop app, a script). */
export function bearer({ port, publicUrl, ip, token }) {
  const pub = new URL(publicUrl);
  return (path, { method = 'GET', headers = {}, body = null } = {}) =>
    rawRequest({
      port,
      host: pub.host,
      method,
      path,
      headers: {
        authorization: `Bearer ${token}`,
        'x-forwarded-for': ip,
        // every studio → hub request declares the project format it speaks
        'x-maude-format': '2',
        ...(body !== null ? { 'content-length': Buffer.byteLength(body) } : {}),
        ...headers,
      },
      body,
    });
}

/* ------------------------------------------------------ the provider's page */

/** The provider URL a 200 hand-off page (meta refresh) sends the browser to. */
export function refreshTarget(html) {
  const m = /http-equiv="refresh" content="0;url=([^"]+)"/.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/** What the provider hands back for `who` at this authorize URL (the hub's fixture decodes it). */
export function providerCode(authorizeUrl, who) {
  const u = new URL(authorizeUrl);
  if (u.origin !== ISSUER) throw new Error(`not the issuer: ${u.origin}`);
  const code = Buffer.from(
    JSON.stringify({ ...who, nonce: u.searchParams.get('nonce') }),
    'utf8'
  ).toString('base64url');
  return {
    code,
    state: u.searchParams.get('state'),
    redirectUri: u.searchParams.get('redirect_uri'),
  };
}

/** Finish an OIDC sign-in over HTTP as `who`, from the response that started it. */
export async function oidcAs(p, startedRes, who) {
  let dest = startedRes.headers.location;
  if (!dest) dest = refreshTarget(startedRes.text);
  if (!dest)
    throw new Error(
      `sign-in did not start (HTTP ${startedRes.status}): ${startedRes.text.slice(0, 200)}`
    );
  const { code, state } = providerCode(dest, who);
  return p.get(`/auth/oidc/callback?code=${code}&state=${encodeURIComponent(state)}`);
}

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * The identity provider's sign-in page, for the real browser. https with a throwaway
 * certificate; the browser is pointed at it with a host-resolver rule, so the hub still
 * sees the issuer it was configured with. It asks who you are every time (no provider
 * session), which is what `prompt=select_account` asks a real one to do.
 */
export async function startProvider({ dir, callbackPrefix }) {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'idp.key');
  const cert = join(dir, 'idp.crt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '2',
      '-subj',
      `/CN=${ISSUER_HOST}`,
      '-addext',
      `subjectAltName=DNS:${ISSUER_HOST}`,
    ],
    { stdio: 'ignore' }
  );
  const seen = [];
  const server = https.createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      const u = new URL(req.url ?? '/', ISSUER);
      const html = (status, body) => {
        res.writeHead(status, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(`<!doctype html><meta charset="utf-8"><title>Example ID</title>${body}`);
      };
      if (u.pathname === '/authorize') {
        const q = u.searchParams;
        const redirectUri = q.get('redirect_uri') ?? '';
        seen.push({ redirectUri, prompt: q.get('prompt'), clientId: q.get('client_id') });
        if (!redirectUri.startsWith(callbackPrefix))
          return html(400, '<h1>Unknown redirect_uri</h1>');
        return html(
          200,
          `<h1 data-testid="idp-title">Sign in to Example ID</h1>
<form method="get" action="/continue">
  <input type="hidden" name="state" value="${esc(q.get('state') ?? '')}">
  <input type="hidden" name="nonce" value="${esc(q.get('nonce') ?? '')}">
  <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">
  <label>Subject <input name="sub" data-testid="idp-sub" required></label>
  <label>Email <input name="email" type="email" data-testid="idp-email" required></label>
  <button type="submit" data-testid="idp-submit">Continue</button>
</form>`
        );
      }
      if (u.pathname === '/continue') {
        const q = u.searchParams;
        const redirectUri = q.get('redirect_uri') ?? '';
        if (!redirectUri.startsWith(callbackPrefix))
          return html(400, '<h1>Unknown redirect_uri</h1>');
        const code = Buffer.from(
          JSON.stringify({ sub: q.get('sub'), email: q.get('email'), nonce: q.get('nonce') }),
          'utf8'
        ).toString('base64url');
        const back = new URL(redirectUri);
        back.searchParams.set('code', code);
        back.searchParams.set('state', q.get('state') ?? '');
        res.writeHead(302, { location: back.toString(), 'cache-control': 'no-store' });
        return res.end();
      }
      return html(404, '<h1>Not here</h1>');
    }
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    seen,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/* ------------------------------------------------------------ real browser */

/**
 * One agent-browser session = one person's clean browser. Always `--session <unique>`;
 * the launch args make the issuer's host resolve to this run's provider page.
 */
export class Browser {
  constructor({ session, providerPort, ip, shotDir }) {
    this.session = session;
    this.ip = ip;
    this.shotDir = shotDir;
    this.launchArgs = [
      '--session',
      session,
      '--ignore-https-errors',
      '--args',
      `--host-resolver-rules=MAP ${ISSUER_HOST} 127.0.0.1:${providerPort}`,
    ];
    this.opened = false;
    mkdirSync(shotDir, { recursive: true });
  }

  run(args, { timeoutMs = 60_000 } = {}) {
    return new Promise((res) => {
      // never the ambient session: every call names its own with --session
      const { AGENT_BROWSER_SESSION: _ambient, ...env } = process.env;
      const p = spawn('agent-browser', [...this.launchArgs, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      p.stdout.on('data', (d) => {
        out += d;
      });
      p.stderr.on('data', (d) => {
        err += d;
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        res({ code, out: out.trim(), err: err.trim() });
      });
      p.on('error', () => {
        clearTimeout(timer);
        res({ code: -1, out: '', err: 'agent-browser not found' });
      });
    });
  }

  async open(url) {
    if (!this.opened) {
      // The reverse proxy's part: every request of this browser carries its one address.
      this.opened = true;
      await this.run(['open', 'about:blank']);
      await this.run(['set', 'headers', JSON.stringify({ 'X-Forwarded-For': this.ip })]);
    }
    const r = await this.run(['open', url]);
    if (r.code !== 0) throw new Error(`browser could not open ${url}: ${r.err || r.out}`);
    return r;
  }

  async eval(js) {
    const { code, out } = await this.run(['eval', js, '--json']);
    if (code !== 0) return null;
    try {
      const parsed = JSON.parse(out);
      if (parsed && parsed.success === false) return null;
      return parsed?.data?.result ?? parsed?.result ?? parsed?.value ?? null;
    } catch {
      return out || null;
    }
  }

  url() {
    return this.eval('location.href');
  }

  text() {
    return this.eval('document.body ? document.body.innerText : ""');
  }

  async click(selector) {
    const r = await this.run(['click', selector]);
    if (r.code !== 0) throw new Error(`click ${selector}: ${r.err || r.out}`);
  }

  async fill(selector, value) {
    const r = await this.run(['fill', selector, value]);
    if (r.code !== 0) throw new Error(`fill ${selector}: ${r.err || r.out}`);
  }

  /** Wait until `js` is truthy in the page. */
  until(js, timeoutMs = 20_000) {
    return waitFor(
      async () => {
        const v = await this.eval(js);
        return v === true || v === 'true' ? true : v && v !== 'false' ? v : null;
      },
      { timeoutMs, everyMs: 400 }
    );
  }

  /** Names of every cookie this browser holds (HttpOnly ones too). */
  async cookieNames() {
    const { out } = await this.run(['cookies', 'get', '--json']);
    try {
      const parsed = JSON.parse(out);
      const list = parsed?.data?.cookies ?? parsed?.cookies ?? parsed?.data ?? [];
      return (Array.isArray(list) ? list : []).map((c) => c.name);
    } catch {
      return [...out.matchAll(/\b(maude_[a-z_]+)\b/g)].map((m) => m[1]);
    }
  }

  async shot(name) {
    const path = join(this.shotDir, `${name}.png`);
    await this.run(['screenshot', path]);
    return path;
  }

  /** The provider's page: say who you are. */
  async signInAtProvider(who) {
    const at = await this.until(`!!document.querySelector('[data-testid="idp-submit"]')`, 20_000);
    if (!at.ok) throw new Error(`the provider page never showed (at ${await this.url()})`);
    await this.fill('[data-testid="idp-sub"]', who.sub);
    await this.fill('[data-testid="idp-email"]', who.email);
    await this.click('[data-testid="idp-submit"]');
  }

  async close() {
    if (!this.opened) return;
    await this.run(['close'], { timeoutMs: 15_000 });
    this.opened = false;
  }
}
