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
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
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
import {
  bashReadsOutside,
  chatScratchDir,
  claudeCodeTmpFor,
  ensureChatScratch,
  readAllowRules,
  readBoundaryRoots,
  readVerdict,
  wipeChatScratch,
} from '../acp/may-scope.ts';
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

  test('a chat session’s default boundary: + Maude’s own files and the chat’s scratch, never a Claude Code folder', () => {
    const roots = sessionReadRoots(repo, [{ type: 'local', path: plugin }], undefined, 'c1', 'i1');
    const uid = process.getuid?.() ?? 0;
    expect(roots).toEqual(
      expect.arrayContaining([
        repo,
        design,
        plugin,
        DEV_SERVER_ROOT,
        join(DEV_SERVER_ROOT, '..', '..', 'plugins'),
        chatScratchDir(repo, 'c1', 'i1'),
      ])
    );
    // V2-8.9 re-check 2 M-b — Claude Code's folder for the project held EVERY session's task
    // output (the person's own terminal sessions too): only this session's, judged live per request.
    expect(roots).not.toContain(join('/tmp', `claude-${uid}`, repo.replace(/[^A-Za-z0-9]/g, '-')));
    expect(roots).not.toContain(outside);
    expect(roots).not.toContain(homedir());
    // V2-8.9 L1 — never the package's parent folder (a source checkout's repo root: .env.local, profiles)
    expect(roots).not.toContain(join(DEV_SERVER_ROOT, '..', '..'));
    // V2-8.9 M2 — never all of /tmp or $TMPDIR (every session's task output lives there)
    for (const t of [tmpdir(), '/tmp']) {
      expect(roots).not.toContain(t);
      expect(roots).not.toContain(realpathSync(t));
    }
    // each chat — and each run of a chat, `default` included — has its own scratch
    expect(chatScratchDir(repo, 'c1', 'i1')).not.toBe(chatScratchDir(repo, 'c2', 'i1'));
    expect(chatScratchDir(repo, 'default', 'i1')).not.toBe(chatScratchDir(repo, 'default', 'i2'));
  });

  test('M-b — Claude Code’s temp folder is this session’s only; another session’s is outside', () => {
    const uid = process.getuid?.() ?? 0;
    const slug = repo.replace(/[^A-Za-z0-9]/g, '-');
    expect(claudeCodeTmpFor(repo, 'sess-a')).toEqual([
      join('/tmp', `claude-${uid}`, slug, 'sess-a'),
    ]);
    for (const bad of [undefined, '', '..', 'a/b', '.'])
      expect(claudeCodeTmpFor(repo, bad)).toEqual([]);
    const roots = [
      ...sessionReadRoots(repo, [], undefined, 'c1', 'i1'),
      // as the bridge does: named and resolved (`/tmp` is `/private/tmp` on macOS)
      ...readBoundaryRoots({ repoRoot: repo, tmpRoots: claudeCodeTmpFor(repo, 'sess-a') }),
    ];
    const at = (...p: string[]) => join('/tmp', `claude-${uid}`, ...p);
    const verdict = (p: string) => readVerdict('Read', call({ file_path: p }), repo, roots);
    expect(verdict(at('-Users-someone-git-x', 's', 'tasks', 'a.output'))).toBe('outside');
    expect(verdict(at(slug, 'sess-b', 'tasks', 'b.output'))).toBe('outside');
    expect(verdict(at(slug, 'sess-a', 'tasks', 'b.output'))).toBe('inside');
    const scratch = (c: string, i: string) => join(chatScratchDir(repo, c, i), 'x.png');
    expect(verdict(scratch('c1', 'i1'))).toBe('inside');
    expect(verdict(scratch('c2', 'i1'))).toBe('outside');
    expect(verdict(scratch('c1', 'i2'))).toBe('outside');
  });

  test('M-b / L3 — the scratch: owner-only, never through a planted link, wiped on Remove', () => {
    const repoX = join(tmp, 'scratch-repo');
    mkdirSync(repoX, { recursive: true });
    const dir = chatScratchDir(repoX, 'c1', 'i1');
    expect(ensureChatScratch(dir)).toBe(true);
    expect(statSync(dir).mode & 0o077).toBe(0);
    writeFileSync(join(dir, 'copied.txt'), 'x');
    wipeChatScratch(repoX, 'c1');
    expect(existsSync(dir)).toBe(true); // a live chat keeps its TMPDIR …
    expect(readdirSync(dir)).toEqual([]); // … emptied
    writeFileSync(join(dir, 'again.txt'), 'x');
    wipeChatScratch(repoX); // Reset: every chat of the project
    expect(readdirSync(dir)).toEqual([]);
    // L3 — a planted symlink where the scratch goes is never used
    const planted = chatScratchDir(repoX, 'c9', 'i1');
    mkdirSync(join(planted, '..'), { recursive: true });
    const elsewhere = join(tmp, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, planted);
    expect(ensureChatScratch(planted)).toBe(false);
    rmSync(join(dir, '..', '..'), { recursive: true, force: true });
  });

  test('L2 — a read-only shell command on an outside path is flagged; in-project is not', () => {
    const roots = [repo, design];
    expect(bashReadsOutside(`cat ${join(outside, 'tax.pdf')}`, repo, roots)).toBe(true);
    expect(bashReadsOutside('head -n 5 ~/maude-p8-probe/x.txt', repo, roots)).toBe(true);
    expect(bashReadsOutside('cd .design && rg secret $HOME/maude-p8-probe', repo, roots)).toBe(
      true
    );
    expect(bashReadsOutside('FOO=1 cat /etc/hosts | wc -l', repo, roots)).toBe(true);
    expect(bashReadsOutside('cat README.md', repo, roots)).toBe(false);
    expect(bashReadsOutside('ls .design/ui', repo, roots)).toBe(false);
    expect(bashReadsOutside('maude design screenshot --full --out x.png', repo, roots)).toBe(false);
    // V2-8.9 re-check 2 L5 — more readers lose "Always allow" on an outside path (never auto-allowed)
    for (const c of [
      `jq . ${join(outside, 'a.json')}`,
      `sed -n 1p ${join(outside, 'a.txt')}`,
      `awk 1 ${join(outside, 'a.txt')}`,
      `base64 -i ${join(outside, 'a.bin')}`,
      `cp ${join(outside, 'a.txt')} .design/x.txt`,
    ])
      expect(`${c} → ${bashReadsOutside(c, repo, roots)}`).toBe(`${c} → true`);
    expect(bashReadsOutside('jq . package.json', repo, roots)).toBe(false);
    // an interpreter's paths live inside its code: never a standing rule
    expect(bashReadsOutside(`python3 -c "print(open('/etc/hosts').read())"`, repo, roots)).toBe(
      true
    );
    expect(bashReadsOutside('node -e "1"', repo, roots)).toBe(true);
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
    const store = createGrantStore({ projectRoot: repo, designRoot: design, home: tmp });
    const folder = resolveFolder(consented, { projectRoot: repo, designRoot: design, home: tmp });
    if (!folder.ok) throw new Error(`folder refused: ${folder.code}`);
    expect(store.grant(folder, 'c1')).toEqual({ ok: true });
    const roots = () =>
      createGrantStore({ projectRoot: repo, designRoot: design, home: tmp }).chatRoots('c1');

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

// V2-8.9 L2 — a Bash card for `cat <outside>` must not offer "Always allow": the adapter turns it
// into a standing `Bash(cat:*)` rule that reads anywhere, outside the folder consent.
describe('L2 — read-only Bash cards', () => {
  test('`cat <outside file>` → the card without Always allow; `cat README.md` keeps it', async () => {
    const outsideCat = await ask({ command: `cat ${join(outside, 'tax.pdf')}` }, undefined, 'Bash');
    expect(outsideCat.prompts).toHaveLength(1);
    expect(outsideCat.prompts[0]?.options?.some((o) => o.kind === 'allow_always')).toBe(false);
    const inside = await ask({ command: 'cat README.md' }, undefined, 'Bash');
    expect(inside.prompts).toHaveLength(1);
    expect(inside.prompts[0]?.options?.some((o) => o.kind === 'allow_always')).toBe(true);
  });
});
