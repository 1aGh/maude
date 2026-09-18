---
"@1agh/maude": patch
---

Plans, RCAs, execution reports, retros and code reviews can now live in orbit instead of the repo's `.ai/` folder.

A project that tracks its work in orbit had its task in one place and the record of why the work was done the way it was in another: markdown files next to the code, on whichever laptop produced them. The flow config gained `integrations.tracker.artifacts`. Left out, nothing changes. Set to `{ "store": "orbit" }`, each of those five documents is sent to orbit the moment it is written rather than copied at the end, and the commands that need one later read it back from there.

With `"local": "scratch"` the repo keeps no copy: the command writes the document to a spool folder that git ignores, sends it, and deletes it only once orbit has confirmed it arrived. A send that fails leaves the file in the spool and the next flow command tries again, so an orbit that is down or a token that has expired costs a warning, never the document. `"store": "both"` keeps the file and sends it, which is the gentle way to move a project across.

The PRD, the design system, the codebase map, the workflow state, scenarios and architectural decisions stay where they are. On a project that also uses the knowledge graph, each verdict is still recorded there, now before it is sent rather than after, so the graph keeps being fed.
