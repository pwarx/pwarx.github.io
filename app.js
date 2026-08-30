const DB_NAME = "pwarx-apps";
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("apps"))
        db.createObjectStore("apps", { keyPath: "id" });
      if (!db.objectStoreNames.contains("logs"))
        db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function listApps() {
  const db = await openDb();
  const tx = db.transaction("apps", "readonly");
  const store = tx.objectStore("apps");
  const apps = await new Promise((res, rej) => {
    const rq = store.getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  return apps;
}

async function saveApp(app) {
  const db = await openDb();
  const tx = db.transaction("apps", "readwrite");
  const store = tx.objectStore("apps");
  store.put(app);
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

async function deleteApp(id) {
  const db = await openDb();
  const tx = db.transaction("apps", "readwrite");
  const store = tx.objectStore("apps");
  store.delete(id);
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

async function getApp(id) {
  const db = await openDb();
  const tx = db.transaction("apps", "readonly");
  const store = tx.objectStore("apps");
  const app = await new Promise((res, rej) => {
    const rq = store.get(id);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  return app;
}

async function parseWasmPkg(file) {
  const text = await file.text();
  const pkg = JSON.parse(text);
  if (pkg.packageFormat !== 1) throw new Error("Unknown package format: " + pkg.packageFormat);
  if (!pkg.name || !pkg.files || !pkg.entry) throw new Error("Invalid package");
  const id = pkg.name + "-v" + (pkg.version || "0");
  const size = pkgSize(pkg.files);
  return { id, name: pkg.name, version: pkg.version || "0", size, entry: pkg.entry, icon: pkg.icon, files: pkg.files };
}

// ---- UI ----

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const aboutOverlay = $("#about-overlay");
const aboutBtn = $("#about-btn");
const aboutClose = $("#about-close");

aboutBtn.addEventListener("click", () => { aboutOverlay.hidden = false; });
aboutClose.addEventListener("click", () => { aboutOverlay.hidden = true; });
aboutOverlay.addEventListener("click", (e) => { if (e.target === aboutOverlay) aboutOverlay.hidden = true; });

const dropZone = $("#drop-zone");
const fileInput = $("#file-input");
const pickBtn = $("#pick-btn");
const appList = $("#app-list");
const appCards = $("#app-cards");
const emptyState = $("#empty-state");
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function pkgSize(files) {
  let bytes = 0;
  for (const f of Object.values(files)) {
    bytes += f.data.length;
  }
  // base64 length → JSON-serialized size approximation (data + keys + quotes + commas)
  return bytes;
}

function fmtSize(bytes) {
  if (bytes < 1000) return bytes + " B";
  if (bytes < 1000000) return (bytes / 1000).toFixed(1) + " KB";
  return (bytes / 1000000).toFixed(1) + " MB";
}

function fileDataUrl(file) {
  return "data:" + file.mime + ";base64," + file.data;
}

function setCookie(name, val, days) {
  const d = new Date();
  d.setDate(d.getDate() + (days || 1));
  document.cookie = name + "=" + encodeURIComponent(val) + "; path=/; expires=" + d.toUTCString() + "; SameSite=Lax";
}

function getCookie(name) {
  const m = document.cookie.match("(?:^|; )" + name + "=([^;]*)");
  return m ? decodeURIComponent(m[1]) : "";
}

function rmCookie(name) {
  document.cookie = name + "=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

function renderApps(apps) {
  appCards.innerHTML = "";
  if (apps.length === 0) {
    appList.hidden = true;
    emptyState.hidden = false;
    return;
  }
  appList.hidden = false;
  emptyState.hidden = true;
  for (const app of apps) {
    const card = document.createElement("div");
    card.className = "app-card";
    card.dataset.id = app.id;
    const iconSrc = app.icon && app.files[app.icon] ? fileDataUrl(app.files[app.icon]) : "";
    card.innerHTML =
      '<div class=app-card-icon-wrapper>' +
      (iconSrc ? '<img class=app-card-icon src="' + iconSrc + '" alt="">' : '<div class="app-card-icon placeholder"></div>') +
      '<div class=app-card-pie></div></div>' +
      '<div class=app-card-info>' +
      '<div class=app-card-name>' + esc(app.name) + '</div>' +
      '<div class=app-card-version>' + (app.size != null ? fmtSize(app.size) + ' &middot; ' : '') + 'v' + esc(app.version) + '</div></div>' +
      '<div class=app-card-actions>' +
      '<button type=button class="btn btn-primary" data-action=launch data-id="' + esc(app.id) + '">Launch</button>' +
      '<button type=button class="btn" data-action=share data-id="' + esc(app.id) + '">Share</button>' +
      '<button type=button class="btn" data-action=download data-id="' + esc(app.id) + '" title="Download .wasm-pkg">&darr;</button>' +
      '<button type=button class=btn-danger data-action=delete data-id="' + esc(app.id) + '" title=Delete>&times;</button></div>';
    appCards.appendChild(card);
  }
}

async function loadAndRender() {
  const apps = await listApps();
  renderApps(apps);
}

// ---- Import ----

async function importPkg(file) {
  try {
    const app = await parseWasmPkg(file);
    const existing = await listApps();
    const dup = existing.find((a) => a.id === app.id);
    if (dup) {
      if (!confirm(`"${app.name} v${app.version}" is already imported. Overwrite?`)) return;
    }
    await saveApp(app);
    log("action", "Imported " + app.name + " v" + app.version);
    await loadAndRender();
  } catch (err) {
    log("error", "Import failed: " + err.message);
    alert("Import failed: " + err.message);
  }
}

dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith(".wasm-pkg")) importPkg(file);
});
dropZone.addEventListener("click", () => fileInput.click());
pickBtn.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) importPkg(fileInput.files[0]);
});

// ---- App card actions ----

appCards.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === "launch") {
    await launchApp(id);
  } else if (action === "delete") {
    if (!confirm("Delete this app?")) return;
    const app = await getApp(id);
    if (!app) return;
    await deleteApp(id);
    log("action", "Deleted " + app.name + " v" + app.version);
    await loadAndRender();
  } else if (action === "share") {
    startShare(id);
  } else if (action === "download") {
    downloadPkg(id);
  }
});

