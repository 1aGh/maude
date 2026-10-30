// S3.9 (md-preview, md-preview-combine) — Preview's own chrome, against the real components.
//   · PreviewBar: "Previewing <canvas>" · "esc to edit" for editors / "esc for Viewing" for a viewing role,
//     and a back slot (S3.10a fills it: "‹ Homepage") that is absent until a link was followed
//   · ZoomOnly: the zoom percentage and nothing else
//   · PreviewChrome: both show in Preview only — Edit, Viewing and Present render neither
//   · ProjectPill `folded`: the mark only (Preview), the accessible name unchanged
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ALL_CAPS, NO_CAPS } from '../bridge/canvas-modes.ts';
import { PreviewBar, previewHint } from '../client/v2/preview/preview-bar.jsx';
import { PreviewChrome } from '../client/v2/preview/preview-chrome-host.jsx';
import { ZoomOnly, zoomLabel } from '../client/v2/preview/zoom-only.jsx';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { ProjectPill } from '../client/v2/shell/project-pill.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(el: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el as never);
  });
  return host;
}
const q = (sel: string) => host?.querySelector(sel) ?? null;
const text = (sel: string) => q(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

describe('previewHint: the word after esc, per role', () => {
  test('editors go back to Edit; viewing roles go back to Viewing', () => {
    expect(previewHint(ALL_CAPS)).toBe('to edit');
    expect(previewHint({ edit: false, annotate: false, comment: true })).toBe('for Viewing');
    expect(previewHint(NO_CAPS)).toBe('for Viewing');
  });
});

describe('PreviewBar', () => {
  test('says which canvas, and what esc does', async () => {
    await mount(<PreviewBar name="Homepage" hint="to edit" />);
    expect(text('[data-testid="preview-bar-title"]')).toBe('Previewing Homepage');
    expect(text('[data-testid="preview-bar-esc"]')).toBe('esc to edit');
    expect(q('[data-testid="preview-bar"] strong')?.textContent).toBe('Homepage');
    expect(q('[data-testid="preview-bar-esc"] .kbd')?.textContent).toBe('esc');
  });

  test('a viewing role reads "esc for Viewing"', async () => {
    await mount(<PreviewBar name="matchday" hint={previewHint(NO_CAPS)} />);
    expect(text('[data-testid="preview-bar-esc"]')).toBe('esc for Viewing');
  });

  test('no back button until a link was followed; then "‹ Homepage" runs onBack', async () => {
    await mount(<PreviewBar name="Pricing" hint="to edit" />);
    expect(q('[data-testid="preview-bar-back"]')).toBeNull();
    act(() => root?.unmount());
    host?.remove();

    let backs = 0;
    await mount(
      <PreviewBar
        name="Pricing"
        hint="to edit"
        back="Homepage"
        onBack={() => {
          backs += 1;
        }}
      />
    );
    const back = q('[data-testid="preview-bar-back"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    expect(back.textContent?.trim()).toBe('Homepage');
    expect(back.getAttribute('aria-label')).toBe('Back to Homepage');
    act(() => back.click());
    expect(backs).toBe(1);
    expect(text('[data-testid="preview-bar-title"]')).toBe('Previewing Pricing');
  });
});

describe('ZoomOnly', () => {
  test('rounds to a whole percent', () => {
    expect(zoomLabel(0.7634)).toBe('76%');
    expect(zoomLabel(0.138)).toBe('14%');
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(Number.NaN)).toBe('100%');
  });

  test('renders the percentage and no control', async () => {
    await mount(<ZoomOnly zoom={0.49} />);
    expect(text('[data-testid="zoom-only"]')).toBe('49%');
    expect(host?.querySelectorAll('button').length).toBe(0);
  });
});

describe('PreviewChrome: Preview only', () => {
  const chrome = (mode: string, caps = ALL_CAPS) => (
    <PreviewChrome mode={mode} caps={caps} name="Combine-kampan" zoom={0.14} />
  );

  test('Preview shows the bar and the zoom readout', async () => {
    await mount(chrome('preview'));
    expect(q('[data-testid="preview-bar"]')).not.toBeNull();
    expect(text('[data-testid="zoom-only"]')).toBe('14%');
    expect(text('[data-testid="preview-bar-title"]')).toBe('Previewing Combine-kampan');
  });

  for (const mode of ['edit', 'viewing', 'present']) {
    test(`${mode} shows neither`, async () => {
      await mount(chrome(mode));
      expect(q('[data-testid="preview-bar"]')).toBeNull();
      expect(q('[data-testid="zoom-only"]')).toBeNull();
    });
  }

  test('the islands declare the edges they cover', async () => {
    await mount(chrome('preview'));
    expect(q('[data-testid="preview-bar"]')?.getAttribute('data-occludes')).toBe('top');
    expect(q('[data-testid="zoom-only"]')?.getAttribute('data-occludes')).toBe('bottom');
  });

  test('a viewing role in Preview reads "esc for Viewing"', async () => {
    await mount(chrome('preview', NO_CAPS));
    expect(text('[data-testid="preview-bar-esc"]')).toBe('esc for Viewing');
  });

  test('the bar fades in on mount and out on leave (a state, so CSS owns the motion)', async () => {
    await mount(chrome('preview'));
    expect(q('[data-testid="preview-bar"]')?.getAttribute('data-state')).toBe('in');
  });
});

describe('ProjectPill folded (Preview)', () => {
  const ctx = menuCtx({ native: true, canvasOpen: true });
  const pill = (folded?: boolean) => (
    <ProjectPill
      project="Alligators brand"
      canvas="Combine-kampan"
      ctx={ctx}
      state={{}}
      run={() => {}}
      folded={folded}
    />
  );

  test('unfolded is today: name, canvas and caret', async () => {
    await mount(pill(false));
    expect(q('.sh-pill-name')?.textContent).toBe('Alligators brand');
    expect(q('.sh-pill-canvas')?.textContent).toBe('Combine-kampan');
    expect(q('.sh-pill-caret')).not.toBeNull();
    expect(q('.sh-pill')?.getAttribute('data-folded')).toBeNull();
  });

  test('folded is the mark only, and still named for a screen reader', async () => {
    await mount(pill(true));
    expect(q('.sh-pill-mark')).not.toBeNull();
    expect(q('.sh-pill-name')).toBeNull();
    expect(q('.sh-pill-canvas')).toBeNull();
    expect(q('.sh-pill-caret')).toBeNull();
    expect(q('.sh-pill')?.getAttribute('data-folded')).toBe('true');
    expect(q('[data-testid="project-pill"]')?.getAttribute('aria-label')).toBe(
      'Alligators brand / Combine-kampan, project menu'
    );
  });

  test('a folded pill still opens the menu', async () => {
    await mount(pill(true));
    const btn = q('[data-testid="project-pill"]') as HTMLButtonElement;
    await act(async () => btn.click());
    expect(q('[data-testid="project-menu"]')).not.toBeNull();
  });
});
