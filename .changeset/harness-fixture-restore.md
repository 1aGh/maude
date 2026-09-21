---
'@1agh/maude': patch
---

The test suite passes on a fresh clone again.

A fixture the conformance harness depends on had been swallowed by the repo's own ignore rules and was never committed, so `pnpm test` failed for anyone who had not built up an untracked copy of it locally. The fixture is back, and the ignore rule now makes an exception for it so the same thing cannot happen again quietly.
