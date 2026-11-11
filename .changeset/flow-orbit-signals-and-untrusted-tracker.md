---
"@1agh/maude": patch
---

flow + orbit tracker: state reports carry `command` and `verdict`; `/flow:execute` checks for a plan attached to the task and asks before running a tracker plan (shows version and who pushed it); `/flow:done` never moves a task past `doneStatus`, attaches UI screenshots from this run's scenario report (`integrations.tracker.attachScreenshots`) and re-checks closed parent/linked tasks for regressions (`integrations.tracker.regressionCheck`) through a new tool-less `flow:tracker-reader` agent. Tracker text is always treated as untrusted data.
