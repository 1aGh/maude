---
"@1agh/maude": patch
---

An idle desktop now lets its cloud project sleep. After 20 minutes with no edits and no keyboard or mouse input, the desktop closes its cloud connection and the status bar reads **asleep**; the next change or click reconnects, and anything teammates changed meanwhile arrives (a parked desktop checks every minute without waking the project). Two background loops that kept an idle desktop talking to its project are also fixed: the file sync no longer re-reads the project every two seconds after writing its own bookkeeping, and the file-event channel no longer reconnects every half minute. Self-hosted hubs and older cloud projects behave exactly as before.
