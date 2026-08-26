const DB = "pwarx-apps";
const SHELL_CACHE = "pwarx-shell-v1";
const SHELL_URLS = ["/", "/index.html", "/app.js", "/style.css", "/qrcode-lib.js", "/manifest.webmanifest", "/sw.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // /app/<id>/<path> → IndexedDB, fallback to shell
  const m = url.pathname.match(/^\/app\/([^/]+)\/(.+)$/);
  if (m) {
    e.respondWith(
      serveFromDb(m[1], m[2]).catch(() => serveShell())
    );
    return;
  }

  // manifest.webmanifest?id=<appId> → dynamic manifest for active game
  if (url.pathname === "/manifest.webmanifest") {
    const appId = url.searchParams.get("id");
    if (appId) {
      e.respondWith(
        serveDynamicManifest(appId).catch(() => serveDefaultManifest())
      );
      return;
    }
    e.respondWith(serveDefaultManifest());
    return;
  }

  // Navigation → always serve shell (SPA fallback)
  if (e.request.mode === "navigate" || url.pathname === "/") {
    e.respondWith(serveShell());
    return;
  }

  // Static assets → cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => serveShell()))
  );
});

async function serveShell() {
  const cached = await caches.match("/index.html");
  return cached || fetch("/index.html");
}

async function serveFromDb(appId, filePath) {
  const db = await openDb();
  const tx = db.transaction("apps");
  const store = tx.objectStore("apps");
  const app = await new Promise((res, rej) => {
    const rq = store.get(appId);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  if (!app) throw new Error("App not found");
  const file = app.files[filePath];
  if (!file) throw new Error("File not found: " + filePath);
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  const isHtml = file.mime === "text/html";
  if (isHtml) {
    let html = new TextDecoder().decode(bytes);
    const iconTag = app.icon && app.files[app.icon]
      ? '<link rel="apple-touch-icon" href="data:' + app.files[app.icon].mime + ';base64,' + app.files[app.icon].data + '">'
      : "";
    const metaTitle = '<meta name="apple-mobile-web-app-title" content="' + app.name.replace(/"/g,"&quot;") + '">';
    const manifestTag = '<link rel="manifest" href="/manifest.webmanifest?id=' + app.id + '">';
    const inject = metaTitle + '\n  ' + iconTag + '\n  ' + manifestTag;
    html = html.replace("<head>", "<head>\n  " + inject);
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
  return new Response(bytes, {
    headers: { "Content-Type": file.mime },
  });
}

async function serveDefaultManifest() {
  const cached = await caches.match("/manifest.webmanifest");
  return cached || fetch("/manifest.webmanifest");
}

async function serveDynamicManifest(appId) {
  const db = await openDb();
  const tx = db.transaction("apps");
  const store = tx.objectStore("apps");
  const app = await new Promise((res, rej) => {
    const rq = store.get(appId);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  if (!app) throw new Error("App not found");

  let iconSrc = "";
  if (app.icon && app.files[app.icon]) {
    iconSrc = "data:" + app.files[app.icon].mime + ";base64," + app.files[app.icon].data;
  }

  const manifest = {
    name: app.name,
    short_name: app.name,
    start_url: "/#id=" + app.id,
    display: "standalone",
    background_color: "#1a1a1a",
    theme_color: "#1a1a1a",
    icons: iconSrc ? [{ src: iconSrc, sizes: "any", type: "image/png", purpose: "any" }] : [],
  };

  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/json" },
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("apps", { keyPath: "id" });
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}