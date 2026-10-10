// The 1.x format banner — V2-1.12 §5.7 P1, copy §5.8 (V2-2.18).

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DOWNLOAD_URL,
  FORMAT_GATE_LINE,
  FormatGateBanner,
  formatGateBannerState,
} from '../client/shell/banners.jsx';
import { FORMAT_COPY } from '../format.ts';

const NEWER = { projectFormat: 2, supported: 1, source: 'hub' };
const OLDER = { projectFormat: 1, supported: 2, source: 'config' };

describe('the words are the contract’s', () => {
  test('banner copy equals format.ts FORMAT_COPY (one source of truth, two runtimes)', () => {
    expect(FORMAT_GATE_LINE.newer).toBe(FORMAT_COPY.newerBanner);
    expect(FORMAT_GATE_LINE.action).toBe(FORMAT_COPY.newerBannerAction);
    expect(FORMAT_GATE_LINE.noBuild).toBe(FORMAT_COPY.newerBannerNoBuild);
    expect(FORMAT_GATE_LINE.cloud).toBe(FORMAT_COPY.newerCloudTab);
    expect(DOWNLOAD_URL).toBe('https://maude.sh/download');
  });
});

describe('which variant', () => {
  const s = (over: Record<string, unknown>) =>
    formatGateBannerState({
      cfg: { formatGate: NEWER },
      native: true,
      updateReady: null,
      askedForUpdate: false,
      ...over,
    });

  test('nothing when not gated, or when the project is OLDER (v2’s dialog owns that)', () => {
    expect(s({ cfg: { formatGate: null } })).toBeNull();
    expect(s({ cfg: {} })).toBeNull();
    expect(s({ cfg: { formatGate: OLDER } })).toBeNull();
  });

  test('desktop: a staged update restarts into it', () => {
    expect(s({ updateReady: { version: '1.9.0' } })).toEqual({
      line: FORMAT_GATE_LINE.newer,
      action: 'restart',
    });
  });

  test('desktop, nothing staged: the action, then “isn’t out yet” once asked (§9 Q1)', () => {
    expect(s({})).toEqual({ line: FORMAT_GATE_LINE.newer, action: 'check' });
    expect(s({ askedForUpdate: true })).toEqual({ line: FORMAT_GATE_LINE.noBuild, action: null });
  });

  test('browser shell: the download page; cloud tab: look only, no action (§9 Q2)', () => {
    expect(s({ native: false })).toEqual({ line: FORMAT_GATE_LINE.newer, action: 'download' });
    expect(s({ cfg: { formatGate: NEWER, cloud: { role: 'member' } } })).toEqual({
      line: FORMAT_GATE_LINE.cloud,
      action: null,
    });
  });
});

describe('the component', () => {
  // 1.x: ShellTree passes the two fields as props (no V2-2.3 shell store).
  const render = (shellCore: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(FormatGateBanner, shellCore));

  test('gated: the banner + its action, by testid; NO dismiss control', () => {
    const html = render({
      cfg: { formatGate: NEWER, readOnly: true, readOnlyReason: 'format' },
      updateReady: null,
    });
    expect(html).toContain('data-testid="format-gate-banner"');
    expect(html).toContain('data-testid="format-gate-update"');
    expect(html).toContain('Update Maude to edit');
    expect(html).toContain('nothing in it is lost');
    expect(html).not.toMatch(/Dismiss|Got it|Later|×/);
  });

  test('not gated: renders nothing', () => {
    expect(render({ cfg: { formatGate: null }, updateReady: null })).toBe('');
  });

  test('cloud tab: the line without an action', () => {
    const html = render({
      cfg: { formatGate: NEWER, cloud: { role: 'viewer' } },
      updateReady: null,
    });
    expect(html).toContain('data-testid="format-gate-banner"');
    expect(html).not.toContain('format-gate-update');
  });
});
