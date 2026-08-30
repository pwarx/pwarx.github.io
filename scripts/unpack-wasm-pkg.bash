#!/usr/bin/env bash
# unpack-wasm-pkg.bash – Extract a .wasm-pkg file into a directory tree
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <file.wasm-pkg> [output-dir]"
  exit 1
fi

pkg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
out="${2:-$(basename "$1" .wasm-pkg)}"

mkdir -p "$out"
cd "$out"

python3 -c "
import json, base64, os, sys

pkg = json.load(open('$pkg'))
for path, info in pkg['files'].items():
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    data = base64.b64decode(info['data'])
    with open(path, 'wb') as f:
        f.write(data)
print('Extracted', len(pkg['files']), 'files to', '$out')
"