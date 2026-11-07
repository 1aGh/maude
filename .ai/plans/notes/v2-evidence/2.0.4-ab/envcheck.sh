#!/bin/bash
# Print HOME/XDG/config pointers of every process whose command line names our A/B trees or scratch.
for p in $(pgrep -f 'ab-w20|scratchpad/ab'); do
  c=$(ps -o comm= -p $p 2>/dev/null) || continue
  e=$(ps eww -o command= -p $p | tr ' ' '\n' | grep -E '^(HOME|XDG_CONFIG_HOME|HUBS_CONFIG_PATH|MAUDE_INDEX_DIR|MAUDE_CLOUD_CONFIG|MAUDE_UI_PREFS_PATH)=' | tr '\n' ' ')
  echo "$p $(basename "$c") :: $e"
done
