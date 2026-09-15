import { describe, expect, test } from 'bun:test';
import {
  buildShareLinks,
  localIdentityMatches,
  normalizeOpenParam,
  parseFileDeepLink,
  projectIdFromHubUrl,
  readOpenParam,
  withOpenParam,
} from '../client/share-link.js';

describe('shell file addresses', () => {
  test('strips the configured design root and decodes once', () => {
    expect(normalizeOpenParam('.design/ui/Hello%20world.tsx')).toBe('ui/Hello world.tsx');
    expect(normalizeOpenParam('design/ui/Žába.tsx', 'design')).toBe('ui/Žába.tsx');
    for (const rel of ['ui/100%.tsx', 'ui/%2e%2e.tsx', 'ui/A+B & C#?.tsx', 'ui/Žába.tsx']) {
      expect(readOpenParam({ search: withOpenParam({ pathname: '/' }, rel) })).toBe(rel);
    }
  });
  test('rejects hostile paths', () => {
    for (const path of [
      '',
      '../.ai/x',
      '/etc/passwd',
      'ui/..%2F..',
      'ui\\Foo',
      '%00',
      'a'.repeat(600),
      'ui//X',
      './a',
      'C:/a',
      '%ZZ',
    ]) {
      expect(normalizeOpenParam(path)).toBeNull();
    }
    expect(readOpenParam({ search: '?open=a&open=b' })).toBeNull();
  });
  test('history addresses stay relative and slashes remain readable', () => {
    expect(withOpenParam({ pathname: '/' }, 'ui/A B.tsx')).toBe('?open=ui/A%20B.tsx');
    expect(withOpenParam({ pathname: '/' }, null)).toBe('/');
  });
  test('hub identity excludes IPs and local hosts', () => {
    expect(projectIdFromHubUrl('https://alligators.cloud.maude.sh')).toBe('alligators');
    for (const url of [
      'http://127.0.0.1:4000',
      'http://[::1]:4000',
      'http://localhost:4000',
      'https://example.com',
    ])
      expect(projectIdFromHubUrl(url)).toBeNull();
  });
  test('public addresses come from configuration and local fallback is labelled', () => {
    const args = {
      rel: 'ui/A.tsx',
      shell: 'native',
      location: new URL('http://localhost:4000/'),
      project: 'My Project',
      localUrl: 'http://localhost:4000',
    };
    expect(buildShareLinks(args)).toMatchObject({
      web: null,
      app: 'maude://open/my-project?open=ui/A.tsx',
      appIsLocalOnly: true,
      local: 'http://localhost:4000/?open=ui/A.tsx',
    });
    expect(buildShareLinks({ ...args, linkedHubUrl: 'http://localhost:4001' }).web).toBeNull();
    expect(buildShareLinks({ ...args, linkedHubUrl: 'https://real.cloud.maude.sh' })).toMatchObject(
      {
        web: 'https://real.cloud.maude.sh/?open=ui/A.tsx',
        app: 'maude://open/real?open=ui/A.tsx',
        appIsLocalOnly: false,
      }
    );
    expect(
      buildShareLinks({
        ...args,
        shell: 'cloud',
        location: new URL('https://real.cloud.maude.sh/'),
      })
    ).toMatchObject({ web: 'https://real.cloud.maude.sh/?open=ui/A.tsx', local: null });
  });
  test('file links have one file parameter and no connect code or arbitrary origin', () => {
    expect(parseFileDeepLink('maude://open/a?open=ui/A.tsx')).toEqual({
      project: 'a',
      rel: 'ui/A.tsx',
    });
    for (const url of [
      'maude://open/a?open=a&code=mhc_aaaa',
      'maude://open/a?open=a&open=b',
      'maude://open/a?open=a&origin=https://evil',
      'maude://join/a?open=a',
      'maude://open/A?open=a',
      'maude://open/a?open=../x',
      'maude://open/a?open=x#fragment',
    ])
      expect(parseFileDeepLink(url)).toBeNull();
  });
  test('similar names never silently become the same project', () => {
    expect(localIdentityMatches({ project: 'my-project' }, 'my-project')).toBe(true);
    expect(localIdentityMatches({ project: 'my-project' }, 'my-project-evil')).toBe(false);
    expect(
      localIdentityMatches(
        { project: 'my-project', linkedHub: { url: 'https://real.cloud.maude.sh' } },
        'my-project'
      )
    ).toBe(false);
  });
});
