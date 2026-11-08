// generate-spend.test.ts — the spend cap on a booted studio (stub provider: no network, $0.10 per picture by the
// conservative estimate). The per-Mac settings come from a throwaway prefs file; the key store is in the sandbox.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Matchday() {
  return (
    <DesignCanvas>
      <DCArtboard id="gw5" label="Post" width={1080} height={1350}>
        <div data-cd-id="frame" style={{ width: 400, height: 500 }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function boot(generateSpend?: Record<string, number>) {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'matchday.tsx'), CANVAS);
  const scratch = mkdtempSync(join(tmpdir(), 'maude-spend-boot-'));
  const prefs = join(scratch, 'prefs.json');
  if (generateSpend) writeFileSync(prefs, JSON.stringify({ generateSpend }));
  const port = nextPort();
  const proc = await bootServer(root, port, {
    MAUDE_GENERATE_STUB: '1',
    MAUDE_GEN_KEYS_PATH: join(scratch, 'keys.json'),
    MAUDE_UI_PREFS_PATH: prefs,
    MAUDE_GENERATE_MAX_CONCURRENT: '4',
  });
  cleanup = () => {
    killProc(proc);
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  };
  return { base: `http://localhost:${port}`, designRoot };
}

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const job = (prompt: string, extra: Record<string, unknown> = {}) => ({
  modality: 'image',
  provider: 'stub',
  prompt,
  ...extra,
});

describe('/_api/generate-jobs spend cap', () => {
  test('under the caps a job runs', async () => {
    const { base } = await boot();
    const r = await post(base, '/_api/generate-jobs', job('a red circle'));
    expect(r.status).toBe(202);
  });

  test('the per-run cap stops the job that would pass it, with the cap named', async () => {
    const { base } = await boot({ perRun: 0.25, confirmOver: 5 });
    expect((await post(base, '/_api/generate-jobs', job('one'))).status).toBe(202);
    expect((await post(base, '/_api/generate-jobs', job('two'))).status).toBe(202);
    const r = await post(base, '/_api/generate-jobs', job('three'));
    expect(r.status).toBe(402);
    const j = (await r.json()) as { ok: boolean; reason: string; message: string; cap: number };
    expect(j.ok).toBe(false);
    expect(j.reason).toBe('run-cap');
    expect(j.cap).toBe(0.25);
    expect(j.message).toContain('$0.25');
    expect(j.message).toContain('Nothing was generated');
    expect(j.message).toContain('Settings');
  });

  test('the per-day cap stops a job too, and the ledger holds an amount and a date only', async () => {
    const { base, designRoot } = await boot({ perDay: 0.15, confirmOver: 5 });
    expect((await post(base, '/_api/generate-jobs', job('one'))).status).toBe(202);
    const r = await post(base, '/_api/generate-jobs', job('two'));
    expect(r.status).toBe(402);
    expect(((await r.json()) as { reason: string }).reason).toBe('day-cap');
    const ledger = readFileSync(join(designRoot, '_state', 'generate-spend.json'), 'utf8');
    expect(ledger).not.toContain('one');
    expect(JSON.parse(ledger).usd).toBeCloseTo(0.1, 5);
  });

  test('a job above the threshold waits for the person: a command cannot approve, the app can', async () => {
    const { base } = await boot({ confirmOver: 0.05 });
    const ask = await post(base, '/_api/generate-jobs', job('big'));
    expect(ask.status).toBe(409);
    const need = (await ask.json()) as { reason: string; approvalId: string; estimate: number };
    expect(need.reason).toBe('needs-confirm');
    expect(need.approvalId).toMatch(/^ok_/);
    expect(need.estimate).toBeCloseTo(0.1, 5);

    const list = (await (await fetch(`${base}/_api/generate-jobs`)).json()) as {
      approvals: Array<{ id: string }>;
    };
    expect(list.approvals.map((a) => a.id)).toEqual([need.approvalId]);

    // not approved yet: still waiting
    expect(
      (await post(base, '/_api/generate-jobs', job('big', { approvalId: need.approvalId }))).status
    ).toBe(409);
    // a command (no Origin) cannot approve
    expect((await post(base, '/_api/generate-jobs', { approve: need.approvalId })).status).toBe(
      403
    );
    // the app (a browser POST carries its Origin) can
    const yes = await post(
      base,
      '/_api/generate-jobs',
      { approve: need.approvalId },
      { origin: base }
    );
    expect(yes.status).toBe(200);
    const go = await post(base, '/_api/generate-jobs', job('big', { approvalId: need.approvalId }));
    expect(go.status).toBe(202);
    // used once
    expect(
      (await post(base, '/_api/generate-jobs', job('big', { approvalId: need.approvalId }))).status
    ).toBe(409);
  });

  test('a decline removes the card', async () => {
    const { base } = await boot({ confirmOver: 0.05 });
    const need = (await (await post(base, '/_api/generate-jobs', job('x'))).json()) as {
      approvalId: string;
    };
    const no = await post(
      base,
      '/_api/generate-jobs',
      { decline: need.approvalId },
      { origin: base }
    );
    expect(no.status).toBe(200);
    const list = (await (await fetch(`${base}/_api/generate-jobs`)).json()) as {
      approvals: unknown[];
    };
    expect(list.approvals).toEqual([]);
  });

  test('the limits are changed in Settings, not from a command: a POST without Origin is refused', async () => {
    const { base } = await boot({ perRun: 0.15, confirmOver: 5 });
    const raise = { generateSpend: { perRun: 100 } };
    expect((await post(base, '/_api/ui-prefs', raise)).status).toBe(403);
    expect((await post(base, '/_api/generate-jobs', job('one'))).status).toBe(202);
    expect((await post(base, '/_api/generate-jobs', job('two'))).status).toBe(402);
    // the Settings page (Origin) can: the next job runs under the new limit, no restart
    expect((await post(base, '/_api/ui-prefs', raise, { origin: base })).status).toBe(200);
    expect((await post(base, '/_api/generate-jobs', job('two'))).status).toBe(202);
  });

  test('takes: the same caps stop a group before anything is sent', async () => {
    const { base } = await boot({ perRun: 0.25 });
    const ask = {
      canvas: 'ui/matchday.tsx',
      artboard: 'gw5',
      provider: 'stub',
      model: 'stub-solid',
    };
    const q = (await (await post(base, '/_api/generate-takes/quote', { ...ask, n: 4 })).json()) as {
      quote: string;
      aspect: string;
      estimateUsd: number;
    };
    expect(q.estimateUsd).toBeCloseTo(0.4, 5);
    const r = await post(base, '/_api/generate-takes', {
      ...ask,
      prompt: 'touchdown',
      n: 4,
      aspect: q.aspect,
      quote: q.quote,
    });
    expect(r.status).toBe(402);
    expect(((await r.json()) as { reason: string }).reason).toBe('run-cap');
  });
});
