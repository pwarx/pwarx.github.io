#!/usr/bin/env node
// unpack-wasm-pkg.js – Extract a .wasm-pkg file into a directory tree
const fs = require("fs");
const path = require("path");

const pkgFile = process.argv[2];
if (!pkgFile) {
  console.error("Usage: node unpack-wasm-pkg.js <file.wasm-pkg> [out-dir]");
  process.exit(1);
}

const outDir = process.argv[3] || path.basename(pkgFile, ".wasm-pkg");
const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));

for (const [rel, info] of Object.entries(pkg.files)) {
  const dest = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(info.data, "base64"));
}

const count = Object.keys(pkg.files).length;
console.log(`Extracted ${count} files to ${outDir}/`);