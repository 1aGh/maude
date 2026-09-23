// F3 backend adapters: the same scenario code against the isolated Cloudflare
// test cell and the Docker self-host hub. Credentials are fetched fresh through
// each backend's REAL sign-in path and held in memory only.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha = (s) => createHash('sha256').update(s).digest('hex');

async function request(url, { method, headers = {}, body, timeout = 20000 } = {}) {
  const r = await fetch(url, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: r.status, body: parsed };
}

const CLOUD = {
  origin: 'https://f3-cloud.multiplayer-test-20260922.maude.sh',
  control: 'https://maude-multiplayer-control-test-20260922.maude1agh.workers.dev',
  project: 'f3-cloud',
  personalA: '/tmp/maude-cloud-entry-UncRL8/cloud.json',
  sessions: { owner: 'maude-f3-owner', b: 'maude-f3-designer-b' },
};

function browserCookie(session, host) {
  const out = execFileSync('agent-browser', ['--session', session, 'cookies', 'get', '--json'], {
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out)
    .data.cookies.filter((c) => c.domain.replace(/^\./, '') === host)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

async function cloudHubToken(who) {
  const headers =
    who === 'a'
      ? { authorization: `Bearer ${JSON.parse(readFileSync(CLOUD.personalA, 'utf8')).token}` }
      : { cookie: browserCookie(CLOUD.sessions[who], new URL(CLOUD.control).hostname) };
  const opened = await request(`${CLOUD.control}/projects/open`, {
    headers,
    body: { project: CLOUD.project },
  });
  if (opened.status !== 200) throw new Error(`cloud open ${who}: ${opened.status}`);
  const login = await request(`${CLOUD.origin}/auth/login`, { body: { token: opened.body.token } });
  if (login.status !== 200) throw new Error(`cloud login ${who}: ${login.status}`);
  return { token: login.body.token, role: login.body.user?.role ?? opened.body.role, projectToken: opened.body.token };
}

export async function loadBackend(name, opts = {}) {
  if (name === 'cloud') {
    const tokens = {};
    for (const who of ['owner', 'a', 'b']) tokens[who] = await cloudHubToken(who);
    return makeBackend({ name, origin: CLOUD.origin, projectId: CLOUD.project, tokens, cloud: CLOUD });
  }
  if (name === 'selfhost') {
    // Sessions minted by the real /auth/login (selfhost.mjs signin); a restart
    // keeps them (the token store lives on the data volume).
    const fx = JSON.parse(readFileSync(`${opts.work}/fixture.json`, 'utf8'));
    if (!fx.sessions) throw new Error('run selfhost.mjs signin first');
    const tokens = fx.sessions;
    return makeBackend({ name, origin: fx.url, projectId: null, tokens, fixture: fx });
  }
  throw new Error(`unknown backend ${name}`);
}

function makeBackend(b) {
  const api = (who, path, body, extra = {}) =>
    request(`${b.origin}/api/projects/current/v1/${path}`, {
      headers: { authorization: `Bearer ${b.tokens[who].token}` },
      body,
      ...extra,
    });
  const backend = {
    ...b,
    api,
    async bootstrap(who = 'a') {
      const r = await api(who, 'bootstrap');
      if (r.status !== 200) throw new Error(`bootstrap ${who}: ${r.status} ${JSON.stringify(r.body)}`);
      backend.projectId ??= r.body.projectId;
      return r.body;
    },
    async doc(docName, who = 'a') {
      const boot = await backend.bootstrap(who);
      const d = boot.docs.find((x) => x.doc === docName && !x.retired);
      if (!d) return { boot, doc: null, source: null };
      const blob = await api(who, `blobs/${d.lanes.html.hash}`);
      if (blob.status !== 200) throw new Error(`blob ${docName}: ${blob.status}`);
      if (sha(blob.body.body) !== d.lanes.html.hash) throw new Error('blob hash mismatch');
      return { boot, doc: d, source: blob.body.body, revision: boot.revision };
    },
    async propose(who, operations, { label = 'F3 probe', kind = 'edit', transactionId, epoch } = {}) {
      const boot = epoch === undefined ? await backend.bootstrap(who) : null;
      return api(who, 'proposals', {
        protocol: 1,
        projectId: backend.projectId ?? boot?.projectId,
        epoch: epoch ?? boot.epoch,
        transactionId: transactionId ?? `tx_f3_${randomUUID()}`,
        origin: { deviceId: `f3-${b.name}-${who}`, sessionId: 'f3-scenarios' },
        action: { kind, label, operations },
      });
    },
    async history(who = 'a', limit = 50) {
      const r = await api(who, `history?limit=${limit}`);
      if (r.status !== 200) throw new Error(`history ${r.status}`);
      return r.body.history;
    },
  };
  return backend;
}

export const canvasSource = (component, title, { color = 'red', body = '' } = {}) =>
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\n` +
  `export default function ${component}() {\n` +
  `  return <DesignCanvas><DCArtboard id="brief" label="${component}" width={600} height={400}>\n` +
  `    <h1 title="${title}" style={{ color: "${color}" }}>${title}</h1>${body}\n` +
  `  </DCArtboard></DesignCanvas>;\n}\n`;