// ---- App viewer ----



async function launchApp(id) {
  const app = await getApp(id);
  if (!app) return alert("App not found");
  log("info", "Launched " + app.name + " v" + app.version);
  location.href = "/app/" + id + "/" + app.entry;
}

async function downloadPkg(id) {
  const app = await getApp(id);
  if (!app) return alert("App not found");
  const pkg = { packageFormat: 1, name: app.name, version: app.version, entry: app.entry, icon: app.icon, files: app.files };
  const blob = new Blob([JSON.stringify(pkg)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = app.id + ".wasm-pkg";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---- Share (PeerJS host) ----

let shareState = null;

async function startShare(appId) {
  const apps = await listApps();
  const app = apps.find((a) => a.id === appId);
  if (!app) return alert("App not found");

  const card = document.querySelector(`.app-card[data-id="${appId}"]`);
  if (!card) return;
  log("info", "Started sharing " + app.name + " v" + app.version);
  const oldExpanded = document.querySelector(".app-card.expanded");
  if (oldExpanded) closeQr();
  card.classList.add("expanded", "sending");

  const sessionId = generateId(22);
  const key = generateId(22);
  const hostId = "pwarx-" + sessionId;
  const url = window.location.origin + "/#join=" + sessionId + "&key=" + key + "&id=" + appId;

  const qrDiv = document.createElement("div");
  qrDiv.className = "app-card-qr";
  qrDiv.innerHTML =
    '<div class="qr-code"></div>' +
    '<div class="app-card-status">Starting session\u2026</div>' +
    '<div class="app-card-actions-row">' +
    '<button type="button" class="app-card-copy">Copy Link</button>' +
    '<button type="button" class="app-card-cancel">Cancel</button></div>';
  card.appendChild(qrDiv);

  const qrEl = qrDiv.querySelector(".qr-code");
  const statusEl = qrDiv.querySelector(".app-card-status");
  const cancelBtn = qrDiv.querySelector(".app-card-cancel");
  const copyBtn = qrDiv.querySelector(".app-card-copy");
  cancelBtn.addEventListener("click", closeQr);
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy Link"; }, 2000);
    });
  });

  try {
    const peer = await openPeer(hostId);
    shareState = { peer, app, appId, conns: new Map(), key, statusEl };

    peer.on("connection", (conn) => {
      conn.on("open", () => {
        shareState.conns.set(conn.peer, conn);
        statusEl.textContent = "Peer connected! Verifying\u2026";
      });
      conn.on("data", (data) => {
        try {
          const msg = typeof data === "string" ? JSON.parse(data) : data;
          if (msg.kind === "auth-key") {
            if (msg.key === shareState.key) {
              statusEl.textContent = "Authenticated! Sending app\u2026";
              sendAppToPeer(conn, shareState.app);
            } else {
              statusEl.textContent = "Authentication failed \u2014 closing connection";
              conn.close();
            }
          }
        } catch (e) { /* ignore bad messages */ }
      });
      conn.on("close", () => shareState.conns.delete(conn.peer));
    });

    peer.on("error", (err) => {
      statusEl.textContent = "Error: " + err.message;
    });

    generateQr(qrEl, url);
    statusEl.textContent = "Waiting for peer to scan QR code\u2026";
  } catch (err) {
    statusEl.textContent = "Failed: " + err.message;
  }
}

