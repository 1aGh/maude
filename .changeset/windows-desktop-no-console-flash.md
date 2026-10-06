---
"@1agh/maude": patch
---

The Windows app no longer flashes a console window every few seconds. With more than one project open (always the case right after onboarding), the app checked the other projects for running chats every 6 seconds by starting a command-line program, and Windows showed a window for each one. The Assistant also starts on Windows machines that have Node.js installed: the app passed its own folder to Node in a form (`\\?\C:\…`) Node cannot run a script from.
