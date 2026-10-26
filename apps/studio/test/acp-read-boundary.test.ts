// M2 read boundary (decision maude/v2-michal-m2-read-boundary) — the AI chat's Read / Glob / Grep are
// auto-approved only inside the project, the folders the person allowed (attached to the chat), and
// what the agent needs to work (bundled plugins, Maude's package, the temp folders). Everything else
// is the person's card. The credential deny still refuses outright.
//
// Two layers, both here: the pure rules (acp/may-scope.ts) and a real ACP round-trip through the
// bridge's gate (fixtures/mock-acp-agent-may.mjs logs the session's allow-list and always asks).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import {
  AcpBridge,
  chatAllowedTools,
  MAUDE_DEFAULT_ALLOWED_TOOLS,
  newSessionParams,
  sessionReadRoots,
} from '../acp/bridge.ts';
import { readAllowRules, readBoundaryRoots, readVerdict } from '../acp/may-scope.ts';
import { createGrantStore, resolveFolder } from '../ai/attach-grants.ts';
import { DEV_SERVER_ROOT } from '../paths.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-may.mjs');
const ENV = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'MAUDE_TEST_MAY_LOG',
  'MAUDE_TEST_TOOL',
  'MAUDE_TEST_TOOL_INPUT',
  'MAUDE_TEST_TOOL_KIND',
];

let tmp: string;
let repo: string;
let design: string;
let outside: string;
let consented: string;
let plugin: string;
let agentTmp: string;
let logPath: string;
let logN = 0;

beforeAll(() => {
  // The bridges below get an explicit boundary (`readBoundary`): the real one holds every temp folder,
  // and this fixture lives in one. The default composition is pinned in 'the pure rules'.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-read-boundary-')));
  agentTmp = join(tmp, 'agent-tmp');
  mkdirSync(agentTmp, { recursive: true });
  repo = join(tmp, 'repo');
  design = join(repo, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), 'hi\n');
  outside = join(tmp, 'Documents');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'tax.pdf'), 'x');
  consented = join(tmp, 'Combine fotky');
  mkdirSync(consented, { recursive: true });
  writeFileSync(join(consented, 'a.jpg'), 'x');
  plugin = join(tmp, 'bundle', 'plugins', 'design');
  mkdirSync(join(plugin, 'skills', 'whiteboard'), { recursive: true });
  writeFileSync(join(plugin, 'skills', 'whiteboard', 'SKILL.md'), '# w\n');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

const call = (rawInput: Record<string, unknown>) => ({ rawInput });