async function sendAppToPeer(conn, app) {
  let totalBytes = 0;
  for (const f of Object.values(app.files)) totalBytes += f.data.length;
  const manifest = { kind: "app-manifest", name: app.name, version: app.version, entry: app.entry, icon: app.icon || "", fileCount: Object.keys(app.files).length, totalBytes };
  conn.send(JSON.stringify(manifest));

  const entries = Object.entries(app.files);
  const iconIdx = app.icon ? entries.findIndex(([p]) => p === app.icon) : -1;
  if (iconIdx > 0) [entries[0], entries[iconIdx]] = [entries[iconIdx], entries[0]];

  const card = document.querySelector(`.app-card[data-id="${app.id}"]`);
  const pie = card?.querySelector(".app-card-pie");
  const statusEl = shareState?.statusEl;

  if (card) card.classList.add("sending");

  let sent = 0;
  for (const [path, file] of entries) {
    const msg = JSON.stringify({ kind: "file", path, mime: file.mime, data: file.data });
    conn.send(msg);
    sent++;
    const pct = Math.round((sent / entries.length) * 100);
    if (statusEl) statusEl.textContent = "Sending " + sent + "/" + entries.length + " files";
    if (pie) {
      const wedgeDeg = Math.round(pct / 100 * 360);
      pie.style.mask = "conic-gradient(transparent 0deg " + wedgeDeg + "deg, #fff " + wedgeDeg + "deg 360deg)";
      pie.style.webkitMask = pie.style.mask;
    }
    if (sent % 5 === 0) await sleep(0);
  }
  if (statusEl) statusEl.textContent = "Done! Keep this window open so your friend can install the PWA.";
  log("action", "Sent " + app.name + " v" + app.version + " to peer");
}

// ---- QR code ----

function generateQr(el, url) {
  el.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    new QRCode(el, { text: url, width: 180, height: 180, colorDark: "#000", colorLight: "#fff", correctLevel: QRCode.CorrectLevel.H });
  } else {
    el.innerHTML = "<p style='color:#888;font-size:0.8rem'>QR library not loaded</p>";
  }
}

function closeQr() {
  document.querySelectorAll(".app-card.expanded, .app-card.sending").forEach((c) => {
    c.classList.remove("expanded", "sending");
    const qrArea = c.querySelector(".app-card-qr");
    if (qrArea) qrArea.remove();
  });
  if (shareState && shareState.peer) {
    for (const c of shareState.conns.values()) c.close();
    shareState.peer.destroy();
  }
  shareState = null;
}

// ---- Join (PeerJS client) ----

let currentSessionId = null;
let currentKey = null;

