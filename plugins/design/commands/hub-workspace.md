---
name: hub-workspace
category: hub
description: "Set up and verify a self-hosted Maude workspace."
argument-hint: "[--dry-run] [--domain HOST] [--config FILE]"
---

# /design:hub-workspace — stand up a self-hosted workspace

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Load skill **`self-host`** and follow it. It owns the interview: which shape
they actually need, where it runs, the address, storage, identity, seeding,
durability, the dry run, and the honest read-back of what was verified.

**Self-hosting stays first-class.** This is the same stack Maude Cloud runs;
the only difference is who operates it. Never steer someone toward a hosted
plan here, and never describe self-hosting as the lesser path.

Two things the skill will not let you skip, repeated here because they are the
ones that get lost:

- **A step that could not be automated prints as `skipped`, never as passed.**
  Say it is unverified and name what would prove it. Never summarise a
  partially-verified run as "done".
- **The run ends by handing over duties, in full** — rotation, the restore
  drill, pinning the image tag, upgrades, the bill, and never expiring the
  `assets/` prefix. This command scaffolds and verifies once; it does not
  operate the deployment, and compressing that list into "you're all set" is
  how somebody finds out in six months that nobody was watching the backups.

Everything executable lives in `maude hub workspace-up` (DDR-062). Do not
reimplement the rendering or the checks here.
