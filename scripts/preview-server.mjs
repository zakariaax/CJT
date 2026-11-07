#!/usr/bin/env node
// Local preview only. Uses an in-memory KV and the synthetic fixture. Never writes production data.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 41773);
const host = process.env.HOST || "0.0.0.0";
const user = process.env.TRACKER_USER || "preview";
const password = process.env.TRACKER_PASSWORD || randomBytes(9).toString("hex");

function createKv() {
  const store = new Map();
  return {
    async get(key, type) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      if (type === "arrayBuffer") {
        if (value instanceof ArrayBuffer) return value;
        if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        return new TextEncoder().encode(String(value)).buffer;
      }
      return value;
    },
    async put(key, value) { store.set(key, value); }
  };
}

const kv = createKv();
const fixture = JSON.parse(await readFile(path.join(root, "test/fixtures/data.json"), "utf8"));
if (!fixture.meta || fixture.meta.synthetic !== true) {
  console.error("Refusing to preview: test/fixtures/data.json is not marked synthetic.");
  process.exit(1);
}
await kv.put("data", JSON.stringify(fixture));
const env = {
  KV: kv,
  TRACKER_USER: user,
  TRACKER_PASSWORD: password,
  TRACKER_DISPLAY_NAME: process.env.TRACKER_DISPLAY_NAME || ""
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host || host + ":" + port}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
      else if (value != null) headers.set(key, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const body = hasBody ? await readBody(req) : undefined;
    const response = await worker.fetch(new Request(url, { method: req.method, headers, body }), env, { waitUntil() {} });
    const out = Buffer.from(await response.arrayBuffer());
    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    res.writeHead(response.status, responseHeaders);
    if (req.method === "HEAD") res.end();
    else res.end(out);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Preview error");
    console.error(JSON.stringify({ event: "preview_error", name: err && err.name }));
  }
});

server.listen(port, host, () => {
  console.log(`Canada Job Tracker preview: http://127.0.0.1:${port}/`);
  console.log("Local fixture auth only. This process is not production and its KV is memory.");
  console.log(`TRACKER_USER=${user}`);
  if (!process.env.TRACKER_PASSWORD) console.log(`TRACKER_PASSWORD=${password}`);
});
