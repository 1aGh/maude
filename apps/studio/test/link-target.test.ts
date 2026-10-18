// S3.10a — the `data-cd-link` grammar (contract client/v2/contracts/S3-links-format.md §2, §10 row 1).

import { describe, expect, test } from 'bun:test';
import {
  externalDisplay,
  formatLinkTarget,
  LINK_MAX,
  type LinkTarget,
  linkLabel,
  parseLinkTarget,
} from '../bridge/link-target.ts';

describe('the three forms parse and round-trip', () => {
  const ok: Array<[string, LinkTarget]> = [
    ['#pricing-desktop', { kind: 'artboard', artboard: 'pricing-desktop' }],
    ['#A_1', { kind: 'artboard', artboard: 'A_1' }],
    [
      'site/pricing.tsx#desktop',
      { kind: 'canvas', canvas: 'site/pricing.tsx', artboard: 'desktop' },
    ],
    ['site/pricing.tsx', { kind: 'canvas', canvas: 'site/pricing.tsx', artboard: null }],
    ['Home.tsx', { kind: 'canvas', canvas: 'Home.tsx', artboard: null }],
    [
      'https://cal.com/studio',
      { kind: 'external', url: 'https://cal.com/studio', host: 'cal.com' },
    ],
    ['http://example.org', { kind: 'external', url: 'http://example.org/', host: 'example.org' }],
  ];
  for (const [raw, want] of ok) {
    test(raw, () => {
      const t = parseLinkTarget(raw);
      expect(t).toEqual(want);
      expect(parseLinkTarget(formatLinkTarget(t as LinkTarget))).toEqual(want);
    });
  }

  test('an external value is stored in href form', () => {
    expect(parseLinkTarget('https://Cal.COM/Studio?x=1')).toEqual({
      kind: 'external',
      url: 'https://cal.com/Studio?x=1',
      host: 'cal.com',
    });
  });

  test('a canvas target splits on the LAST #', () => {
    expect(parseLinkTarget('a#b.tsx#desk')).toEqual({
      kind: 'canvas',
      canvas: 'a#b.tsx',
      artboard: 'desk',
    });
  });

  test('a canvas path is NFC', () => {
    const nfd = 'site/café.tsx';
    expect(parseLinkTarget(nfd)).toEqual({
      kind: 'canvas',
      canvas: 'site/café.tsx',
      artboard: null,
    });
  });
});

describe('refused', () => {
  const bad = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<b>x</b>',
    'file:///etc/passwd',
    'blob:https://x.com/1',
    'mailto:a@b.com',
    'HTTPS://cal.com',
    '//evil.com/x.tsx',
    '/abs/x.tsx',
    '../x.tsx',
    'site/../x.tsx',
    'site/./x.tsx',
    'site//x.tsx',
    '_draw/x.tsx',
    'site/_history/x.tsx',
    'a:b.tsx',
    'a\\b.tsx',
    'pricing',
    'site/pricing.ts',
    '.tsx',
    '#',
    '#has space',
    '#x/y',
    `#${'a'.repeat(65)}`,
    'site/pricing.tsx#',
    'site/pricing.tsx#bad id',
    'https://user:pw@cal.com/',
    'https://user@cal.com/',
    'http://localhost:3000/',
    'http://app.localhost/',
    'http://127.0.0.1/',
    'http://127.9.9.9/',
    'http://2130706433/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest',
    'http://[fe80::1]/',
    'https://cal.com/a&amp;b',
    'https://cal.com/?q=&#106;',
    'site/a&lt;b.tsx',
    'https://cal.com/a b',
    ' https://cal.com/',
    'https://cal.com/\n',
    `https://cal.com/${'a'.repeat(LINK_MAX)}`,
    '',
  ];
  for (const raw of bad)
    test(JSON.stringify(raw).slice(0, 60), () => expect(parseLinkTarget(raw)).toBeNull());

  test('2049 characters is over the limit, 2048 is fine', () => {
    const at = `x/${'a'.repeat(LINK_MAX - 6)}.tsx`;
    expect(at.length).toBe(LINK_MAX);
    expect(parseLinkTarget(at)).not.toBeNull();
    expect(parseLinkTarget(`a${at}`)).toBeNull();
  });

  test('non-strings are invalid', () => {
    for (const v of [null, undefined, 1, {}, ['#a']]) expect(parseLinkTarget(v)).toBeNull();
  });
});

describe('labels', () => {
  test('artboard, canvas, external', () => {
    expect(linkLabel({ kind: 'artboard', artboard: 'desktop' })).toBe('Go to desktop');
    expect(linkLabel({ kind: 'artboard', artboard: 'desktop' }, { artboard: 'Desktop' })).toBe(
      'Go to Desktop'
    );
    expect(linkLabel({ kind: 'canvas', canvas: 'site/pricing.tsx', artboard: 'd' })).toBe(
      'Go to Pricing'
    );
    expect(linkLabel({ kind: 'canvas', canvas: 'site/pricing-plans.tsx', artboard: null })).toBe(
      'Go to Pricing Plans'
    );
    expect(linkLabel(parseLinkTarget('https://cal.com/studio/') as LinkTarget)).toBe(
      'Opens cal.com/studio'
    );
  });
  test('externalDisplay drops the scheme and the trailing slash', () => {
    expect(externalDisplay('https://cal.com/')).toBe('cal.com');
    expect(externalDisplay('http://x.org:8080/a/b/')).toBe('x.org:8080/a/b');
  });
});
