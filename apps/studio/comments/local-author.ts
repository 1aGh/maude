// Who a local comment is signed by when the VCS has no `user.name` (10 · co-comment-thread: a thread
// whose author read "unknown" and whose pin was a "?" disc). A Mac without an identity set is still a
// person: the account's own name signs, so the thread has a face (tone + initial) and the author can
// edit it. Order: configured name → the OS account → "You". Pure, so the order is a plain test.

import { userInfo } from 'node:os';

const clean = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 120) : '');

export function localAuthor(configured: string, osName: string = osAccount()): string {
  return clean(configured) || clean(osName) || 'You';
}

function osAccount(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}
