#!/usr/bin/env node
// A hook that does nothing — used only to show the v2-hook tests go red without the real hooks
// (fail-first rule). `V2_HOOK_UNDER_TEST=scripts/v2-hooks/noop-hook.mjs node --test scripts/v2-hooks/v2-hook.test.mjs`
process.exit(0);
