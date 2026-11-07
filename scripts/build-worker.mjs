#!/usr/bin/env node
// Build src/worker.js from the template, UI, catalogue, and public install assets.
// This does not talk to Cloudflare and does not read or write KV.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFile(path.join(root, rel));

const icons = [
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "public/icons/icon-maskable-512.png",
  "public/icons/apple-touch-icon.png",
  "public/icons/favicon-32.png"
];
try {
  await Promise.all(icons.map((rel) => read(rel)));
} catch {
  const made = spawnSync("python3", ["scripts/make-icons.py"], { cwd: root, stdio: "inherit" });
  if (made.status !== 0) process.exit(made.status || 1);
}

const [template, html, catalogueRaw, sw, manifest, offline, ...iconBytes] = await Promise.all([
  read("src/worker.template.js").then((b) => b.toString("utf8")),
  read("src/ui.html").then((b) => b.toString("utf8")),
  read("src/catalogue.json").then((b) => b.toString("utf8")),
  read("src/sw.js").then((b) => b.toString("utf8")),
  read("src/manifest.webmanifest").then((b) => b.toString("utf8")),
  read("src/offline.html").then((b) => b.toString("utf8")),
  ...icons.map((rel) => read(rel))
]);

JSON.parse(catalogueRaw);
JSON.parse(manifest);
if (!html.includes("__DISPLAY_NAME__")) throw new Error("ui.html is missing __DISPLAY_NAME__");
if (!html.includes("Job interests") || !html.includes("onlyInterests")) throw new Error("ui.html is missing the interests section");
if (!template.includes('USER_FROM_SOURCE = "TRACKER_USER_PLACEHOLDER"')) throw new Error("username placeholder missing");
if (!template.includes('const PREF_KEY = "prefs:job-interests"')) throw new Error("preferences key missing");

const assets = {
  "/sw.js": { contentType: "text/javascript; charset=utf-8", cacheControl: "no-cache", body: sw },
  "/manifest.webmanifest": { contentType: "application/manifest+json; charset=utf-8", cacheControl: "public, max-age=300", body: manifest },
  "/offline.html": { contentType: "text/html; charset=utf-8", cacheControl: "public, max-age=300", body: offline }
};
icons.forEach((rel, i) => {
  const name = path.posix.basename(rel);
  assets["/icons/" + name] = {
    contentType: "image/png",
    cacheControl: "public, max-age=86400",
    base64: Buffer.from(iconBytes[i]).toString("base64")
  };
});

let output = template
  .replace("__HTML__", () => JSON.stringify(html))
  .replace("__CATALOGUE__", () => JSON.stringify(JSON.parse(catalogueRaw)))
  .replace("__PUBLIC_ASSETS__", () => JSON.stringify(assets));

for (const token of ["__HTML__", "__CATALOGUE__", "__PUBLIC_ASSETS__"]) {
  if (output.includes(token)) throw new Error("unreplaced " + token);
}
if (!output.includes("__DISPLAY_NAME__")) throw new Error("display-name token was removed at build time");
const forbidden = ["preview-fixture", "fixture-password", "BEGIN PRIVATE", "AKIA", "ghp_"];
for (const word of forbidden) {
  if (output.includes(word)) throw new Error("refusing to write worker.js because it contains " + word);
}

const outPath = path.join(root, "src/worker.js");
await writeFile(outPath, output);
const hash = createHash("sha256").update(output).digest("hex").slice(0, 16);
console.log(`wrote src/worker.js (${output.length} bytes, sha256 ${hash})`);
