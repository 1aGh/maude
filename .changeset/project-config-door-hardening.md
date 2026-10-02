---
"@1agh/maude": patch
---

Security: the owner's project-config door no longer follows a symlink committed into the project checkout (which could have overwritten hub files outside it), fills in rather than overrides a tenant's own config, never changes canvas groups once set, and accepts only group paths the hub's own classifier accepts.
