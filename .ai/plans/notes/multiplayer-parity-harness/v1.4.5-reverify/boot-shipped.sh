#!/bin/bash
# boot-shipped.sh <projectRoot> <port> <logfile> -> prints pid
export MAUDE_DEV_SERVER_ROOT=/Applications/Maude.app/Contents/Resources/apps/studio
export MAUDE_PKG_ROOT=/Applications/Maude.app/Contents/Resources
export MAUDE_NO_AUTOBUILD=1
nohup /Applications/Maude.app/Contents/MacOS/maude-server --root "$1" --port "$2" > "$3" 2>&1 &
echo $!
