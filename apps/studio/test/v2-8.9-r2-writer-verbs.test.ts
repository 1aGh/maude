// V2-8.9 round 2 H-R2-1 / R2-H1 (decision maude/v2-8.9-round2-writer-verbs-audience) — the audience
// gate also judges the auto-approved `maude design` verbs that write a versioned design-root file
// with text the agent chose (annotate, canvas-edit, handoff, import-tokens, captions add, cut-words,
// cut-to-beat, reel-place, ds-check --fix/--emit).
//
// Mechanism: on a hub-linked project the session is spawned WITHOUT those verbs' `Bash(…)` allow
// rules, so every call reaches the bridge's requestPermission (Claude Code asks the client for a
// tool no rule covers), and the bridge runs the same audience check as an Edit: no leak → it
// approves once (no card); a leak or an unknowable audience → the person's card, never standing.
//
// Through a real ACP round-trip (fixtures/mock-acp-agent-audience.mjs honours the session's
// `Bash(<prefix>:*)` allow rules the way Claude Code does) with the hub-backed audience source.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { closureFor } from '../access/closure.ts';
import { diskProjectReader } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import { createHubWriteAudience, writerVerbCall } from '../acp/audience.ts';
import { AcpBridge, newSessionParams, type PermissionScopeInfo } from '../acp/bridge.ts';

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
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r2-verbs-')));
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
    diskProjectReader(design, () => 'r2-verbs-test')
  ).read;

function hubSource(opts: { linked?: boolean; down?: boolean } = {}) {
  return createHubWriteAudience({
    hub: () => (opts.linked === false ? null : { url: 'https://hub.test', token: 'mau_t' }),
    canvases: () => ['ui/Campaign.tsx', 'ui/Pricing-internal.tsx'],
    closureOf,
    isCanvas: (rel) => rel.startsWith('ui/'),
    fetchImpl: (async (url: string | URL) => {
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
}

const readOf = (rel: string) => ({
  tool: 'Read',
  input: { file_path: join(design, rel) },
  locations: [{ path: join(design, rel) }],
});

async function run(
  reads: unknown[],
  command: string,
  opts: { linked?: boolean; down?: boolean } = {}
) {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  process.env.MAUDE_TEST_READS = JSON.stringify(reads);
  process.env.MAUDE_TEST_WRITE = JSON.stringify({ tool: 'Bash', input: { command } });
  const cards: Array<{ req: RequestPermissionRequest; info?: PermissionScopeInfo }> = [];
  const texts: string[] = [];
  const bridge = new AcpBridge({
    repoRoot: repo,
    designRoot: design,
    permissionTimeoutMs: 4000,
    writeAudience: hubSource(opts),
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

describe('H-R2-1 — a writer verb after a read outside the target’s audience', () => {
  test('annotate the granted canvas after reading a private one → the card, never auto', async () => {
    const { cards, outcome } = await run(
      [readOf('ui/Pricing-internal.tsx')],
      'maude design annotate --in ui/Campaign.tsx --text "tier table"'
    );
    expect(outcome).not.toContain('allowed-by-rule');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.info?.reason).toBe('audience');
    expect(cards[0]?.info?.audience?.who).toEqual(['Grace']);
    expect(cards[0]?.info?.audience?.sources).toEqual(['ui/Pricing-internal.tsx']);
    expect(cards[0]?.req.options?.some((o) => o.kind === 'allow_always')).toBe(false);
    expect(outcome).toContain('"optionId":"reject"');
  });

  test('canvas-edit with --x=path after a private read → the card', async () => {
    const { cards } = await run(
      [readOf('ui/Pricing-internal.tsx')],
      'maude design canvas-edit --canvas=ui/Campaign.tsx a title "x"'
    );
    expect(cards[0]?.info?.reason).toBe('audience');
  });

  test('read only the canvas’s closure, then annotate it → approved once by the bridge', async () => {
    const { cards, outcome } = await run(
      [readOf('components/Button.tsx')],
      'maude design annotate --in ui/Campaign.tsx --text "ok"'
    );
    expect(cards).toHaveLength(0);
    expect(outcome).toContain('"optionId":"allow"');
  });

  test('a hub that cannot be asked → the card (fail closed)', async () => {
    const { cards } = await run(
      [readOf('ui/Pricing-internal.tsx')],
      'maude design annotate --in ui/Campaign.tsx --text "x"',
      { down: true }
    );
    expect(cards).toHaveLength(1);
  });

  test('a writer verb naming no design file after reads → the card (target unknown)', async () => {
    const { cards } = await run([readOf('ui/Pricing-internal.tsx')], 'maude design ds-check --fix');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.info?.reason).toBe('audience-unknown');
  });

  test('ds-check without --fix/--emit only reads → approved by the bridge, no card', async () => {
    const { cards, outcome } = await run(
      [readOf('ui/Pricing-internal.tsx')],
      'maude design ds-check'
    );
    expect(cards).toHaveLength(0);
    expect(outcome).toContain('"optionId":"allow"');
  });

  test('a compound command around a writer verb → the card without allow_always', async () => {
    const { cards } = await run(
      [],
      'maude design annotate --in ui/Campaign.tsx --text x && echo done'
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.req.options?.some((o) => o.kind === 'allow_always')).toBe(false);
  });

  test('no linked hub (desktop-only): the allow rule stays — nothing changes', async () => {
    const { cards, outcome } = await run(
      [readOf('ui/Pricing-internal.tsx')],
      'maude design annotate --in ui/Campaign.tsx --text "x"',
      { linked: false }
    );
    expect(cards).toHaveLength(0);
    expect(outcome).toContain('allowed-by-rule');
  });
});

describe('the session’s allow rules', () => {
  const rules = (gated: boolean) => {
    const meta = newSessionParams(repo, undefined, undefined, { audienceGated: gated })._meta as {
      claudeCode: { options: { allowedTools: string[] } };
    };
    return meta.claudeCode.options.allowedTools.filter((t) => t.startsWith('Bash(maude design '));
  };
  test('hub-linked: no writer-verb rule; read verbs keep theirs', () => {
    const on = rules(true);
    for (const v of [
      'annotate',
      'canvas-edit',
      'handoff',
      'import-tokens',
      'captions',
      'captions add',
      'cut-words',
      'cut-to-beat',
      'reel-place',
      'ds-check',
    ])
      expect(on).not.toContain(`Bash(maude design ${v}:*)`);
    expect(on).toContain('Bash(maude design read-annotations:*)');
    expect(on).toContain('Bash(maude design captions list:*)');
    expect(rules(false)).toContain('Bash(maude design annotate:*)');
  });
});

describe('writerVerbCall', () => {
  test('simple calls, sub-verbs, flags', () => {
    expect(writerVerbCall('maude design annotate --in ui/a.tsx')).toMatchObject({
      rule: 'annotate',
      writes: true,
    });
    expect(writerVerbCall('maude design captions add v.mp4')).toMatchObject({ writes: true });
    expect(writerVerbCall('maude design captions export v.mp4')).toMatchObject({ writes: false });
    expect(writerVerbCall('maude design ds-check')).toMatchObject({ writes: false });
    expect(writerVerbCall('maude design ds-check --fix=mechanical')).toMatchObject({
      writes: true,
    });
    expect(writerVerbCall('maude design screenshot ui/a.tsx')).toBeNull();
    expect(writerVerbCall('echo hi')).toBeNull();
    expect(writerVerbCall('maude design annotate x; rm -rf /')).toBe('compound');
    expect(writerVerbCall('FOO=1 maude design annotate x')).toBe('compound');
  });
});