async function joinSession(sessionId, key, appId) {
  currentSessionId = sessionId;
  currentKey = key;
  const hostId = "pwarx-" + sessionId;
  setCookie("pwarx", "join=" + sessionId + "&key=" + key + (appId ? "&id=" + appId : ""), 1);

  // create receiving card inline
  const card = document.createElement("div");
  card.className = "app-card receiving";
  card.innerHTML =
    '<div class="app-card-icon-wrapper">' +
      '<div class="app-card-icon placeholder"></div>' +
      '<div class="app-card-pie"></div>' +
    '</div>' +
    '<div class="app-card-info">' +
      '<div class="app-card-name">Connecting\u2026</div>' +
      '<div class="app-card-version"></div>' +
    '</div>' +
    '<div class="app-card-actions"></div>';
  appList.hidden = false;
  emptyState.hidden = true;
  appCards.prepend(card);
  log("info", "Connecting to session...");

  const iconEl = card.querySelector(".app-card-icon");
  const pie = card.querySelector(".app-card-pie");
  const nameEl = card.querySelector(".app-card-name");
  const versionEl = card.querySelector(".app-card-version");

  try {
    const clientId = hostId + "-" + generateId(8);
    const peer = await openPeer(clientId);
    const conn = peer.connect(hostId);

    await new Promise((res, rej) => {
      conn.on("open", res);
      conn.on("error", rej);
      setTimeout(() => rej(new Error("Connection timeout")), 15000);
    });

    nameEl.textContent = "Receiving app\u2026";
    log("info", "Connected to host");

    conn.send(JSON.stringify({ kind: "auth-key", key }));

    let receivedFiles = {};
    let expectedCount = 0;
    let receivedCount = 0;
    let totalBytes = 0;
    let receivedBytes = 0;
    let appMeta = null;

    conn.on("data", (data) => {
      try {
        const msg = typeof data === "string" ? JSON.parse(data) : data;
        if (msg.kind === "app-manifest") {
          appMeta = msg;
          expectedCount = msg.fileCount;
          totalBytes = msg.totalBytes || 0;
          receivedFiles = {};
          receivedCount = 0;
          receivedBytes = 0;
          nameEl.textContent = esc(msg.name);
          versionEl.textContent = "v" + esc(msg.version);
          pie.style.mask = "conic-gradient(transparent 0deg 0deg, #fff 0deg 360deg)";
          pie.style.webkitMask = pie.style.mask;
          log("info", "Receiving " + msg.name + " v" + msg.version);
        } else if (msg.kind === "file") {
          receivedFiles[msg.path] = { data: msg.data, mime: msg.mime };
          receivedCount++;
          receivedBytes += msg.data.length;
          // show icon as soon as it arrives
          if (appMeta && msg.path === appMeta.icon) {
            const img = new Image();
            img.className = "app-card-icon";
            img.src = fileDataUrl({ data: msg.data, mime: msg.mime });
            iconEl.replaceWith(img);
          }
          const pct = totalBytes > 0
            ? Math.round((receivedBytes / totalBytes) * 100)
            : Math.round((receivedCount / expectedCount) * 100);
          const wedgeDeg = Math.round(pct / 100 * 360);
          pie.style.mask = "conic-gradient(transparent 0deg " + wedgeDeg + "deg, #fff " + wedgeDeg + "deg 360deg)";
          pie.style.webkitMask = pie.style.mask;
          versionEl.textContent = totalBytes
            ? fmtSize(receivedBytes) + "/" + fmtSize(totalBytes)
            : receivedCount + "/" + expectedCount + " files";
          if (receivedCount >= expectedCount) {
            finishReceive(peer, conn, appMeta, receivedFiles);
          }
        }
      } catch (e) { console.error("msg parse error", e); }
    });

    conn.on("close", () => {
      if (receivedCount < expectedCount) {
        log("warn", "Connection closed before transfer complete");
        nameEl.textContent = "Connection closed before transfer complete";
      }
    });

    conn.on("error", (err) => {
      log("error", "Connection error: " + err.message);
      nameEl.textContent = "Error: " + err.message;
    });

  } catch (err) {
    log("error", "Join failed: " + err.message);
    nameEl.textContent = "Failed: " + err.message;
    versionEl.textContent = "";
    setTimeout(() => { card.remove(); }, 3000);
  }
}

async function finishReceive(peer, conn, meta, files) {
  const card = appCards.querySelector(".app-card.receiving");
  const pie = card?.querySelector(".app-card-pie");
  if (pie) {
    pie.style.mask = "conic-gradient(transparent 0deg 360deg, #fff 360deg 360deg)";
    pie.style.webkitMask = pie.style.mask;
  }
  const id = meta.name + "-v" + (meta.version || "0");
  const size = pkgSize(files);
  const app = { id, name: meta.name, version: meta.version || "0", size, entry: meta.entry, icon: meta.icon || "", files };
  log("action", "Saved " + meta.name + " v" + (meta.version || "0"));
  await saveApp(app);
  conn.close();
  peer.destroy();
  await sleep(500);
  setCookie("pwarx", "join=" + currentSessionId + "&key=" + currentKey + "&id=" + id, 7);
  location.href = "/app/" + id + "/" + app.entry;
}

