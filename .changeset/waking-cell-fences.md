---
"@1agh/maude": patch
---

A workspace that has just woken up no longer lets anyone write before it knows how the project saves.

A hub reads how its project saves from its own store when it starts, and until that read comes back it was assuming the older, everybody-writes-directly answer. On a cloud workspace the read crosses the network and the workspace wakes up constantly, so somebody reconnecting in that first moment could be handed a writable connection to a project that accepts only proposals — two ways of writing the same canvas at once, which is the one thing this design rules out. Nobody writes now until the answer is in. A workspace that has not looked yet also stops reporting the old answer as though it had: it says it does not know.

On the desktop, a project you were invited to now offers the way into its own history from the status bar — every change with who made it, and Undo on the ones that are yours. It was only reachable from the View menu before, on the single screen an invited designer actually uses.
