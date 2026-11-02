// p8-v1-drop (decision maude/v2-michal-drop-v1-auto-convert) — design systems.
//   • folder → canvas (`ds convert`) runs BY ITSELF on an editable project: deterministic and backed up, so
//     there is nothing to ask. Once per session; nothing when a folder is refused (all or none).
//   • `ds-upgrade` stays an OFFER (it needs AI and the person's choices) that is always reachable: the
//     system's ⋯ row and ⌘K, while the system is below Conformant. Closing the sheet never hides it.

import { afterEach, describe, expect, test } from 'bun:test';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { autoConvertSystems } from '../client/v2/ds/convert-host.jsx';
import { CONVERT_WORDS } from '../client/v2/ds/convert-model.js';
import { systemMenuItems } from '../client/v2/ds/system-menu.jsx';
import { resetDsUpgradeBus } from '../client/v2/ds/upgrade-bus.js';
import {
  resetUpgradeOffers,
  setUpgradeOffers,
  upgradeOffers,
} from '../client/v2/ds/upgrade-offers.js';
import { actionSearchRows } from '../client/v2/search/search-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

afterEach(() => {
  resetUpgradeOffers();
  resetDsUpgradeBus();
});

function convertRoute(plan: unknown, apply: { status: number; body: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push(body);
    if (body.dryRun) return new Response(JSON.stringify(plan), { status: 200 });
    return new Response(JSON.stringify(apply.body), { status: apply.status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  path: `system/${name}`,
  to: 'canvas',
  specimens: 2,
  ...extra,
});

describe('folder → canvas runs by itself', () => {
  test('every folder converts in one run, and the notice says so', async () => {
    const { calls, fetchImpl } = convertRoute(
      { format: 'maude.ds-convert', systems: [row('acme'), row('brand')] },
      { status: 200, body: { result: { systems: ['acme', 'brand'] } } }
    );
    const r = await autoConvertSystems({ fetchImpl });
    expect(r).toEqual({ ran: true, ok: true, message: CONVERT_WORDS.autoDone });
    expect(CONVERT_WORDS.autoDone).toBe('Design systems moved onto canvases.');
    expect(calls.map((c) => c.dryRun === true)).toEqual([true, false]);
    expect(calls[1].systems).toEqual(['acme', 'brand']);
  });

  test('nothing to convert, or a folder refused: no write (one run converts all or none)', async () => {
    const none = convertRoute(
      { format: 'maude.ds-convert', systems: [] },
      { status: 200, body: {} }
    );
    expect(await autoConvertSystems({ fetchImpl: none.fetchImpl })).toEqual({ ran: false });
    expect(none.calls).toHaveLength(1);
    const refused = convertRoute(
      {
        format: 'maude.ds-convert',
        systems: [row('acme'), row('old', { refused: { message: 'a page does not parse' } })],
      },
      { status: 200, body: {} }
    );
    expect(await autoConvertSystems({ fetchImpl: refused.fetchImpl })).toEqual({ ran: false });
    expect(refused.calls).toHaveLength(1);
  });
});

describe('Bring it up to the schema — reachable from the panel and ⌘K, after closing too', () => {
  const amberRow = {
    dsName: 'acme',
    systemLabel: 'Acme',
    amber: { title: 'Made before the schema' },
  };
  const ctx = (offered: boolean) => menuCtx({ native: true, dsUpgradeOffered: offered });
  const searchHas = (offered: boolean) =>
    actionSearchRows(ctx(offered), { run: () => {} }).some(
      (r: { id?: string; actionId?: string }) => (r.actionId ?? r.id) === 'ds.upgrade'
    );

  test('the registry row is a ⌘K action (not row-only), Can edit', () => {
    const def = ACTIONS_BY_ID.get('ds.upgrade');
    expect(def?.search?.hidden).not.toBe(true);
    expect(def?.visible).toMatchObject({ minRole: 'edit', facts: ['dsUpgradeOffered'] });
  });

  test('below Conformant: ⋯ on the row and ⌘K both offer it; Conformant: neither', () => {
    setUpgradeOffers(['acme']);
    const items = systemMenuItems({
      row: amberRow,
      rows: [amberRow],
      has: (id: string) => ACTIONS_BY_ID.has(id),
    });
    expect(items.some((i: { action?: { id: string } }) => i.action?.id === 'ds.upgrade')).toBe(
      true
    );
    expect(searchHas(upgradeOffers().length > 0)).toBe(true);

    const conformant = { dsName: 'acme', systemLabel: 'Acme', amber: null };
    const none = systemMenuItems({
      row: conformant,
      rows: [conformant],
      has: (id: string) => ACTIONS_BY_ID.has(id),
    });
    expect(none.some((i: { action?: { id: string } }) => i.action?.id === 'ds.upgrade')).toBe(
      false
    );
    expect(searchHas(false)).toBe(false);
  });

  test('closing the offer (the sheet) never hides it: the panel and ⌘K still have it', async () => {
    setUpgradeOffers(['acme']);
    // open it from ⌘K (no system named → the first one offered), then close the sheet
    const { requestDsUpgrade, onDsUpgradeRequest } = await import('../client/v2/ds/upgrade-bus.js');
    const opened: string[] = [];
    const off = onDsUpgradeRequest((r: { ds: string }) => opened.push(r.ds));
    requestDsUpgrade({ ds: upgradeOffers()[0] ?? '' });
    expect(opened).toEqual(['acme']);
    off(); // the sheet closed: its host stops listening
    // still offered: only reaching Conformant removes it
    expect(upgradeOffers()).toEqual(['acme']);
    expect(searchHas(upgradeOffers().length > 0)).toBe(true);
    const items = systemMenuItems({
      row: amberRow,
      rows: [amberRow],
      has: (id: string) => ACTIONS_BY_ID.has(id),
    });
    expect(items.some((i: { action?: { id: string } }) => i.action?.id === 'ds.upgrade')).toBe(
      true
    );
  });
});
