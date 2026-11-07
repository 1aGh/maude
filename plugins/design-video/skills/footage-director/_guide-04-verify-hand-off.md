## Verify + hand off

- **Motion over time** (DDR-094 / DDR-148): seek to two frames (or scrub the
  Player) and confirm the frame content changes — a still can look right while
  the video is frozen. The motion-critic hard-gates this.
- **Export**: `/design:export mp4 --scope artboard` (fps/duration from the comp
  meta) — the DDR-148 capture spine, no renderer binaries.
- **License note**: Remotion is source-available (free for individuals / ≤3-person
  companies) — surface once, per `video-comp` SKILL.md.
