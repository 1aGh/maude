// A desktop participant for F3 scenarios: the studio server the desktop app
// runs as its sidecar, over its own project copy, linked to a deployed hub the
// way `maude design link` leaves it (linkedHub in config.json, the hub
// credential in an isolated hubs.json). It reaches the hub through the toggle
// proxy, so a scenario can pull its cable while the hub keeps serving others.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

async function ready(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`not ready: ${url}`);
}

export async function startProxy({ listen, target, control }) {
  const proc = spawn(
    'node',
    [join(REPO, 'scripts/dev/sync-e2e/toggle-proxy.mjs'), String(listen), String(target), String(control)],
    { stdio: 'ignore' }
  );
  await ready(`http://127.0.0.1:${control}/state`);
  const flip = (to) => fetch(`http://127.0.0.1:${control}/${to}`, { method: 'POST' });
  return { proc, offline: () => flip('offline'), online: () => flip('online'), stop: () => proc.kill() };
}

export async function startDesktop({ root, port, hubUrl, hubPublicUrl, token, role, name }) {
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  const cfgPath = join(design, 'config.json');
  if (!existsSync(cfgPath))
    writeFileSync(
      cfgPath,
      `${JSON.stringify(
        {
          name,
          canvasGroups: [
            { label: 'Canvases', path: 'ui' },
            { label: 'Design system', path: 'system' },
          ],
          linkedHub: { url: hubUrl, linkedAt: Date.now(), syncFiles: true },
        },
        null,
        2
      )}\n`
    );
  const hubs = join(root, '..', `${name}-hubs.json`);
  writeFileSync(hubs, JSON.stringify({ hubs: { [hubUrl]: { token, role, linkedAt: Date.now() } } }), {
    mode: 0o600,
  });
  const env = {
    ...process.env,
    HUBS_CONFIG_PATH: hubs,
    XDG_CONFIG_HOME: join(root, '..', `${name}-xdg`),
    MAUDE_NO_AUTOBUILD: '1',
    NO_OPEN: '1',
    // A test participant, not this machine's person: no global git identity
    // leaks into its UI, screenshots or commits.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: `${name}@f3.invalid`,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: `${name}@f3.invalid`,
  };
  let proc = null;
  const url = `http://127.0.0.1:${port}`;
  const start = async () => {
    proc = spawn('bun', ['--no-env-file', join(REPO, 'apps/studio/server.ts'), '--root', root, '--port', String(port)], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const log = [];
    proc.stdout.on('data', (c) => log.push(String(c)));
    proc.stderr.on('data', (c) => log.push(String(c)));
    proc.log = log;
    await ready(`${url}/_health`);
  };
  await start();
  const kill = (signal = 'SIGKILL') =>
    new Promise((done) => {
      if (!proc || proc.exitCode !== null) return done();
      proc.once('exit', () => done());
      try {
        process.kill(-proc.pid, signal);
      } catch {
        done();
      }
    });
  return {
    root,
    design,
    url,
    publicHub: hubPublicUrl ?? hubUrl,
    get log() {
      return proc?.log?.join('') ?? '';
    },
    file: (rel) => join(design, rel),
    read: (rel) => (existsSync(join(design, rel)) ? readFileSync(join(design, rel), 'utf8') : null),
    write: (rel, text) => writeFileSync(join(design, rel), text),
    status: async () => {
      try {
        return await (await fetch(`${url}/_sync-status`, { signal: AbortSignal.timeout(3000) })).json();
      } catch {
        return null;
      }
    },
    kill,
    restart: async () => {
      await kill();
      await start();
    },
    stop: () => kill('SIGTERM'),
  };
}

export async function until(fn, label, ms = 60000, every = 300) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, every));
  }
}
