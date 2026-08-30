#!/usr/bin/env node
// package-wasm-pkg.js <src-dir> — Create a .wasm-pkg from a directory tree
const fs = require("fs");
const path = require("path");

const src = path.resolve(process.argv[2] || ".");
const outDir = path.resolve(process.argv[3] || ".");
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.webmanifest"), "utf8"));
const name = manifest.name;
const entry = "index.html";
const icon = (manifest.icons && manifest.icons[0]) ? manifest.icons[0].src.replace(/^\.\//, "") : "";
const version = fs.readFileSync(path.join(src, "PORT_VERSION"), "utf8").trim();

const mimeMap = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".wasm": "application/wasm", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2",
  ".ts": "video/mp2t", ".m2ts": "video/mp2t",
  ".pdi": "application/octet-stream", ".pda": "application/octet-stream",
  ".bin": "application/octet-stream",
};

const files = {};
for (const f of fs.readdirSync(src, { recursive: true }).filter(f => fs.statSync(path.join(src, f)).isFile()).sort()) {
  const full = path.join(src, f);
  const ext = path.extname(f).toLowerCase();
  const mime = mimeMap[ext] || "application/octet-stream";
  files[f] = { data: fs.readFileSync(full).toString("base64"), mime };
}

const pkg = { packageFormat: 1, name, version, entry, icon, files };
const out = path.resolve(outDir, name + "-v" + version + ".wasm-pkg");
fs.writeFileSync(out, JSON.stringify(pkg));
console.log(`Wrote ${out} (${Object.keys(files).length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);