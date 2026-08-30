#!/usr/bin/env bash
# package-wasm-pkg.bash <src-dir> — Create a .wasm-pkg from a directory tree
set -euo pipefail
SRC="$(cd "${1:-.}" && pwd)"
OUTDIR="$(cd "${2:-.}" 2>/dev/null && pwd || { mkdir -p "${2:-.}" && cd "${2:-.}" && pwd; })"
MANIFEST="$SRC/manifest.webmanifest"
NAME=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['name'])")
ENTRY="index.html"
ICON=$(python3 -c "
import json
m = json.load(open('$MANIFEST'))
ics = m.get('icons', [])
print(ics[0]['src'].lstrip('./') if ics else '')
")
VERSION=$(cat "$SRC/PORT_VERSION" | tr -d '\n')
cd "$SRC"
python3 -c "
import base64, json, mimetypes, os
SRC = '$SRC'
NAME = '$NAME'
VERSION = '$VERSION'
ENTRY = '$ENTRY'
ICON = '$ICON'
mime_map = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.wasm': 'application/wasm', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
    '.bin': 'application/octet-stream',
}
files = {}
for root, dirs, fnames in os.walk('.'):
    for f in fnames:
        full = os.path.join(root, f)
        rel = os.path.relpath(full, '.')
        ext = os.path.splitext(f)[1].lower()
        mime = mime_map.get(ext) or mimetypes.guess_type(f)[0] or 'application/octet-stream'
        with open(full, 'rb') as fp:
            data = base64.b64encode(fp.read()).decode('ascii')
        files[rel] = {'data': data, 'mime': mime}
pkg = {'packageFormat': 1, 'name': NAME, 'version': VERSION, 'entry': ENTRY, 'icon': ICON, 'files': dict(sorted(files.items()))}
out = os.path.join('$OUTDIR', NAME + '-v' + VERSION + '.wasm-pkg')
with open(out, 'w') as fp:
    json.dump(pkg, fp, separators=(',', ':'))
size = os.path.getsize(out)
print(f'Wrote {out} ({len(files)} files, {size // 1024} KB)')
"