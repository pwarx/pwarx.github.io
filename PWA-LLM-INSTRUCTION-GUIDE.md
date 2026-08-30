# LLM Instruction Guide — pwarx-class Progressive Web Apps

## TL;LC — let's code

Build a minimal vanilla Progressive Web App: static files only, GitHub Pages–ready, HTTPS. Include a web app manifest, PNG icons, and a service worker that precaches the shell and serves imported guest apps from IndexedDB at `/app/<id>/*` with correct MIME types (especially `application/wasm`). Guest apps arrive as a versioned JSON `.wasm-pkg` (base64 files + entry + mime). The UI is a mobile-first dark shell: drop-zone import, cards with Launch / Share / Download / Delete. Optional P2P share uses QR + WebRTC (auth key in the URL hash, progress UI, STUN-only documented). Handle iOS standalone via apple meta tags, apple-touch-icon, and a short-lived SameSite=Lax cookie bridge. No bundler, no backend, no silent failures.

Reference implementation: [pwarx](https://github.com/pwarx/pwarx.github.io) · live shell: [pwarx.github.io](https://pwarx.github.io/). Follow this full guide (the rest of this document): [PWA-LLM-INSTRUCTION-GUIDE.md](https://github.com/pwarx/pwarx.github.io/blob/main/PWA-LLM-INSTRUCTION-GUIDE.md). If you only received the paragraph above, fetch that guide and the repo before writing files — the spec below is the source of truth.

---

Use this document as a **system prompt / implementation spec** when generating or modifying a PWA like [pwarx](https://github.com/pwarx/pwarx.github.io): a tiny, vanilla, GitHub Pages–hosted shell that imports portable static/WASM apps, stores them in the browser, serves them offline via a service worker, and optionally relays them device-to-device.

Follow these rules unless the user explicitly overrides them.

---

## 0. What you are building

A **shell PWA** plus **guest apps**:

- The **shell** is the installable PWA (`index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`).
- **Guest apps** are self-contained static bundles (HTML/JS/CSS/WASM/assets) packaged as a single portable file.
- Once imported, a guest app is stored in **IndexedDB** and launched at a scoped URL such as `/app/<appId>/<entry>`.
- The **service worker** is the virtual file server: it intercepts `/app/<appId>/*` and returns bytes + correct MIME types from IDB.
- Sharing (optional) is **peer-to-peer** (WebRTC data channel + QR), not a backend that stores apps.

Non-goals unless asked:

- No bundler, no framework, no npm build step for the shell.
- No app-store backend. GitHub Pages (or any static HTTPS host) is enough.
- Do not invent a custom server protocol when IndexedDB + SW + WebRTC already solve it.

---

## 1. Hard constraints

1. **HTTPS or localhost only.** Service workers, WebRTC, and installability require a secure context. Check `window.isSecureContext` before registering the SW.
2. **Vanilla static files.** Ship readable `index.html`, `style.css`, `app.js`, `sw.js`, `manifest.webmanifest`. No Vite/webpack unless the user demands it.
3. **Same-origin SW.** Register `./sw.js` (or `/sw.js` at site root). The SW must only handle `url.origin === self.location.origin`.
4. **Root hosting assumed** (`https://user.github.io/`). If the site will live under a subpath (`/repo/`), every URL, `start_url`, cache list, and SW match must use that base. Never hardcode a host.
5. **Offline shell first.** After first visit, the shell must open with no network. Guest apps must run with no network once imported.
6. **Correct MIME types.** Especially `application/wasm` for `.wasm`. Wrong type → instantiateStreaming fails.
7. **No eval / no remote code execution from untrusted strings** beyond serving the imported package the user explicitly accepted.
8. **Escape all user/package strings** before injecting into HTML (`& < > "`). Guest app `name` can contain quotes.
9. **Do not block the main thread** with huge `atob` / JSON.parse of multi‑MB packages without progress UI.

---

## 2. Canonical file layout

```
/
├── index.html              # shell UI
├── style.css               # dark, mobile-first, CSS variables
├── app.js                  # IDB, UI, import/share/launch
├── sw.js                   # cache shell + serve /app/* from IDB
├── manifest.webmanifest    # install metadata (this filename is fine)
├── icons/                  # real PNG icons (preferred over only data-URIs)
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png   # 180×180
├── serve.sh                # local HTTP(S) static server
└── README.md
```

Keep the shell tiny. Vendor small libs (QR) as files so the SW can cache them. CDNs (PeerJS, etc.) are **online-only features** — never put them on the critical path for launch/offline.

---

## 3. HTML shell — installability + iOS

`index.html` must include:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1a1a1a">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="AppName">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
```

Good practice vs. shortcuts:

- Prefer **PNG icons on disk** over emoji-in-SVG data URIs. iOS home-screen icons are unreliable with SVG/data-URI-only manifests.
- `user-scalable=no` hurts accessibility — do not add it unless the guest app is a game that requires it.
- Use semantic landmarks (`main`, `header`, labelled buttons, `aria-label` on icon-only controls).
- Overlays: close on backdrop click + explicit close button + `hidden` attribute.
- Register the SW **after `load`**, only in a secure context, with a failed-register warning (do not crash the UI).

```js
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("SW registration failed", err);
    });
  });
}
```

Wait for `navigator.serviceWorker.ready` before launching a guest app that depends on SW routing.

---

## 4. Web app manifest

Static shell manifest (`manifest.webmanifest`):

```json
{
  "id": "/",
  "name": "pwarx",
  "short_name": "pwarx",
  "description": "Peer-to-peer WASM app relay",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#1a1a1a",
  "theme_color": "#1a1a1a",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Rules:

- `start_url` and `scope` must stay inside the SW scope.
- `short_name` ≤ ~12 characters for home-screen labels.
- `display`: `standalone` for app-like; `fullscreen` only for games that hide system UI on purpose.
- **Maskable icons** need ~10–20% safe-zone padding. Do not mark a tight emoji SVG as `maskable`.
- Serve the file with `Content-Type: application/manifest+json` when you control headers; GitHub Pages will usually send `application/octet-stream` or JSON — browsers still accept `.webmanifest`.
- Link the manifest from **every document the user might install from**, including injected guest HTML if you want “Add to Home Screen” for that guest.

### Dynamic per-guest manifest (pwarx pattern)

If each imported game should be installable as its own icon:

- SW intercepts `/manifest.webmanifest?id=<appId>` and returns JSON built from IDB (`name`, `start_url`, icon data-URL or generated icon route).
- Inject into guest HTML `<head>`:
  - `<link rel="manifest" href="/manifest.webmanifest?id=...">`
  - `<meta name="apple-mobile-web-app-title" content="...">`
  - `<link rel="apple-touch-icon" href="data:...">` or a SW-served icon URL
- Pick **one** launch URL scheme and use it everywhere (`start_url`, QR, cookies, `location.href`). Do not mix `/?id=`, `/#id=`, and `/app/id/entry` without a single resolver in `init()`.

Recommended single scheme:

- Library UI: `/`
- Join session: `/#join=<session>&key=<key>&id=<appId>`
- Launch guest: `/app/<appId>/<entry>`
- Installed-PWA start for a guest: `/#id=<appId>` which the shell resolves to `/app/<appId>/<entry>`

Hash params survive GitHub Pages and are not sent to the server.

---

## 5. Service worker — required behavior

### Lifecycle

```js
const SHELL_CACHE = "app-shell-v1"; // bump when shell files change

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)));
  self.skipWaiting(); // tiny shell: take over immediately
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
```

- Version the cache name. Old caches must be deleted on activate.
- `skipWaiting` + `clients.claim` is correct for a 10 KB shell. For large product PWAs, prefer a “Update available” UI instead.
- Precache **only** same-origin shell files that exist. A failed `cache.addAll` rejects the whole install.
- Do **not** precache CDN URLs (they fail offline and opaque-cors).

### Fetch routing (order matters)

1. Ignore other origins (`return;` — do not `respondWith`).
2. `/app/<appId>/<filePath>` → IndexedDB with the package MIME type. On any miss (unknown app, unknown path, IDB error) **fall back to the shell**, matching pwarx:

   ```js
   e.respondWith(serveFromDb(m[1], m[2]).catch(() => serveShell()));
   ```

3. `/manifest.webmanifest` → default or `?id=` dynamic.
4. `request.mode === "navigate"` → shell `index.html` (SPA fallback) **except** navigations under `/app/` which already matched step 2.
5. Shell static assets → cache-first, network fallback, then shell HTML last resort.

### Serving guest files from IDB

- Look up `appId`, then `files[filePath]`. Throw if either is missing — the fetch handler’s `.catch(() => serveShell())` turns that into the shell HTML.
- Decode bytes and return `new Response(bytes, { headers: { "Content-Type": file.mime } })`.
- HTML files: inject into `<head>` a title meta, optional apple-touch-icon data URL, and `<link rel="manifest" href="/manifest.webmanifest?id=...">` via `html.replace("<head>", ...)`.
- Never rewrite guest JS/WASM.
- Preserve path structure (`pkg/foo.wasm` ≠ `foo.wasm`). Guest relative URLs must resolve under `/app/<id>/`.

### MIME map (minimum)

| Extension | MIME |
|-----------|------|
| `.html` | `text/html; charset=utf-8` |
| `.js` / `.mjs` | `text/javascript` |
| `.css` | `text/css` |
| `.wasm` | `application/wasm` |
| `.json` | `application/json` |
| `.svg` | `image/svg+xml` |
| `.png` `.jpg` `.webp` `.gif` `.ico` | matching image type |
| `.woff2` | `font/woff2` |
| `.mp3` `.ogg` `.wav` | matching audio type |

If the package already carries `mime`, trust it but sanitize to a known list.

---

## 6. IndexedDB

- DB name constant shared by `app.js` and `sw.js` (they cannot import each other unless you add a classic shared file; duplication of `openDb` is OK if identical).
- Object store `apps` with `keyPath: "id"`.
- Record shape:

```js
{
  id: "Puzzle-15-v0.1.0-rc2",   // name + "-v" + version
  name: "Puzzle-15",
  version: "0.1.0-rc2",         // opaque display string
  entry: "index.html",
  icon: "icon.png",             // key in files, optional
  size: 123456,                 // optional, for UI
  files: {
    "index.html": { data: "<base64 or better>", mime: "text/html" },
    "pkg/app.wasm": { data: "...", mime: "application/wasm" }
  }
}
```

Better than base64-in-JSON (do this for new designs):

- Store `Blob` or `ArrayBuffer` in IDB (IDB supports structured clone).
- Keep base64 only as the **on-disk portable package** format, convert on import/export.

Always:

- Wrap IDB in Promises.
- Close the DB after each page-side transaction when possible.
- Handle upgrade with `onupgradeneeded` only; never bump version without a migration.
- Confirm before overwrite / delete.

Quota: large WASM games can hit browser storage caps. Surface errors (`QuotaExceededError`) instead of failing silently. `navigator.storage.persist()` is optional after the user imports something.

---

## 7. Portable package format (`.wasm-pkg`)

On-disk exchange format — JSON, `packageFormat: 1`:

```json
{
  "packageFormat": 1,
  "name": "Puzzle-15",
  "version": "0.1.0-rc2",
  "entry": "index.html",
  "icon": "icon.png",
  "files": {
    "index.html": { "data": "<base64>", "mime": "text/html" },
    "pkg/app.wasm": { "data": "<base64>", "mime": "application/wasm" }
  }
}
```

Validation on import:

- `packageFormat === 1`
- `name`, `files`, `entry` present
- `entry` exists in `files`
- reject path traversal (`../`, absolute paths, backslashes)
- reject empty file set
- compute `id = name + "-v" + (version || "0")`

Packaging rules for guest projects (not the pwarx shell):

- Rewrite any `../pkg/` (or other out-of-root) URLs so every file lives inside the package tree.
- Read `name` / `icon` from the game’s `manifest.webmanifest` if present; version from `PORT_VERSION` or a similar sidecar (opaque string, no semver required).
- Include every file the entry needs. Guess MIME from extension (see §5) when the source has no type.
- Emit `<Name>-v<Version>.wasm-pkg` (JSON, `packageFormat: 1`).
- Paths inside `files` are relative, POSIX, no `..`.

**Where packers live.** The relay PWA only **imports** `.wasm-pkg`. It does not ship pack/unpack tooling. pwarx’s README describes `scripts/package-wasm-pkg.{bash,js,py,ps1}` plus unpack/test twins and a per-game `scripts/package-pwarx.sh`, but **those files are not in [pwarx.github.io](https://github.com/pwarx/pwarx.github.io)** — they belong next to the WASM game (or a separate tooling repo). Do not dump four language ports into the shell.

When the user asks you to package a game, write **one** packer in the game’s stack (bash is enough). Unpack + a checksum round-trip test are optional. Extra language ports are only worth it if you must prove bit-identical JSON across tools.

A packer should: walk `src-dir` → base64 each file → write the JSON object above. A per-game script may also rewrite HTML (`../pkg/` → `./pkg/`) before packing.

UI: drag-and-drop + hidden `<input type="file" accept=".wasm-pkg">`. Also offer Download so a received app can leave the browser.

---

## 8. Launch model

```js
location.href = "/app/" + encodeURIComponent(id) + "/" + app.entry;
```

- The guest then loads as a normal multi-file site under that prefix.
- Relative links inside the guest (`./pkg/app.wasm`) work because the SW serves that path.
- If the guest registers its own service worker, it may fight the shell SW. Document this: prefer guests without their own SW, or register guest SW under `/app/<id>/` scope only.
- Do not iframe guests unless you need isolation; a top-level navigation keeps WASM, Fullscreen, and “Add to Home Screen” simpler.

---

## 9. P2P share (optional but characteristic)

Stack used by pwarx: **PeerJS** (WebRTC data channel) + **QR** of a join URL + public PeerJS signaling + Google STUN.

Good practices:

- Peer IDs: prefix + high-entropy id (`pwarx-` + 22 chars from `crypto.getRandomValues`).
- **Auth key** in the QR, verified before any file is sent. Close the connection on mismatch.
- Put session tokens in the **hash** (`/#join=&key=&id=`), not query, so they are less likely to hit access logs.
- Send a **manifest first** (`kind`, `fileCount`, `totalBytes`, metadata), then files.
- Show progress on both sides. Keep the host page open until transfer completes.
- Yield the event loop every few messages (`await sleep(0)`) so the UI paints.
- Time out joins (~15s) with a human-readable error.
- STUN-only ⇒ same LAN or easy NAT. Document that. Do not pretend TURN exists if you did not add a TURN server.
- Destroy `Peer` and close connections when the QR overlay is dismissed.
- Treat PeerJS cloud as a **signaling convenience**, not as app storage. Apps must never upload to your (non-existent) server.

Better transfer design (recommended for new code):

- Send **binary frames** (ArrayBuffer) not JSON-wrapped base64 — roughly 33% smaller and far easier on the GC.
- Chunk files (e.g. 16–64 KiB) with `{kind:"chunk", path, index, total, bytes}`.
- Optional checksum (SHA-256) on the manifest.

QR:

- Vendor the QR library so sharing still works if the shell is cached.
- High error correction (`H`) because phone cameras + bright rooms.
- Encode the full absolute URL (`location.origin + "/#join=..."`).

### iOS install cookie bridge

Safari → home-screen PWA can lose hash/state but, on recent iOS, may copy first-party cookies into the standalone Web.app.

Pattern:

1. On join/receive, `setCookie("pwarx", "join=...&key=...&id=...", { SameSite=Lax, path=/ })`.
2. On shell `init()`, if no hash params, read cookie; if it names an imported `id`, launch; if it names `join`, resume; then delete the cookie.

Do not store the raw package in a cookie.

---

## 10. UI / UX

- Dark theme, system font stack, CSS variables, `max-width` ~36rem, thumb-friendly tap targets (≥44px where possible).
- Empty state + drop zone + app cards: Launch / Share / Download / Delete.
- Confirm destructive actions.
- Progress overlay while receiving; QR overlay while hosting.
- Hidden debug log (user-agent, standalone flag, SW errors, Peer errors). Essential for iOS.
- Detect standalone: `window.navigator.standalone` (iOS) or `matchMedia("(display-mode: standalone)")`.
- `safe-area-inset-*` padding when using `viewport-fit=cover`.
- Do not set `user-select: none` on text the user may want to copy (session errors, GitHub link).
- Always give a visible error string; never `catch (_) {}` on import/share.

---

## 11. Security baseline

- Origin check in the SW.
- Auth key on P2P.
- HTML-escape names/versions before `innerHTML`. Prefer `textContent` + DOM APIs for UI chrome.
- Sanitize package paths.
- `X-Content-Type-Options: nosniff` on SW responses.
- `rel="noopener"` on external links.
- No inline event handlers.
- Cookies: `SameSite=Lax`, no secrets beyond short-lived session keys.
- Remember: **anyone who can import a `.wasm-pkg` is running that code in their origin**. The shell origin is the trust boundary. Do not host a public unmoderated gallery under the same origin as a privileged app.
- Guest HTML injection must not break out of `<head>` (escape `content` attributes).

---

## 12. Local dev and deploy

Dev:

- Service workers on LAN phones need **HTTPS** (or `localhost`). Ship `serve.sh` that:
  - serves the repo root
  - binds `0.0.0.0`
  - uses `cert.pem`/`key.pem` if present (`mkcert` recommended)
  - prints both localhost and LAN URLs
- Chrome: Application panel → Service Workers, Manifest, IndexedDB, Cache Storage.
- After every SW change: bump `SHELL_CACHE` or unregister SW while iterating.

Deploy:

- GitHub Pages from `main` at the domain root for `user.github.io`.
- Push static files only. No Jekyll processing surprises: add `.nojekyll` if you use folders starting with `_`.
- After deploy, hard-refresh once so clients pick up the new cache version.

---

## 13. Guest-app requirements (tell the LLM that builds the WASM game)

For a game/app to work inside the shell:

1. Must be a static directory with a single HTML entry.
2. All assets relative to that entry (or rewritten at pack time).
3. No absolute `https://localhost` or `file://` URLs.
4. WASM fetched with the right MIME (the shell SW guarantees this if `mime` is set).
5. Avoid assuming a dedicated service worker unless scoped under the launch prefix.
6. Prefer no `SharedArrayBuffer` unless the **host origin** sends COOP/COEP (GitHub Pages does not).
7. Provide an icon and a short name.
8. If it needs persistence, use its own IDB database name, not the shell’s.

---

## 14. Implementation order (when generating from scratch)

1. `index.html` + `style.css` + empty-state UI.
2. `manifest.webmanifest` + PNG icons + SW precache of the shell. Verify “Install / Add to Home Screen”.
3. IndexedDB CRUD + import `.wasm-pkg` + card list + delete/download.
4. `sw.js` `/app/<id>/*` server + Launch navigation. Verify WASM loads offline (airplane mode).
5. Head injection + dynamic manifest if per-game install is required.
6. QR + PeerJS share + progress + auth key + cookie bridge.
7. `serve.sh`, README, pack/unpack notes.
8. Pass the checklist below.

---

## 15. Acceptance checklist

Install / PWA

- [ ] Manifest linked, valid JSON, `name`, `short_name`, `start_url`, `display`, icons
- [ ] Installable on Chromium desktop and Android
- [ ] iOS Add to Home Screen shows a custom title + icon (PNG `apple-touch-icon`)
- [ ] `theme-color` matches the UI
- [ ] Standalone mode has no accidental browser chrome gaps (safe areas)

Offline

- [ ] Airplane mode after first visit: shell still opens
- [ ] Imported app launches and its `.wasm` instantiates
- [ ] Reloading `/app/<id>/<entry>` while offline still works

SW

- [ ] Only same-origin requests are intercepted
- [ ] Cache version bump replaces old shell
- [ ] Missing guest file → `serveFromDb` rejects and the fetch handler serves the shell (`serveShell()`), not a 404
- [ ] HTML served as `text/html`, WASM as `application/wasm`

Data

- [ ] Import rejects bad packages
- [ ] Overwrite/delete confirmed
- [ ] Download reproduces a loadable `.wasm-pkg`
- [ ] Paths with directories (`pkg/x.wasm`) survive

P2P (if present)

- [ ] QR encodes origin + hash params + auth key
- [ ] Wrong key does not receive files
- [ ] Progress reaches 100% and app appears on the receiver
- [ ] Closing the QR panel tears down PeerJS
- [ ] Documented LAN/NAT limitation

Quality

- [ ] No unescaped package strings in HTML
- [ ] Buttons have types and labels
- [ ] Errors visible to the user
- [ ] No bundler required to deploy

---

## 16. What not to generate

- A React/Vue SPA “because PWA” — this class of app is a few hundred lines of vanilla JS.
- A Node backend “to store the wasm files”.
- Workbox + huge precache of every guest app.
- `eval` of package JS.
- Service worker that caches `GET` to other origins by default.
- `start_url` pointing at a 404.
- Maskable icons that are cropped emoji.
- Mixing `http://` LAN URLs into production QR codes.

---

## 17. Voice when writing code

- Small functions, no framework.
- Constants at top: `DB_NAME`, `DB_VERSION`, `SHELL_CACHE`.
- Comments only for non-obvious platform quirks (iOS cookie bridge, MIME for WASM, hash params on GitHub Pages).
- Match existing names if editing pwarx (`parseWasmPkg`, `serveFromDb`, `launchApp`, `joinSession`).
- Prefer fixing inconsistencies (one launch URL scheme, binary IDB, chunked binary P2P) when building a **new** cousin project; when **patching pwarx**, stay compatible with `packageFormat: 1` and the current IDB shape.
