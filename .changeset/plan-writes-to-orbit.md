---
'@1agh/maude': patch
---

`/flow:plan` on a project that keeps its plans in orbit now actually puts them there, and tells you where to click when it is done.

Setting `integrations.tracker.artifacts` to `{ "store": "orbit", "local": "scratch" }` was supposed to mean the repo keeps no copy of a plan. In practice the plan was still written to `.ai/plans/`, the orbit task was never created, and nothing was sent — the whole thing had to be redone by hand once somebody noticed. The command contradicted itself: the instruction at the very top said, without any condition, to write a file to the repo, and the rule about orbit sat three hundred lines below it. The first one won.

Three things changed. Where the plan goes is now decided at the top, from the setting, before anything else happens. The orbit task is resolved or created at the start, next to the other opening steps, instead of at the end after all the research — so a plan can no longer be finished with nothing to attach it to. And the summary you get at the end always carries a link to the task, plus the name and version of what was stored, rather than the path of a file that under this setting does not exist.

A plan that could not be sent is still never lost: it stays in the spool folder for the next command to retry, and the summary now names that file so you can find it. Projects that keep their plans in the repo are unaffected.
