// Who a local comment is signed by when the VCS has no `user.name` (10 · co-comment-thread: a thread
// whose author read "unknown" and whose pin was a "?" disc). A Mac without an identity set is still a
// person: the account's own name signs, so the thread has a face (tone + initial) and the author can
// edit it. Order: configured name → the OS account → "You". Pure, so the order is a plain test.

import { userInfo } from 'node:os';

const clean = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 120) : '');
// Bun's `userInfo().username` reads $USER / $LOGNAME and answers the literal "unknown" when neither is set
// (Node asks getpwuid) — and "unknown" is the unsigned sentinel an earlier build wrote (author-face.ts
// `isUnsigned`): such a comment read "by Someone". It is no name.
const accountName = (s: unknown) => {
  const name = clean(s);
  return name.toLowerCase() === 'unknown' ? '' : name;
};

export function localAuthor(configured: string, osName: string = osAccount()): string {
  return clean(configured) || accountName(osName) || 'You';
}

let cachedAccount: string | null = null;
/** This process's account name — asked of the OS (`id -un`, by uid) when the environment does not say. */
function osAccount(): string {
  if (cachedAccount !== null) return cachedAccount;
  let name = '';
  try {
    name = accountName(userInfo().username);
  } catch {
    /* no passwd entry */
  }
  if (!name && typeof Bun !== 'undefined') {
    try {
      const r = Bun.spawnSync(['id', '-un'], { stdout: 'pipe', stderr: 'ignore' });
      if (r.exitCode === 0) name = accountName(r.stdout.toString());
    } catch {
      /* no `id` */
    }
  }
  cachedAccount = name;
  return name;
}