// ---- PeerJS helpers ----

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, {
      debug: 0,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] },
    });
    let done = false;
    peer.on("open", () => { if (!done) { done = true; resolve(peer); } });
    peer.on("error", (err) => { if (!done) { done = true; reject(err); } });
  });
}

function generateId(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  let s = "";
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < len; i++) s += c[b[i] % c.length];
  return s;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- Logging console ----

const debugLog = document.getElementById("debug-log");
const debugBtn = document.getElementById("debug-btn");
const debugPanel = document.getElementById("debug-panel");
const debugRefreshSw = document.getElementById("debug-refresh-sw");
const debugClear = document.getElementById("debug-clear");
const debugClose = document.getElementById("debug-close");
const debugExport = document.getElementById("debug-export");
const debugInput = document.getElementById("debug-input");
const debugPrompt = document.getElementById("debug-prompt");

let shellApp = null;
let shellPath = "";
let shellHistory = [];
let shellHistIdx = -1;

function shellPrompt() {
  if (shellApp) return shellApp.name + " v" + shellApp.version + (shellPath ? "/" + shellPath : "") + " $";
  return "$";
}

function shellPrint(text) {
  debugLog.textContent += (debugLog.textContent ? "\n" : "") + text;
  debugLog.scrollTop = debugLog.scrollHeight;
}

function ts() { return new Date().toISOString(); }
function fmtTs(t) { return t.slice(11, 23); }