describe('the pure rules', () => {
  test('the boundary: project, design root as it resolves, plugins, package, temp — never `/`', () => {
    const shared = join(tmp, 'shared-design');
    mkdirSync(shared, { recursive: true });
    const linked = join(tmp, 'linked');
    mkdirSync(linked, { recursive: true });
    symlinkSync(shared, join(linked, '.design'));
    const roots = readBoundaryRoots({
      repoRoot: linked,
      designRoot: '.design',
      pluginRoots: [plugin],
      packageRoot: join(tmp, 'bundle'),
      tmpRoots: ['/tmp', '/'],
    });
    expect(roots).toEqual(
      expect.arrayContaining([linked, join(linked, '.design'), shared, plugin, join(tmp, 'bundle')])
    );
    expect(roots).not.toContain('/');
    expect(roots).not.toContain(outside);
    expect(readAllowRules(['/a/b'])).toEqual(['Read(//a/b/**)']);
  });

  test('a chat session’s default boundary: + Maude’s package root, $TMPDIR and /tmp as they resolve', () => {
    const roots = sessionReadRoots(repo, [{ type: 'local', path: plugin }]);
    expect(roots).toEqual(
      expect.arrayContaining([
        repo,
        design,
        plugin,
        join(DEV_SERVER_ROOT, '..', '..'),
        realpathSync(tmpdir()),
        realpathSync('/tmp'),
      ])
    );
    expect(roots).not.toContain(outside);
    expect(roots).not.toContain(homedir());
  });

  test('inside the project → inside; outside → outside; not a read tool → null', () => {
    const roots = [repo];
    expect(readVerdict('Read', call({ file_path: join(repo, 'README.md') }), repo, roots)).toBe(
      'inside'
    );
    expect(readVerdict('Read', call({ file_path: '.design/ui/x.tsx' }), repo, roots)).toBe(
      'inside'
    );
    expect(readVerdict('Read', call({ file_path: join(outside, 'tax.pdf') }), repo, roots)).toBe(
      'outside'
    );
    expect(readVerdict('Grep', call({ pattern: 'x', path: outside }), repo, roots)).toBe('outside');
    expect(readVerdict('Glob', call({ pattern: `${outside}/**/*.pdf` }), repo, roots)).toBe(
      'outside'
    );
    expect(readVerdict('Glob', call({ pattern: '**/*.tsx' }), repo, roots)).toBe('inside');
    expect(readVerdict('Bash', call({ command: 'cat x' }), repo, roots)).toBeNull();
  });

  test('a path that climbs, or a symlink in the project pointing out, is judged outside', () => {
    expect(readVerdict('Glob', call({ pattern: '../**/*.pdf' }), repo, [repo])).toBe('outside');
    expect(
      readVerdict('Glob', call({ pattern: 'ui/**/../../../../x', path: design }), repo, [repo])
    ).toBe('outside');
    symlinkSync(outside, join(repo, 'docs-link'));
    expect(readVerdict('Read', call({ file_path: 'docs-link/tax.pdf' }), repo, [repo])).toBe(
      'outside'
    );
  });

  test('a consented folder (its real path) → inside, also spelled with other case on macOS', () => {
    expect(
      readVerdict('Read', call({ file_path: join(consented, 'a.jpg') }), repo, [repo, consented])
    ).toBe('inside');
    if (process.platform === 'darwin') {
      const upper = join(tmp, 'COMBINE FOTKY', 'a.jpg');
      expect(readVerdict('Read', call({ file_path: upper }), repo, [repo, consented])).toBe(
        'inside'
      );
    }
    // a sibling that only shares the prefix is not inside
    expect(
      readVerdict('Read', call({ file_path: `${consented}-evil/a.jpg` }), repo, [repo, consented])
    ).toBe('outside');
  });
});

describe('the session allow-list', () => {
  test('no bare Read / Glob / Grep: one Read rule per boundary root', () => {
    for (const t of ['Read', 'Glob', 'Grep']) expect(MAUDE_DEFAULT_ALLOWED_TOOLS).not.toContain(t);
    const p = newSessionParams(repo, undefined, [{ type: 'local', path: plugin }]);
    const meta = p._meta as { claudeCode: { options: { allowedTools: string[] } } };
    const allowed = meta.claudeCode.options.allowedTools;
    for (const t of ['Read', 'Glob', 'Grep']) expect(allowed).not.toContain(t);
    expect(allowed).toContain(`Read(/${repo}/**)`);
    expect(allowed).toContain(`Read(/${plugin}/**)`);
    expect(allowed.some((r) => r.startsWith(`Read(/${outside}`))).toBe(false);
    expect(allowed.some((r) => r.startsWith(`Read(/${consented}`))).toBe(false);
    expect(allowed).toEqual(chatAllowedTools(repo, [{ type: 'local', path: plugin }]));
  });
});

// ---------------------------------------------------------------------------------------------------

function setAgent(tool: string, input: Record<string, unknown>, kind: string) {
  logPath = join(tmp, `log-${++logN}.ndjson`);
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  process.env.MAUDE_TEST_MAY_LOG = logPath;
  process.env.MAUDE_TEST_TOOL = tool;
  process.env.MAUDE_TEST_TOOL_INPUT = JSON.stringify(input);
  process.env.MAUDE_TEST_TOOL_KIND = kind;
}

const readLog = (): Array<{ m: string; allowed?: string[] }> =>
  existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

function makeBridge(readRoots?: () => readonly string[]) {
  const prompts: RequestPermissionRequest[] = [];
  const texts: string[] = [];
  const bridge = new AcpBridge({
    repoRoot: repo,
    designRoot: design,
    plugins: [{ type: 'local', path: plugin }],
    readBoundary: [repo, design, plugin, agentTmp],
    readRoots,
    permissionTimeoutMs: 4000,
    onUpdate: (u) => {
      const t = (u as { content?: { text?: string } }).content?.text;
      if (t) texts.push(t);
    },
    onPermissionRequest: (id, req) => {
      prompts.push(req);
      bridge.resolvePermission(id, 'reject');
    },
  });
  return { bridge, prompts, texts };
}

