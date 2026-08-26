# pwarx — Peer-to-Peer WebAssembly App Relay & Exchange

A minimal PWA that imports, hosts, relays, and shares WASM games/apps device-to-device via WebRTC. No central server ever stores the apps — they travel directly between browsers.

## Why

WASM game projects like `Puzzle-15` produce a directory of static files (HTML, JS, WASM, assets). Normally you'd host them on a web server. But what if you want to:

- Share a game with a friend next to you without deploying it anywhere?
- Let that friend re-share it to someone else?
- Keep the app working entirely offline as a PWA?

**pwarx** is the relay and exchange layer. It lives on GitHub Pages as a tiny (~10 KB) PWA. You import a `.wasm-pkg` file once, and from then on it's stored in your browser's IndexedDB. Tap "Share" to generate a QR code; a friend scans it, their pwarx receives the whole app P2P via PeerJS, and they tap "Launch" to play.

## Architecture

```
GitHub Pages (pwarx.github.io)
┌────────────────────────────────────────┐
│  pwarx PWA (~10 KB + QR lib)            │
│  index.html · style.css · app.js       │
│  sw.js · qrcode-lib.js                 │
│                                        │
│  Serve /app/<id>/ * from IndexedDB ────│  via service worker
│  P2P share via PeerJS + QR ────────────│  on the same Wi-Fi
└────────────────────────────────────────┘

       ▲ import .wasm-pkg │ ▲ scan QR
       │                  │ │
  ┌────┴────┐       ┌────┴─┴──┐
  │ Host    │  P2P  │ Friend  │
  │ phone   │◄─────►│ phone   │
  │ (IDB)   │       │ (IDB)   │
  └─────────┘       └─────────┘
```

## File format: `.wasm-pkg`

A single portable file containing the entire app. It's a JSON manifest where each file is base64-encoded:

```json
{
  "packageFormat": 1,
  "name": "Puzzle-15",
  "version": "0.1.0-rc2",
  "entry": "index.html",
  "files": {
    "index.html": { "data": "<base64>", "mime": "text/html" },
    "pkg/wasm.wasm": { "data": "<base64>", "mime": "application/wasm" }
  }
}
```

The `version` field is an opaque string used for display and as part of the app identity key — no semantic versioning is enforced.

Tooling scripts under `scripts/`:

| Platform | Package | Unpack | Test |
|----------|---------|--------|------|
| Bash     | `scripts/package-wasm-pkg.bash [src-dir] [out-dir]` | `scripts/unpack-wasm-pkg.bash <file.wasm-pkg> [out-dir]` | `scripts/test-pack-unpack.sh [src-dir]` |
| Node.js  | `scripts/package-wasm-pkg.js [src-dir] [out-dir]` | `scripts/unpack-wasm-pkg.js <file.wasm-pkg> [out-dir]` | |
| Python   | `scripts/package-wasm-pkg.py [src-dir] [out-dir]` | `scripts/unpack-wasm-pkg.py <file.wasm-pkg> [out-dir]` | |
| PowerShell | `scripts/package-wasm-pkg.ps1 [[-Src] <dir>] [[-Out] <dir>]` | `scripts/unpack-wasm-pkg.ps1 -Pkg <file.wasm-pkg> [-Out <dir>]` | `scripts/test-pack-unpack.ps1 [[-Src] <dir>]` |

All packaging scripts read `manifest.webmanifest` (name, icon) and `PORT_VERSION` from the source directory, include all files, and write `<Name>-v<Version>.wasm-pkg` to the output directory. The test scripts package with every available tool, compare checksums across languages, then unpack and verify the round-trip.

## Service worker

The pwarx SW intercepts all requests under `/app/<appId>/` and serves files from IndexedDB. This means:

- The app runs in its own URL scope with correct MIME types for WASM, JS, CSS, etc.
- The app's own SW registration still works (optional; graceful failure if not included)
- Everything works offline once imported

## Project structure

```
pwarx/
├── index.html         PWA shell — drop zone, app cards, share/launch
├── style.css          Dark theme, cards, QR popover
├── app.js             All logic: IDB, PeerJS, QR, chunked transfer, UI
├── sw.js              Service worker — serve /app/<id>/* from IDB
├── qrcode-lib.js      Vendored QRCode.js (davidshimjs/qrcodejs)
├── serve.sh           Local HTTPS dev server
└── README.md          This file
```

## Build and serve

No bundler, no npm. Pure static files.

```bash
# Local dev (HTTPS required for service worker)
./serve.sh

# Deploy to GitHub Pages
# Just push the repo — pwarx.github.io serves directly
```

## Packager script (per game)

Each game project that wants to be shareable via pwarx needs a packaging script. Example for Puzzle-15 at `scripts/package-pwarx.sh`:

```bash
# Collect files, rewrite ../pkg/ → ./pkg/ in index.html, emit .wasm-pkg
./scripts/package-pwarx.sh
# → puzzle-15-v0.1.0.wasm-pkg
```

Import that file into pwarx via drag-drop or the file picker, then share away.

## P2P flow

1. **Host** taps "Share" on an app card → pwarx creates a PeerJS session → shows QR code
2. **Friend** scans the QR → opens pwarx at the session URL → PeerJS connects
3. **Host** sends the app manifest, then all files chunked over the data channel
4. **Friend** reassembles, stores in IndexedDB, sees "Launch" button
5. **Friend** taps "Launch" → navigates to `/app/<appId>/index.html` → SW serves it → game runs

## PeerJS signaling

Uses the PeerJS cloud signaling server. STUN only by default (Google public STUN servers). Both devices must be on the same network or have compatible NAT for the direct P2P connection to establish.

## License

MIT. The qrcode-lib.js is MIT (davidshimjs/qrcodejs).