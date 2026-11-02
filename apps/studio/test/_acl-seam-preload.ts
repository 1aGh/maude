// S9.12 — `bun run --preload` for the revert guard's server (test/acl-revert-guard.test.ts).
// Reverts the ACL checks named in MAUDE_TEST_ACL_REVERT (comma-separated) before server.ts
// loads. Only a test passes `--preload`; the product never reads this variable.

import { type AclCheck, revertAclCheckForTest } from '../access/filters.ts';

for (const check of (process.env.MAUDE_TEST_ACL_REVERT ?? '').split(',').filter(Boolean))
  revertAclCheckForTest(check as AclCheck);
