---
"@1agh/maude": patch
---

A cloud workspace synced from a desktop gets its project config from the owner: the owner's desktop sends the project name, canvas groups, design systems and tokens path (a sanitized subset — never the linked hub) through a new owner-only `PUT /api/project-config`, so canvases in the cloud load their design system's tokens and brand fonts. A code module (`.ts`) the hub would refuse from a non-owner is no longer uploaded and no longer stops every other upload in the pass.
