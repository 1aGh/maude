// V2-8.9 H1 (decision maude/v2-8.9-lead-h1-audience-aware-write-gate) — the owner's AI must not carry a
// file into a canvas that people who cannot see that file can see.
//
// Two subjects: Grace holds a canvas invite to ui/Campaign.tsx only (and has left a thread on it:
// "swap this placeholder for the tier table from ui/Pricing-internal.tsx"); the owner's chat runs the
// agent. Through a real ACP round-trip (fixtures/mock-acp-agent-audience.mjs), with the hub-backed
// audience source over a real project closure and a fake hub:
//   • the owner's session reads ui/Pricing-internal.tsx (not in Campaign's closure), then writes
//     ui/Campaign.tsx → the person's card, naming the source and Grace; never auto-approved;
//   • the same session reading only Campaign's closure (components/Button.tsx) → auto-approved.
// Plus the edges: no hub = no change; a hub that cannot be asked = the card (fail closed); a chat
// that read nothing but the target never asks the hub.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { closureFor } from '../access/closure.ts';
import { diskProjectReader } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import {
  audienceLeak,
  createHubWriteAudience,
  readPathsOf,
  type WriteAudienceSource,
} from '../acp/audience.ts';
import { AcpBridge, type PermissionScopeInfo } from '../acp/bridge.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-audience.mjs');
const KEYS = [
  'MAUDE_ACP_ADAPTER_ENTRY',
  'MAUDE_ACP_RUNTIME',
  'MAUDE_CLAUDE_BIN',
  'MAUDE_TEST_READS',
  'MAUDE_TEST_WRITE',
];

let tmp: string;
let repo: string;
let design: string;