async function log(level, ...args) {
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ");
  const entry = { time: ts(), level, msg };
  try {
    const db = await openDb();
    const tx = db.transaction("logs", "readwrite");
    const store = tx.objectStore("logs");
    store.add(entry);
    const count = await new Promise((res, rej) => {
      const rq = store.count();
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    if (count > 1000) {
      const rq = store.openCursor();
      let toDelete = count - 1000;
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (cursor && toDelete > 0) {
          store.delete(cursor.key);
          toDelete--;
          cursor.continue();
        }
      };
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch (_) { /* log store unavailable */ }
  renderLogEntry(entry);
}

function renderLogEntry(entry) {
  const line = fmtTs(entry.time) + " [" + entry.level + "] " + entry.msg;
  debugLog.textContent += (debugLog.textContent ? "\n" : "") + line;
  debugLog.scrollTop = debugLog.scrollHeight;
}

async function loadLogs() {
  try {
    const db = await openDb();
    const tx = db.transaction("logs", "readonly");
    const store = tx.objectStore("logs");
    const all = await new Promise((res, rej) => {
      const rq = store.getAll();
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    debugLog.textContent = "";
    for (const entry of all) renderLogEntry(entry);
  } catch (_) { /* ignore */ }
}

async function clearLogs() {
  try {
    const db = await openDb();
    const tx = db.transaction("logs", "readwrite");
    const store = tx.objectStore("logs");
    store.clear();
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch (_) { /* ignore */ }
  debugLog.textContent = "";
}

async function refreshSw() {
  if (!("serviceWorker" in navigator)) {
    log("warn", "Service Worker not available (insecure context?)");
    return;
  }
  log("action", "Refreshing Service Worker...");
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.unregister();
    log("action", "Service Worker unregistered, reloading...");
    location.reload();
  } catch (err) {
    log("error", "SW refresh failed: " + err.message);
  }
}

async function exportLogs() {
  try {
    const db = await openDb();
    const tx = db.transaction("logs", "readonly");
    const store = tx.objectStore("logs");
    const all = await new Promise((res, rej) => {
      const rq = store.getAll();
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    const lines = all.map(e => e.time + " [" + e.level + "] " + e.msg).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pwarx-logs-" + new Date().toISOString().slice(0, 10) + ".txt";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (err) {
    log("error", "Export failed: " + err.message);
  }
}

log("info", "pwarx ready " + navigator.userAgent.slice(0, 50));
if (window.navigator.standalone) log("info", "standalone mode");

debugBtn.addEventListener("click", () => {
  const wasHidden = debugPanel.hidden;
  debugPanel.hidden = !wasHidden;
  debugBtn.textContent = wasHidden ? "X" : ">";
  if (wasHidden) {
    debugLog.scrollTop = debugLog.scrollHeight;
    requestAnimationFrame(() => debugInput.focus());
  }
});

function closePanel() {
  debugPanel.hidden = true;
  debugBtn.textContent = ">";
  shellHistory = [];
  shellHistIdx = -1;
}

debugClose.addEventListener("click", closePanel);

debugClear.addEventListener("click", clearLogs);
debugExport.addEventListener("click", exportLogs);
debugRefreshSw.addEventListener("click", refreshSw);

window.addEventListener("error", (e) => log("error", e.message));
window.addEventListener("unhandledrejection", (e) => log("error", String(e.reason)));

// ---- Shell ----

function updatePrompt() {
  debugPrompt.textContent = shellPrompt();
}

function listDirs(paths) {
  const dirs = new Set();
  for (const p of paths) {
    const idx = p.indexOf("/");
    if (idx >= 0) dirs.add(p.slice(0, idx));
  }
  return [...dirs].map(d => d + "/");
}

async function shellExec(line) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ");

  if (cmd === "help") {
    shellPrint("Commands:");
    shellPrint("  ls             list apps (root) or files (in app)");
    shellPrint("  cd <name|..>   enter app / subdirectory / go up");
    shellPrint("  pwd            print working directory");
    shellPrint("  open <path>    open file in new tab");
    shellPrint("  cat <path>     display text file content");
    shellPrint("  clear          clear screen");
    shellPrint("  exit           close panel");
    shellPrint("  help           this message");
  } else if (cmd === "clear") {
    debugLog.textContent = "";
  } else if (cmd === "exit") {
    closePanel();
  } else if (cmd === "pwd") {
    shellPrint(shellApp ? "/app/" + shellApp.name + (shellPath ? "/" + shellPath : "") : "~");
  } else if (cmd === "ls") {
    if (!shellApp) {
      const apps = await listApps();
      if (apps.length === 0) {
        shellPrint("(no apps)");
      } else {
        shellPrint("Apps:");
        const seen = new Map();
        for (const a of apps) seen.set(a.name, (seen.get(a.name) || 0) + 1);
        for (const a of apps) {
          const hint = seen.get(a.name) > 1 ? "  (cd \"" + a.name + " v" + a.version + "\")" : "";
          shellPrint("  " + a.name + "  v" + a.version + hint);
        }
      }
    } else {
      const fullPaths = Object.keys(shellApp.files);
      const relevant = shellPath ? fullPaths.filter(p => p.startsWith(shellPath + "/")).map(p => p.slice(shellPath.length + 1)) : fullPaths;
      const files = relevant.filter(p => !p.includes("/"));
      const dirs = listDirs(relevant);
      if (dirs.length === 0 && files.length === 0) {
        shellPrint("(empty)");
      } else {
        if (dirs.length) shellPrint("directories:");
        for (const d of dirs) shellPrint("  " + d);
        if (files.length) shellPrint("files:");
        for (const f of files) shellPrint("  " + f);
      }
    }
  } else if (cmd === "cd") {
    if (!arg || arg === "~") {
      shellApp = null;
      shellPath = "";
    } else if (arg === "..") {
      if (!shellApp) { shellPrint("already at root"); }
      else if (shellPath) {
        const parts = shellPath.split("/");
        parts.pop();
        shellPath = parts.join("/");
      } else {
        shellApp = null;
        shellPath = "";
      }
    } else {
      if (!shellApp) {
        const apps = await listApps();
        const exact = apps.filter(a => a.id === arg);
        if (exact.length === 1) {
          shellApp = exact[0];
          shellPath = "";
        } else {
          const byName = apps.filter(a => a.name === arg);
          if (byName.length === 1) {
            shellApp = byName[0];
            shellPath = "";
          } else if (byName.length > 1) {
            shellPrint("multiple apps match \"" + arg + "\":");
            for (const a of byName) shellPrint("  " + a.name + " v" + a.version + "  (cd \"" + a.name + " v" + a.version + "\")");
          } else {
            // try "name vVersion" pattern
            const vmatch = arg.match(/^(.+?) v(.+)$/);
            if (vmatch) {
              const byNameV = apps.filter(a => a.name === vmatch[1] && a.version === vmatch[2]);
              if (byNameV.length === 1) {
                shellApp = byNameV[0];
                shellPath = "";
              } else {
                shellPrint("app not found: " + arg);
              }
            } else {
              shellPrint("app not found: " + arg);
            }
          }
        }
      } else {
        const fullPaths = Object.keys(shellApp.files);
        const prefix = shellPath ? shellPath + "/" + arg : arg;
        const exists = fullPaths.some(p => p === prefix || p.startsWith(prefix + "/"));
        if (exists) {
          shellPath = prefix;
        } else {
          shellPrint("no such directory: " + arg);
        }
      }
    }
    updatePrompt();
  } else if (cmd === "open") {
    if (!shellApp) { shellPrint("no app selected (cd into one first)"); return; }
    if (!arg) { shellPrint("usage: open <path>"); return; }
    const fullPath = shellPath ? shellPath + "/" + arg : arg;
    const file = shellApp.files[fullPath];
    if (!file) { shellPrint("file not found: " + fullPath); return; }
    const mime = file.mime || "application/octet-stream";
    const binary = atob(file.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    const fileName = fullPath.split("/").pop();
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 1000);
    shellPrint("opened " + fullPath);
  } else if (cmd === "cat") {
    if (!shellApp) { shellPrint("no app selected"); return; }
    if (!arg) { shellPrint("usage: cat <path>"); return; }
    const fullPath = shellPath ? shellPath + "/" + arg : arg;
    const file = shellApp.files[fullPath];
    if (!file) { shellPrint("file not found: " + fullPath); return; }
    const text = atob(file.data);
    shellPrint("--- " + fullPath + " ---");
    shellPrint(text.length > 2000 ? text.slice(0, 2000) + "\n... (truncated)" : text);
    shellPrint("---");
  } else if (cmd) {
    shellPrint("unknown command: " + cmd + " (type 'help')");
  }
}

const COMMANDS = ["help", "ls", "cd", "pwd", "open", "cat", "clear", "exit"];

async function completeInner(line) {
  const parts = line.split(/\s+/);
  const cmd = parts[0];
  const hasSpace = line.endsWith(" ");
  const partial = hasSpace ? "" : (parts.length > 1 ? parts[parts.length - 1] : parts[0]);
  const isFirst = parts.length === 1 && !hasSpace;

  let candidates = [];

  if (isFirst) {
    candidates = COMMANDS.filter(c => c.startsWith(partial));
  } else if (["cd", "open", "cat"].includes(cmd)) {
if (!shellApp && (cmd === "cd" || cmd === "open" || cmd === "cat")) {
        // complete app names (with version hint if duplicates exist)
        const apps = await listApps();
        const nameCount = new Map();
        for (const a of apps) nameCount.set(a.name, (nameCount.get(a.name) || 0) + 1);
        candidates = apps.map(a => nameCount.get(a.name) > 1 ? a.name + " v" + a.version : a.name).filter(n => n.startsWith(partial));
    } else if (shellApp) {
      const fullPaths = Object.keys(shellApp.files);
      const prefix = shellPath ? shellPath + "/" : "";
      const relevant = fullPaths
        .filter(p => p.startsWith(prefix))
        .map(p => p.slice(prefix.length))
        .filter(p => p.startsWith(partial));
      // deduplicate dir prefixes
      const seen = new Set();
      for (const p of relevant.sort()) {
        const idx = p.indexOf("/");
        if (idx >= 0) {
          const dir = p.slice(0, idx + 1);
          if (!seen.has(dir)) { seen.add(dir); candidates.push(dir); }
        } else {
          if (!seen.has(p)) { seen.add(p); candidates.push(p); }
        }
      }
    }
  }

  return { candidates, partial };
}

debugInput.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const line = debugInput.value;
    completeInner(line).then(({ candidates, partial }) => {
      if (candidates.length === 0) return;
      if (candidates.length === 1) {
        const completion = candidates[0];
        const parts = line.split(/\s+/);
        const hasSpace = line.endsWith(" ");
        const isFirst = parts.length === 1 && !hasSpace;
        if (isFirst) {
          debugInput.value = completion + " ";
        } else {
          const before = line.slice(0, line.lastIndexOf(partial));
          debugInput.value = before + completion + " ";
        }
      } else {
        // show candidates
        const ts = new Date().toISOString().slice(11, 23);
        debugLog.textContent += (debugLog.textContent ? "\n" : "") + ts + "  " + candidates.join("  ");
        debugLog.scrollTop = debugLog.scrollHeight;
        // find common prefix
        if (partial) {
          const common = candidates.reduce((a, b) => {
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            return a.slice(0, i);
          });
          if (common.length > partial.length) {
            const parts = line.split(/\s+/);
            const hasSpace = line.endsWith(" ");
            const isFirst = parts.length === 1 && !hasSpace;
            if (isFirst) {
              debugInput.value = common;
            } else {
              const before = line.slice(0, line.lastIndexOf(partial));
              debugInput.value = before + common;
            }
          }
        }
      }
    });
    return;
  }
  if (e.key === "Enter") {
    const line = debugInput.value;
    debugInput.value = "";
    if (line.trim()) {
      shellHistory.push(line.trim());
      shellHistIdx = -1;
      const ts = new Date().toISOString().slice(11, 23);
      debugLog.textContent += (debugLog.textContent ? "\n" : "") + ts + " " + shellPrompt() + " " + line;
      shellExec(line);
    }
    setTimeout(() => debugLog.scrollTop = debugLog.scrollHeight, 0);
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (shellHistory.length === 0) return;
    if (shellHistIdx === -1) shellHistIdx = shellHistory.length;
    shellHistIdx = Math.max(0, shellHistIdx - 1);
    debugInput.value = shellHistory[shellHistIdx];
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (shellHistIdx === -1) return;
    shellHistIdx = Math.min(shellHistory.length - 1, shellHistIdx + 1);
    debugInput.value = shellHistory[shellHistIdx];
    if (shellHistIdx === shellHistory.length - 1) { shellHistIdx = -1; debugInput.value = ""; }
  }
  if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    debugLog.textContent = "";
  }
  if (e.key === "u" && e.ctrlKey) {
    e.preventDefault();
    debugInput.value = "";
  }
});

debugPanel.addEventListener("click", () => debugInput.focus());

let lastEsc = 0;
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (debugPanel.hidden) {
    const now = Date.now();
    if (now - lastEsc < 400) {
      debugPanel.hidden = false;
      debugBtn.textContent = "X";
      debugLog.scrollTop = debugLog.scrollHeight;
      requestAnimationFrame(() => debugInput.focus());
      lastEsc = 0;
    } else {
      lastEsc = now;
    }
  } else {
    closePanel();
  }
});

