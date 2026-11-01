// r2-browser-reds — a Mac with no git user.name signs local comments with the OS account (localAuthor). Bun's
// `os.userInfo().username` reads $USER / $LOGNAME and answers the literal "unknown" when neither is set
// (Node asks getpwuid). "unknown" is the old unsigned sentinel: every comment read "by Someone" with an "S",
// the Comments panel's row never said "You" (browser e2e comments-identity-pins F08 on the Mac mini lane,
// whose env has no USER). The account is still a person: its real name signs, never "unknown".

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { isUnsigned } from '../comments/author-face.ts';
import { localAuthor } from '../comments/local-author.ts';

const MODULE = join(import.meta.dir, '..', 'comments', 'local-author.ts');

function signWithoutUserEnv(): string {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'USER' && k !== 'LOGNAME' && typeof v === 'string') env[k] = v;
  }
  const r = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `const { localAuthor } = await import(${JSON.stringify(MODULE)}); process.stdout.write(localAuthor(''));`,
    ],
    { env, stdout: 'pipe', stderr: 'pipe' }
  );
  return r.stdout.toString();
}

describe('localAuthor never signs the unsigned sentinel', () => {
  test('an OS answer of "unknown" is no name', () => {
    expect(localAuthor('', 'unknown')).toBe('You');
    expect(localAuthor('', ' Unknown ')).toBe('You');
    expect(localAuthor('Ada', 'unknown')).toBe('Ada');
  });

  test('with no $USER / $LOGNAME the account still signs by its name', () => {
    const name = signWithoutUserEnv();
    expect(name.length).toBeGreaterThan(0);
    expect(isUnsigned(name)).toBe(false);
    // the same account this process runs as
    expect(name).toBe(localAuthor(''));
  });
});