async function ask(
  input: Record<string, unknown>,
  readRoots?: () => readonly string[],
  tool = 'Read'
) {
  setAgent(tool, input, tool === 'Read' ? 'read' : 'search');
  const b = makeBridge(readRoots);
  try {
    await b.bridge.prompt('go', 'c1');
  } finally {
    await b.bridge.stop();
  }
  return { prompts: b.prompts, out: b.texts.join('') };
}

describe('through the bridge', () => {
  test('a Read outside the project and every consent: the card, without Always allow', async () => {
    const { prompts, out } = await ask({ file_path: join(outside, 'tax.pdf') });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.options?.map((o) => o.kind)).not.toContain('allow_always');
    expect(out).toContain('"optionId":"reject"');
  });

  test('a Grep over an outside folder: the card too', async () => {
    const { prompts } = await ask({ pattern: 'secret', path: outside }, undefined, 'Grep');
    expect(prompts).toHaveLength(1);
  });

  test('inside the project: approved once, no card — and the session carries the project rule', async () => {
    const { prompts, out } = await ask({ file_path: join(repo, 'README.md') });
    expect(prompts).toHaveLength(0);
    expect(out).toContain('"optionId":"allow"');
    const [created] = readLog();
    expect(created?.allowed).toContain(`Read(/${repo}/**)`);
    expect(created?.allowed).not.toContain('Read');
    expect(created?.allowed).not.toContain('Glob');
    expect(created?.allowed).not.toContain('Grep');
  });

  test('a bundled skill file: approved, no card', async () => {
    const { prompts, out } = await ask({
      file_path: join(plugin, 'skills', 'whiteboard', 'SKILL.md'),
    });
    expect(prompts).toHaveLength(0);
    expect(out).toContain('"optionId":"allow"');
  });

  test('a file in the temp folder (a screenshot read back): approved, no card', async () => {
    const shot = join(agentTmp, 'x.png');
    const { prompts } = await ask({ file_path: shot });
    expect(prompts).toHaveLength(0);
  });

  test('a consented folder: approved; after Remove, the card again', async () => {
    const store = createGrantStore(design);
    const folder = resolveFolder(consented, { projectRoot: repo, designRoot: design, home: tmp });
    if (!folder.ok) throw new Error(`folder refused: ${folder.code}`);
    expect(store.grant(folder, 'c1')).toEqual({ ok: true });
    const roots = () => createGrantStore(design).chatRoots('c1');

    const allowed = await ask({ file_path: join(consented, 'a.jpg') }, roots);
    expect(allowed.prompts).toHaveLength(0);
    expect(allowed.out).toContain('"optionId":"allow"');

    // the chip's × (detach) — the consent stays, this chat no longer carries the folder
    store.detach(folder.root, 'c1');
    const detached = await ask({ file_path: join(consented, 'a.jpg') }, roots);
    expect(detached.prompts).toHaveLength(1);

    // attach again, then Advanced's Reset (revoke) — the card again
    expect(store.attach(folder.root, 'c1')).toEqual({ ok: true });
    expect((await ask({ file_path: join(consented, 'a.jpg') }, roots)).prompts).toHaveLength(0);
    store.revoke(folder.root);
    expect((await ask({ file_path: join(consented, 'a.jpg') }, roots)).prompts).toHaveLength(1);
  });

  test('a consent getter that throws allows nothing (the card)', async () => {
    const { prompts } = await ask({ file_path: join(consented, 'a.jpg') }, () => {
      throw new Error('torn');
    });
    expect(prompts).toHaveLength(1);
  });

  test('a credential path is still refused outright — no card', async () => {
    const home = process.env.HOME || homedir();
    const { prompts, out } = await ask({ file_path: join(home, '.ssh', 'id_ed25519') });
    expect(prompts).toHaveLength(0);
    expect(out).toContain('"optionId":"reject"');
  });
});
