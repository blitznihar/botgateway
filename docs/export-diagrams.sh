#!/usr/bin/env bash
# Re-export the README diagrams after editing docs/architecture.drawio in draw.io.
# Produces editable .drawio.svg files (diagram embedded) and strips draw.io's per-label PNG fallbacks
# (only needed by viewers without SVG foreignObject support), cutting each file from ~1.5 MB to ~100 KB.
set -euo pipefail
cd "$(dirname "$0")"
DRAWIO="${DRAWIO:-/Applications/draw.io.app/Contents/MacOS/draw.io}"
"$DRAWIO" -x -f svg -e -p 1 -o conceptual.drawio.svg architecture.drawio
"$DRAWIO" -x -f svg -e -p 2 -o end-to-end.drawio.svg architecture.drawio
for f in conceptual.drawio.svg end-to-end.drawio.svg; do
  python3 - "$f" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = re.sub(r'(<switch>.*?</foreignObject>)\s*<image[^>]*?/>', r'\1', s, flags=re.S)
open(p, "w", encoding="utf-8").write(s)
PY
done
ls -la *.drawio.svg
