#!/bin/bash
# usage: sheet.sh <out.jpg> <w-per-tile> <cols> file...   (labels each tile with its basename)
out=$1; w=$2; cols=$3; shift 3
magick montage -label '%t' -pointsize 16 "$@" -resize ${w}x -tile ${cols}x -geometry +6+6 -background '#888' -fill white "$out"