// ---- Init ----

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (err) {
      console.warn("SW registration failed", err);
    }
  });
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
function getHashParam(name) {
  return new URLSearchParams(window.location.hash.slice(1)).get(name);
}

async function init() {
  await loadLogs();
  if ("serviceWorker" in navigator && window.isSecureContext) {
    try {
      await navigator.serviceWorker.ready;
    } catch (_) {}
  }

  const joinParam = getHashParam("join");
  const keyParam = getHashParam("key");
  const idParam = getHashParam("id") || getParam("id");

  // /?id=AppName or /#id=AppName → launch installed app
  if (idParam) {
    const app = await getApp(idParam);
    if (app) {
      location.href = "/app/" + idParam + "/" + app.entry;
      return;
    }
  }

  if (joinParam) {
    joinSession(joinParam, keyParam, idParam);
    return;
  }

  // Cookie bridge (iOS 17.2+ copies cookie from Safari to PWA at install)
  const pwarxCookie = getCookie("pwarx");
  if (pwarxCookie) {
    const cp = new URLSearchParams(pwarxCookie);
    const cJoin = cp.get("join");
    const cKey = cp.get("key");
    const cId = cp.get("id");
    if (cId || cJoin) {
      const app = cId ? await getApp(cId) : null;
      if (app) {
        rmCookie("pwarx");
        location.href = "/app/" + cId + "/" + app.entry;
        return;
      }
      if (cJoin) {
        rmCookie("pwarx");
        joinSession(cJoin, cKey, cId);
        return;
      }
    }
  }

  const apps = await listApps();
  renderApps(apps);
}
init();