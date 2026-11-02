// V2-8.9 round 2 R2-L2 — the credential deny rules are exact-case, and macOS volumes are
// case-insensitive by default: `~/.CONFIG/Maude/cloud.json` opens the same file as
// `~/.config/maude/cloud.json`. Whether Claude Code's own rule matcher folds case cannot be checked
// offline (the matcher lives in the native `claude` binary, which this lane never runs), so the
// bridge's live refusal folds case itself: a request or a shell command naming a credential store in
// ANY case is refused.

import { describe, expect, test } from 'bun:test';

import { credentialPathsFor, credentialRefusal } from '../acp/may-scope.ts';

const HOME = '/Users/fixture';
const p = credentialPathsFor({ HOME, XDG_CONFIG_HOME: '/x/cfg' }, HOME);
const refuse = (toolCall: Parameters<typeof credentialRefusal>[0]) =>
  credentialRefusal(toolCall, p, '/repo', HOME);

describe('case-variant credential paths', () => {
  test('a path in another case is refused', () => {
    expect(refuse({ rawInput: { file_path: `${HOME}/.CONFIG/Maude/cloud.json` } })).toBe(
      'credentials'
    );
    expect(refuse({ locations: [{ path: `${HOME}/.SSH/id_ed25519` }] })).toBe('credentials');
    expect(refuse({ rawInput: { file_path: '/X/CFG/MAUDE/hubs.json' } })).toBe('credentials');
    expect(refuse({ rawInput: { pattern: `${HOME}/.Aws/**` } })).toBe('credentials');
  });
  test('a shell command naming one in another case is refused', () => {
    for (const command of [
      'cat ~/.CONFIG/maude/hubs.json',
      `cat ${HOME}/.Ssh/id_rsa`,
      'cat $HOME/.GnuPG/private-keys-v1.d/x',
      'ls ~/library/keychains',
    ])
      expect(refuse({ rawInput: { command } })).toBe('credentials');
  });
  test('an ordinary project path still passes', () => {
    expect(refuse({ rawInput: { file_path: '/repo/.design/ui/Config.tsx' } })).toBeNull();
    expect(refuse({ rawInput: { command: 'cat .design/config.json' } })).toBeNull();
  });
});
