const DB_NAME = "pwarx-apps";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("apps"))
        db.createObjectStore("apps", { keyPath: "id" });
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
const qrOverlay = $("#qr-overlay");
const qrCode = $("#qr-code");
const qrStatus = $("#qr-status");
const qrTitle = $("#qr-title");
const qrClose = $("#qr-close");
const qrCancel = $("#qr-cancel");
const progressOverlay = $("#progress-overlay");
const progressName = $("#progress-name");
const progressBar = $("#progress-bar");
const progressText = $("#progress-text");

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
    const iconSrc = app.icon && app.files[app.icon] ? fileDataUrl(app.files[app.icon]) : "";
    card.innerHTML =
      (iconSrc ? '<img class=app-card-icon src="' + iconSrc + '" alt="">' : "") +
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
    await loadAndRender();
  } catch (err) {
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
    await deleteApp(id);
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
  debug("launchApp", id);
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

  qrOverlay.hidden = false;
  qrTitle.textContent = "Share: " + app.name;
  qrStatus.textContent = "Starting session…";
  qrCode.innerHTML = "";

  const sessionId = generateId(22);
  const key = generateId(22);
  const hostId = "pwarx-" + sessionId;

  try {
    const peer = await openPeer(hostId);
    shareState = { peer, app, appId, conns: new Map(), key };

    peer.on("connection", (conn) => {
      conn.on("open", () => {
        shareState.conns.set(conn.peer, conn);
        qrStatus.textContent = "Peer connected! Verifying…";
      });
      conn.on("data", (data) => {
        try {
          const msg = typeof data === "string" ? JSON.parse(data) : data;
          if (msg.kind === "auth-key") {
            if (msg.key === shareState.key) {
              qrStatus.textContent = "Authenticated! Sending app…";
              sendAppToPeer(conn, shareState.app);
            } else {
              qrStatus.textContent = "Authentication failed — closing connection";
              conn.close();
            }
          }
        } catch (e) { /* ignore bad messages */ }
      });
      conn.on("close", () => shareState.conns.delete(conn.peer));
    });

    peer.on("error", (err) => {
      qrStatus.textContent = "Error: " + err.message;
    });

    const url = window.location.origin + "/#join=" + sessionId + "&key=" + key + "&id=" + appId;
    generateQr(url);
    qrStatus.textContent = "Waiting for peer to scan QR code…";
  } catch (err) {
    qrStatus.textContent = "Failed: " + err.message;
  }
}

async function sendAppToPeer(conn, app) {
  let totalBytes = 0;
  for (const f of Object.values(app.files)) totalBytes += f.data.length;
  const manifest = { kind: "app-manifest", name: app.name, version: app.version, entry: app.entry, icon: app.icon || "", fileCount: Object.keys(app.files).length, totalBytes };
  conn.send(JSON.stringify(manifest));

  const entries = Object.entries(app.files);
  let sent = 0;
  for (const [path, file] of entries) {
    const msg = JSON.stringify({ kind: "file", path, mime: file.mime, data: file.data });
    conn.send(msg);
    sent++;
    qrStatus.textContent = "Sending " + sent + "/" + entries.length + " files";
    if (sent % 5 === 0) await sleep(0);
  }
  qrStatus.textContent = "Done! Keep this window open so your friend can install the PWA.";
  qrTitle.textContent = "Session active";
}

// ---- QR code ----

function generateQr(url) {
  qrCode.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    new QRCode(qrCode, { text: url, width: 200, height: 200, colorDark: "#000", colorLight: "#fff", correctLevel: QRCode.CorrectLevel.H });
  } else {
    qrCode.innerHTML = "<p style='color:#888;font-size:0.8rem'>QR library not loaded</p>";
  }
}

function closeQr() {
  qrOverlay.hidden = true;
  if (shareState && shareState.peer) {
    for (const c of shareState.conns.values()) c.close();
    shareState.peer.destroy();
  }
  shareState = null;
}

qrClose.addEventListener("click", closeQr);
qrCancel.addEventListener("click", closeQr);

// ---- Join (PeerJS client) ----

let currentSessionId = null;
let currentKey = null;

async function joinSession(sessionId, key, appId) {
  currentSessionId = sessionId;
  currentKey = key;
  const hostId = "pwarx-" + sessionId;
  setCookie("pwarx", "join=" + sessionId + "&key=" + key + (appId ? "&id=" + appId : ""), 1);
  progressOverlay.hidden = false;
  progressName.textContent = "Connecting…";
  progressBar.style.width = "0%";
  progressText.textContent = "";

  try {
    const clientId = hostId + "-" + generateId(8);
    const peer = await openPeer(clientId);
    const conn = peer.connect(hostId);

    await new Promise((res, rej) => {
      conn.on("open", res);
      conn.on("error", rej);
      setTimeout(() => rej(new Error("Connection timeout")), 15000);
    });

    progressName.textContent = "Receiving app…";

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
          progressBar.style.width = "0%";
          progressText.textContent = "0%";
        } else if (msg.kind === "file") {
          receivedFiles[msg.path] = { data: msg.data, mime: msg.mime };
          receivedCount++;
          receivedBytes += msg.data.length;
          const pct = totalBytes > 0
            ? Math.round((receivedBytes / totalBytes) * 100)
            : Math.round((receivedCount / expectedCount) * 100);
          progressBar.style.width = pct + "%";
          progressText.textContent = pct + "% (" + (totalBytes ? fmtSize(receivedBytes) + "/" + fmtSize(totalBytes) : receivedCount + "/" + expectedCount + " files") + ")";
          progressName.textContent = "Receiving: " + msg.path.split("/").pop();
          if (receivedCount >= expectedCount) {
            finishReceive(peer, conn, appMeta, receivedFiles);
          }
        }
      } catch (e) { console.error("msg parse error", e); }
    });

    conn.on("close", () => {
      if (receivedCount < expectedCount) {
        progressText.textContent = "Connection closed before transfer complete";
      }
    });

    conn.on("error", (err) => {
      progressText.textContent = "Error: " + err.message;
    });

  } catch (err) {
    progressText.textContent = "Failed: " + err.message;
    progressName.textContent = "";
    setTimeout(() => { progressOverlay.hidden = true; }, 3000);
  }
}

async function finishReceive(peer, conn, meta, files) {
  progressName.textContent = "Saving app…";
  const id = meta.name + "-v" + (meta.version || "0");
  const size = pkgSize(files);
  const app = { id, name: meta.name, version: meta.version || "0", size, entry: meta.entry, icon: meta.icon || "", files };
  await saveApp(app);
  conn.close();
  peer.destroy();
  progressBar.style.width = "100%";
  progressText.textContent = "App received!";
  await sleep(500);
  progressOverlay.hidden = true;
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

// ---- Debug console ----

const debugLog = document.getElementById("debug-log");
const debugBtn = document.getElementById("debug-btn");
let debugLines = [];

function debug() {
  const msg = Array.from(arguments).map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ");
  debugLines.push(new Date().toISOString().slice(11,19) + " " + msg);
  if (debugLines.length > 200) debugLines.shift();
  debugLog.textContent = debugLines.join("\n");
}
debug("pwarx ready", navigator.userAgent.slice(0,50));
if (window.navigator.standalone) debug("standalone mode");

if (debugBtn) {
  debugBtn.addEventListener("click", () => {
    const h = debugLog.hidden;
    debugLog.hidden = !h;
    debugBtn.textContent = h ? "X" : ">_";
  });
}

window.addEventListener("error", (e) => debug("[error]", e.message));
window.addEventListener("unhandledrejection", (e) => debug("[unhandled]", String(e.reason)));

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