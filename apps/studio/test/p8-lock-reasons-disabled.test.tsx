// p8-lock-reasons (2) — the dead-control crawl found controls outside the project menu greyed with no reason.
// Each is mounted here in the state the crawl met it in (an empty form, a format not chosen, too few objects) and
// the rendered-panel walk (_disabled-reasons.ts, the crawl's own reasonOf rule) must find a reason on it.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { isOff, reasonOf, silentDisabled } from './_disabled-reasons.ts';

const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/_api/figma/status'))
      return new Response(JSON.stringify({ configured: false }), { status: 200 });
    if (u.includes('/_index-data'))
      return new Response(JSON.stringify({ groups: [] }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await act(async () => new Promise((r) => setTimeout(r, 30)));
  return host;
}
const byTestid = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const byText = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('button')).find((b) =>
    (b.textContent ?? '').includes(text)
  ) ?? null;

/** The control is off, and says why (the line, when one is given). */
function saysWhy(el: HTMLElement | null, line?: string) {
  expect(el).not.toBeNull();
  const c = el as HTMLElement;
  expect(isOff(c)).toBe(true);
  if (line) expect(reasonOf(c)).toBe(line);
  else expect(reasonOf(c)).not.toBe('');
}

const noop = () => {};

describe('p8-lock-reasons — a greyed control says why (the crawl’s 13)', () => {
  test('report-bug-preview: an empty description', async () => {
    const { ReportBugDialog } = await import('../client/report-bug.jsx');
    const host = await mount(<ReportBugDialog open onClose={noop} />);
    saysWhy(byTestid(host, 'report-bug-preview'), 'Describe what happened first.');
  });

  test('figma-import-preview: no link yet', async () => {
    const FigmaSheet = (await import('../client/v2/import/figma-sheet.jsx')).default;
    const host = await mount(<FigmaSheet open onClose={noop} onImported={noop} />);
    saysWhy(byTestid(host, 'figma-import-preview'), 'Paste a Figma link first.');
  });

  test('brand-import: no logo and no website', async () => {
    const BrandSheet = (await import('../client/v2/import/brand-sheet.jsx')).default;
    const host = await mount(<BrandSheet open onClose={noop} />);
    saysWhy(byTestid(host, 'brand-import'), 'Drop a logo or type a website first.');
  });

  test('vh-name-save: no name', async () => {
    const { NameDialog } = await import('../client/v2/history/name-dialog.jsx');
    const host = await mount(
      <NameDialog canvasLabel="Pricing" onSubmit={async () => ({ ok: true })} onClose={noop} />
    );
    saysWhy(byTestid(host, 'vh-name-save'), 'Type a name first.');
  });

  test('Settings Save (a provider key): no key pasted', async () => {
    const { ProviderCard } = await import('../client/panels/SettingsPanel.jsx');
    const host = await mount(
      <ProviderCard
        provider={{ id: 'fal', label: 'fal', auth: 'api-key', modalities: ['image'] }}
        onChanged={noop}
      />
    );
    saysWhy(byText(host, 'Save'), 'Paste the API key first.');
  });

  test('figma-connect-save (Settings card and Connections): no token pasted', async () => {
    const { FigmaConnectCard } = await import('../client/panels/SettingsPanel.jsx');
    const card = await mount(<FigmaConnectCard />);
    saysWhy(byTestid(card, 'figma-connect-save'), 'Paste the token first.');
    const { FigmaToken } = await import('../client/v2/settings/connections-section.jsx');
    const row = await mount(<FigmaToken f={{ status: { configured: false }, save: noop }} />);
    saysWhy(byTestid(row, 'figma-connect-save'), 'Paste the token first.');
  });

  test('team-hub-open: the address, email and password not all there', async () => {
    const TeamProjects = (await import('../client/panels/TeamProjects.jsx')).default;
    const host = await mount(<TeamProjects serverOnly />);
    saysWhy(byTestid(host, 'team-hub-open'), 'Fill in the address, email and password first.');
  });

  test('edit-distribute-h / -v: fewer than three objects', async () => {
    const { AlignBarView } = await import('../editing/align-bar.tsx');
    const host = await mount(
      <AlignBarView
        model={{ kind: 'objects', label: '2 objects', count: 2 } as never}
        onAction={noop}
      />
    );
    saysWhy(byTestid(host, 'edit-distribute-h'));
    saysWhy(byTestid(host, 'edit-distribute-v'));
  });

  test('export-adv-gif-colours: GIF is not one of the formats', async () => {
    const { VideoPart } = await import('../client/v2/export/advanced/video.jsx');
    const host = await mount(<VideoPart spec={{}} formats={['mp4']} setAdv={noop} />);
    saysWhy(byTestid(host, 'export-adv-gif-colours'), 'Only a GIF uses this. Add GIF first.');
  });

  test('Create local project: no name', async () => {
    const CreateProject = (await import('../client/panels/CreateProject.jsx')).default;
    const host = await mount(<CreateProject view="new" signedIn={false} onClose={noop} />);
    saysWhy(byText(host, 'Create local project'), 'Type a name first.');
  });

  test('generate-ask-go: no artboard chosen, then no words', async () => {
    const { GenerateAsk, ASK_WORDS } = await import('../client/v2/assets/generate-ask.jsx');
    const host = await mount(<GenerateAsk target={null} onClose={noop} />);
    saysWhy(byTestid(host, 'generate-ask-go'), ASK_WORDS.noTarget);
  });

  test('every greyed control in those panels says why (the walk)', async () => {
    const { NameDialog } = await import('../client/v2/history/name-dialog.jsx');
    const BrandSheet = (await import('../client/v2/import/brand-sheet.jsx')).default;
    const { VideoPart } = await import('../client/v2/export/advanced/video.jsx');
    for (const el of [
      <NameDialog
        key="n"
        canvasLabel="Pricing"
        onSubmit={async () => ({ ok: true })}
        onClose={noop}
      />,
      <BrandSheet key="b" open onClose={noop} />,
      <VideoPart key="v" spec={{}} formats={['mp4']} setAdv={noop} />,
    ])
      expect(silentDisabled(await mount(el))).toEqual([]);
  });
});
