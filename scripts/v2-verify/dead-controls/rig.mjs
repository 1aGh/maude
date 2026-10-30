// The dead-control crawler's rig: a throwaway fixture project, the SOURCE project server and the
// SOURCE Home server, all isolated (throwaway HOME / XDG / index, stub `claude` first on PATH, a dead
// loopback cloud URL). Never this repo's `.design`, never ~/.config/maude, ~/.maude or the app
// support folder.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2Config } from '../../dev/v2-config.mjs';
import { stubClaudeEnv } from '../../lib/stub-claude.mjs';

export const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
export const STUDIO = join(REPO, 'apps', 'studio');
const FIXTURE = join(REPO, 'apps', 'desktop', 'e2e', 'fixtures', 'project');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKENS_CSS = `/* acme tokens */
:root, .acme[data-theme="light"] { --accent: oklch(0.55 0.2 255); --fg-0: #111111; --bg-0: #ffffff; }
.acme[data-theme="dark"] { --accent: oklch(0.65 0.2 255); --fg-0: #eeeeee; --bg-0: #111111; }
`;
const DS_CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';
export default function DesignSystem() {
  return (
    <DesignCanvas>
      <DCSection id="ds" title="Design system">
        <DCArtboard id="tokens" label="Tokens" width={400} height={240}>
          <div style={{ padding: 24 }}><h1>acme</h1><button className="btn">Go</button></div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const SECOND_CANVAS = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';
export default function Landing() {
  return (
    <DesignCanvas>
      <DCSection id="landing" title="Landing">
        <DCArtboard id="hero" label="Hero" width={640} height={400}>
          <div style={{ padding: 32 }}><h1 id="hero-title">Hello</h1><p>Body copy.</p><button>Sign up</button></div>
        </DCArtboard>
        <DCArtboard id="pricing" label="Pricing" width={640} height={400}>
          <div style={{ padding: 32 }}><h2>Pricing</h2></div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** Copy the desktop e2e fixture, add a design system + a second canvas. Returns paths. */
export function makeFixture() {
  const work = mkdtempSync(join(tmpdir(), 'maude-dead-controls-'));
  const root = join(work, 'project');
  cpSync(FIXTURE, root, { recursive: true });
  const dr = join(root, '.design');
  const cfgFile = join(dr, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  const config = v2Config({
    ...cfg,
    name: 'crawl-fixture',
    canvasGroups: [
      { label: 'UI kit', path: 'ui' },
      { label: 'Design system', path: 'system' },
    ],
    designSystems: [
      {
        name: 'acme',
        path: 'system/acme',
        themes: ['light', 'dark'],
        themeDefault: 'light',
        rootClass: 'acme',
      },
    ],
    defaultDesignSystem: 'acme',
  });
  writeFileSync(cfgFile, `${JSON.stringify(config, null, 2)}\n`);
  const ds = join(dr, 'system', 'acme');
  mkdirSync(join(ds, 'preview'), { recursive: true });
  writeFileSync(join(ds, 'colors_and_type.css'), TOKENS_CSS);
  writeFileSync(join(ds, 'preview', '_components.css'), '.btn { border-radius: 4px; }\n');
  writeFileSync(join(ds, 'README.md'), '# acme\n\nThe crawl fixture design system.\n');
  writeFileSync(join(ds, 'design-system.tsx'), DS_CANVAS);
  writeFileSync(join(ds, 'design-system.meta.json'), '{ "title": "Design system" }\n');
  writeFileSync(join(dr, 'ui', 'Landing.tsx'), SECOND_CANVAS);
  writeFileSync(join(dr, 'ui', 'Landing.meta.json'), '{ "title": "Landing" }\n');
  return { work, root, designRoot: dr };
}

function isolatedEnv(work, portBase) {
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_SYNC_IN_CI: '1',
    MAUDE_PORT_BASE: String(portBase),
    XDG_CONFIG_HOME: join(work, 'config'),
    MAUDE_MACHINE_FILE: join(work, 'config', 'maude', 'machine.json'),
    MAUDE_INDEX_DIR: join(work, 'index'),
    MAUDE_HOME_STATE_DIR: join(work, 'home-state'),
    MAUDE_HOME_PROJECTS_DIR: join(work, 'Maude'),
    // no real cloud: a loopback port nothing listens on
    MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
    ...stubClaudeEnv(home),
  };
}

function spawnLogged(args, env) {
  const log = [];
  const child = spawn('bun', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  return { child, log };
}

async function waitJson(file, ms, child) {
  for (let t = 0; t < ms; t += 300) {
    await sleep(300);
    if (child.exitCode !== null) return null;
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* mid-write */
    }
  }
  return null;
}

/** Boot the project server and Home server on the fixture. */
export async function bootRig({ portBase = Number(process.env.MAUDE_PORT_BASE || 48499) } = {}) {
  const fx = makeFixture();
  const env = isolatedEnv(fx.work, portBase);
  let proj = spawnLogged([join(STUDIO, 'server.ts'), '--root', fx.root], env);
  const sj = await waitJson(join(fx.designRoot, '_server.json'), 60_000, proj.child);
  if (!sj?.url) throw new Error(`project server never came up:\n${proj.log.join('').slice(-1500)}`);
  // let the index snapshot land before Home reads it
  await sleep(2500);
  const token = randomBytes(32).toString('hex');
  const pageSecret = randomBytes(32).toString('hex');
  const infoFile = join(fx.work, 'home-info.json');
  const home = spawnLogged([join(STUDIO, 'server.ts'), '--home'], {
    ...env,
    MAUDE_HOME_TOKEN: token,
    MAUDE_HOME_PAGE_SECRET: pageSecret,
    MAUDE_SHELL_INFO_FILE: infoFile,
  });
  const hi = await waitJson(infoFile, 30_000, home.child);
  const pristine = join(fx.work, 'pristine');
  const pristineConfig = join(fx.work, 'pristine-config');
  const exited = (child) =>
    new Promise((r) => {
      if (child.exitCode !== null) return r();
      child.once('exit', () => r());
      setTimeout(r, 8000);
    });
  const rig = {
    ...fx,
    /** Freeze the fixture as it is now (call after seeding): `reset()` returns to exactly this. */
    snapshot() {
      cpSync(fx.root, pristine, { recursive: true });
      if (existsSync(join(fx.work, 'config')))
        cpSync(join(fx.work, 'config'), pristineConfig, { recursive: true });
    },
    /**
     * The project server back on the frozen fixture: a state the crawl reaches by replaying its steps must start
     * from the same project every time, or a click that pinned / created / deleted something earlier changes what
     * the next state shows (a control 'vanishes' only because a sibling click already used it up).
     */
    async reset() {
      try {
        proj.child.kill('SIGTERM');
      } catch {
        /* gone */
      }
      await exited(proj.child);
      rmSync(fx.root, { recursive: true, force: true });
      cpSync(pristine, fx.root, { recursive: true });
      rmSync(join(fx.work, 'config'), { recursive: true, force: true });
      if (existsSync(pristineConfig))
        cpSync(pristineConfig, join(fx.work, 'config'), { recursive: true });
      for (const f of ['_server.json', '_active.json'])
        rmSync(join(fx.designRoot, f), { force: true });
      proj = spawnLogged([join(STUDIO, 'server.ts'), '--root', fx.root], env);
      rig.logs.project = proj.log;
      const again = await waitJson(join(fx.designRoot, '_server.json'), 60_000, proj.child);
      if (!again?.url) throw new Error('project server did not come back after a reset');
      rig.projectUrl = again.url; // a restart may take the next free port
      return again.url;
    },
    projectUrl: sj.url,
    homeUrl: hi?.url ?? null,
    homeSecret: pageSecret,
    logs: { project: proj.log, home: home.log },
    async stop() {
      for (const c of [proj.child, home.child]) {
        try {
          c.kill('SIGTERM');
        } catch {
          /* gone */
        }
      }
      await sleep(300);
      if (!process.env.KEEP_WORK) rmSync(fx.work, { recursive: true, force: true });
    },
  };
  return rig;
}
