#!/usr/bin/env python3
"""unpack-wasm-pkg.py – Extract a .wasm-pkg file into a directory tree."""
import argparse, base64, json, os, sys

def main():
    parser = argparse.ArgumentParser(description="Extract a .wasm-pkg archive")
    parser.add_argument("pkg", help="Path to .wasm-pkg file")
    parser.add_argument("out", nargs="?", default=None,
                        help="Output directory (default: <pkg-name>/)")
    args = parser.parse_args()

    with open(args.pkg) as f:
        pkg = json.load(f)

    name = os.path.splitext(os.path.basename(args.pkg))[0]
    out = args.out or name
    os.makedirs(out, exist_ok=True)

    for path, info in pkg["files"].items():
        dest = os.path.join(out, path)
        d = os.path.dirname(dest)
        if d:
            os.makedirs(d, exist_ok=True)
        data = base64.b64decode(info["data"])
        with open(dest, "wb") as f:
            f.write(data)

    print(f"Extracted {len(pkg['files'])} files to {out}/")

if __name__ == "__main__":
    main()