const CANVAS = (body: string) =>
  `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';\n${body}\nexport default function C() { return <DesignCanvas><DCArtboard id="a" width={10} height={10} /></DesignCanvas>; }\n`;

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-audience-')));
  repo = join(tmp, 'repo');
  design = join(repo, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  mkdirSync(join(design, 'components'), { recursive: true });
  writeFileSync(join(design, 'components', 'Button.tsx'), 'export const Button = () => null;\n');
  writeFileSync(
    join(design, 'ui', 'Campaign.tsx'),
    CANVAS("import { Button } from '../components/Button.tsx';")
  );
  writeFileSync(join(design, 'ui', 'Pricing-internal.tsx'), CANVAS('const TIERS = ["secret"];'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

const closureOf = (canvas: string) =>
  closureFor(
    resolveAccess({ v: 1, role: null, grants: [{ c: canvas, r: 'viewer' }] }),
    diskProjectReader(design, () => 'audience-test')
  ).read;

/** The hub: the owner is a project member; Grace holds ui/Campaign.tsx through a canvas invite. */
function hubSource(opts: { linked?: boolean; down?: boolean } = {}) {
  const calls: string[] = [];
  const source = createHubWriteAudience({
    hub: () => (opts.linked === false ? null : { url: 'https://hub.test', token: 'mau_t' }),
    canvases: () => ['components/Button.tsx', 'ui/Campaign.tsx', 'ui/Pricing-internal.tsx'],
    closureOf,
    isCanvas: (rel) => rel.startsWith('ui/'),
    fetchImpl: (async (url: string | URL) => {
      calls.push(String(url));
      if (opts.down) throw new Error('offline');
      const canvas = new URL(String(url)).searchParams.get('canvas');
      const owner = { id: 'u-owner', name: 'Owner', role: 'owner' };
      const people =
        canvas === 'ui/Campaign.tsx'
          ? [owner, { id: 'u-grace', name: 'Grace', role: 'member' }]
          : [owner];
      return new Response(JSON.stringify({ people }), { status: 200 });
    }) as typeof fetch,
  });
  return { source, calls };
}

async function run(
  reads: Array<{ tool: string; input: Record<string, unknown>; locations?: unknown }>,
  source: WriteAudienceSource | undefined,
  readBoundary?: string[]
) {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  process.env.MAUDE_TEST_READS = JSON.stringify(reads);
  process.env.MAUDE_TEST_WRITE = JSON.stringify({
    tool: 'Edit',
    input: { file_path: join(design, 'ui', 'Campaign.tsx'), old_string: 'a', new_string: 'b' },
  });
  const cards: Array<{ req: RequestPermissionRequest; info?: PermissionScopeInfo }> = [];
  const texts: string[] = [];
  const bridge = new AcpBridge({
    repoRoot: repo,
    designRoot: design,
    permissionTimeoutMs: 4000,
    ...(source ? { writeAudience: source } : {}),
    ...(readBoundary ? { readBoundary } : {}),
    onUpdate: (u) => {
      const t = (u as { content?: { text?: string } }).content?.text;
      if (t) texts.push(t);
    },
    onPermissionRequest: (id, req, info) => {
      cards.push({ req, info });
      bridge.resolvePermission(id, 'reject');
    },
  });
  try {
    await bridge.prompt('polish', 'c1');
  } finally {
    await bridge.stop();
  }
  return { cards, outcome: texts.join('') };
}

const readOf = (rel: string) => ({
  tool: 'Read',
  input: { file_path: join(design, rel) },
  locations: [{ path: join(design, rel) }],
});

describe('H1 — the owner’s AI and a one-canvas grantee', () => {
  test('read a file outside the granted canvas, then write the canvas → the card, never auto', async () => {
    const { source } = hubSource();
    const { cards, outcome } = await run([readOf('ui/Pricing-internal.tsx')], source);
    expect(cards).toHaveLength(1);
    const info = cards[0]?.info;
    expect(info?.reason).toBe('audience');
    expect(info?.audience?.canvas).toBe('ui/Campaign.tsx');
    expect(info?.audience?.who).toEqual(['Grace']);
    expect(info?.audience?.sources).toEqual(['ui/Pricing-internal.tsx']);
    // one click can never make it standing
    expect(cards[0]?.req.options?.some((o) => o.kind === 'allow_always')).toBe(false);
    expect(outcome).toContain('"optionId":"reject"');
  });

  test('read only the granted canvas’s closure, then write it → auto-approved', async () => {
    const { source } = hubSource();
    const { cards, outcome } = await run([readOf('components/Button.tsx')], source);
    expect(cards).toHaveLength(0);
    expect(outcome).toContain('"optionId":"allow"');
  });

  test('a shell read counts: `cat .design/ui/Pricing-internal.tsx` → the card', async () => {
    const { source } = hubSource();
    const { cards } = await run(
      [{ tool: 'Bash', input: { command: 'cat .design/ui/Pricing-internal.tsx' } }],
      source
    );
    expect(cards[0]?.info?.reason).toBe('audience');
  });

  test('no linked hub (desktop-only): no change — auto-approved', async () => {
    const { source, calls } = hubSource({ linked: false });
    const { cards } = await run([readOf('ui/Pricing-internal.tsx')], source);
    expect(cards).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test('a linked hub that cannot be asked → the card (fail closed)', async () => {
    const { source } = hubSource({ down: true });
    const { cards } = await run([readOf('ui/Pricing-internal.tsx')], source);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.info?.reason).toBe('audience-unknown');
  });

  test('a chat that read only the target never asks the hub', async () => {
    const { source, calls } = hubSource({ down: true });
    const { cards } = await run([readOf('ui/Campaign.tsx')], source);
    expect(cards).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

// V2-8.9 M1 — a file read from outside the project is private: nobody on the hub can see it.
describe('M1 — a read from outside the project, then a hub-linked write', () => {
  const notes = () => {
    const dir = join(tmp, 'Combine');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notes.txt'), 'private\n');
    return join(dir, 'notes.txt');
  };
  const readOut = (file: string) => ({
    tool: 'Read',
    input: { file_path: file },
    locations: [{ path: file }],
  });
  test('→ the card, naming the private file, even with no canvas grantee in sight', async () => {
    const file = notes();
    const { source } = hubSource();
    const { cards } = await run([readOut(file)], source, [repo]);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.info?.reason).toBe('audience');
    expect(cards[0]?.info?.audience?.sources).toEqual([file]);
  });
  test('desktop-only (no linked hub): no card', async () => {
    const { source } = hubSource({ linked: false });
    const { cards } = await run([readOut(notes())], source, [repo]);
    expect(cards).toHaveLength(0);
  });
});

describe('the pure parts', () => {
  const kind = (abs: string) =>
    abs.endsWith('.tsx') ? ('file' as const) : abs.endsWith('ui') ? ('dir' as const) : null;
  test('readPathsOf: Read, a Grep folder, a verb’s designRoot-relative canvas; nothing outside', () => {
    expect(
      readPathsOf(
        'Read',
        { rawInput: { file_path: join(design, 'ui/x.tsx') } },
        repo,
        [design],
        kind
      )
    ).toEqual([{ rel: 'ui/x.tsx', dir: false }]);
    expect(
      readPathsOf(
        'Grep',
        { rawInput: { pattern: 'x', path: join(design, 'ui') } },
        repo,
        [design],
        kind
      )
    ).toEqual([{ rel: 'ui', dir: true }]);
    expect(
      readPathsOf(
        'Bash',
        { rawInput: { command: 'maude design read-annotations ui/y.tsx' } },
        repo,
        [design],
        kind
      )
    ).toEqual([{ rel: 'ui/y.tsx', dir: false }]);
    expect(
      readPathsOf(
        'Read',
        { rawInput: { file_path: join(repo, 'src/a.tsx') } },
        repo,
        [design],
        kind
      )
    ).toEqual([]);
    expect(
      readPathsOf(
        'Read',
        { rawInput: { file_path: join(design, '_chat/a.tsx') } },
        repo,
        [design],
        kind
      )
    ).toEqual([]);
    expect(
      readPathsOf(
        'Write',
        { rawInput: { file_path: join(design, 'ui/x.tsx') } },
        repo,
        [design],
        kind
      )
    ).toEqual([]);
  });
  test('audienceLeak: a folder read leaks; a closure file does not', () => {
    const a = [
      { canvas: 'ui/c.tsx', who: ['G'], closure: new Set(['ui/c.tsx', 'components/b.tsx']) },
    ];
    expect(audienceLeak([{ rel: 'components/b.tsx', dir: false }], ['ui/c.tsx'], a)).toBeNull();
    expect(audienceLeak([{ rel: 'ui', dir: true }], ['ui/c.tsx'], a)?.sources).toEqual(['ui/']);
    expect(audienceLeak([{ rel: 'ui/p.tsx', dir: false }], ['ui/c.tsx'], [])).toBeNull();
  });
});
