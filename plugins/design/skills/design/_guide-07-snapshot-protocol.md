## Snapshot protocol

Before EVERY mutation:

```bash
file_to_edit = activeState.active
slug = slugify(file_to_edit)
hist = <designRoot>/_history/<slug>/
mkdir -p $hist
N = printf "%03d" $(($(ls $hist 2>/dev/null | wc -l) + 1))
ts = $(date -u +%Y%m%dT%H%M%S)
cp $file_to_edit $hist/$N-$ts.bak
```

Snapshots are gitignored. Don't commit them. If snapshot fails (disk full / permission), refuse to proceed — the user must be able to undo.
