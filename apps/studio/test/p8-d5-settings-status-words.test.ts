// D5 02 ob-settings: a Connections row draws its description once; the status line carries only the state.
import { describe, expect, test } from 'bun:test';
import { cloudRow, hubRow } from '../client/v2/settings/connections-model.js';

describe('Settings › Connections status lines do not repeat the row description', () => {
  test('cloud, signed out', () => {
    const s = cloudRow({ state: 'out' }).status;
    expect(s).not.toContain('Where your projects live');
    expect(s).toBe('Not signed in');
  });
  test('team server, not added', () => {
    const s = hubRow({}).status;
    expect(s).not.toContain('A self-hosted server, beside the cloud');
    expect(s).toBe('Sign in with your email and password.');
  });
});
