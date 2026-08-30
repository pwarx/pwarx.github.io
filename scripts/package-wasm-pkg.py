#!/usr/bin/env python3
"""package-wasm-pkg.py <src-dir> — Create a .wasm-pkg from a directory tree."""
import base64, json, mimetypes, os, sys

src = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
out_dir = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else ".")
with open(os.path.join(src, "manifest.webmanifest")) as f:
    manifest = json.load(f)
name = manifest["name"]
entry = "index.html"
icon = manifest.get("icons", [{}])[0].get("src", "").lstrip("./")
with open(os.path.join(src, "PORT_VERSION")) as f:
    version = f.read().strip()

mime_map = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".wasm": "application/wasm", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
    ".ts": "video/mp2t", ".m2ts": "video/mp2t",
    ".pdi": "application/octet-stream", ".pda": "application/octet-stream",
    ".bin": "application/octet-stream",
}

pkg_files = {}
for root, dirs, fnames in os.walk(src):
    for f in fnames:
        full = os.path.join(root, f)
        rel = os.path.relpath(full, src)
        ext = os.path.splitext(f)[1].lower()
        mime = mime_map.get(ext) or (mimetypes.guess_type(f)[0]) or "application/octet-stream"
        with open(full, "rb") as fp:
            data = base64.b64encode(fp.read()).decode("ascii")
        pkg_files[rel] = {"data": data, "mime": mime}

pkg = {"packageFormat": 1, "name": name, "version": version, "entry": entry, "icon": icon, "files": dict(sorted(pkg_files.items()))}
out = os.path.join(out_dir, f"{name}-v{version}.wasm-pkg")
with open(out, "w") as fp:
    json.dump(pkg, fp, separators=(",", ":"))
print(f"Wrote {out} ({len(pkg_files)} files, {os.path.getsize(out) // 1024} KB)")