import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { call, createKv, readJson, testEnv, USER, PASS, ORIGIN } from "./helpers.mjs";
import fixture from "./fixtures/data.json" with { type: "json" };

const DATA = JSON.stringify(fixture);
const PREF = "prefs:job-interests";
const browser = {
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
  "x-tracker-intent": "save-job-interests"
};

function pngSize(bytes) {
  const b = Buffer.from(bytes);
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function seeded() {
  const kv = createKv({ data: DATA });
  return { kv, env: testEnv(kv) };
}

test("existing routes keep auth, methods, and the stored job document", async () => {
  const { kv, env } = await seeded();
  for (const path of ["/", "/index.html", "/api/data", "/api/preferences", "/file/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cv.pdf"]) {
    const res = await call(env, path, { auth: false });
    assert.equal(res.status, 401);
    assert.equal(await res.text(), "Authentication required");
    assert.match(res.headers.get("www-authenticate"), /Basic realm="Canada Job Tracker"/);
    assert.match(res.headers.get("cache-control"), /no-store/);
  }
  const logout = await call(env, "/logout");
  assert.equal(logout.status, 401);

  const data = await call(env, "/api/data");
  assert.equal(data.status, 200);
  assert.equal(await data.text(), DATA);
  const head = await call(env, "/api/data", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await call(env, "/api/data", { method: "POST" }).then((r) => r.status), 405);
  assert.equal(await call(env, "/nope").then((r) => r.status), 404);

  const hash = "ab".repeat(16);
  const bytes = new TextEncoder().encode("%PDF-1.4 synthetic fixture");
  await kv.put("f:" + hash, bytes);
  const file = await call(env, `/file/${hash}/My%20CV.pdf?dl=1`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "application/pdf");
  assert.match(file.headers.get("content-disposition"), /attachment/);
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "%PDF-1.4 synthetic fixture");
  assert.equal(await call(env, "/file/" + hash + "/missing-name").then((r) => r.status), 200);
  assert.equal(await call(env, "/file/" + "c".repeat(32)).then((r) => r.status), 404);

  const jobs = JSON.parse(DATA).jobs;
  const sent = jobs.filter((job) => job.status === "sent");
  assert.equal(jobs.length, 6);
  assert.equal(sent.length, 2);
  const pageRes = await call(env, "/");
  const page = await pageRes.text();
  assert.match(page, /\['all','All',String\(D\.length\)\],\['new','New jobs',String\(D\.length\)\],\['applied','Applied',String\(sent\)\]/);
  assert.match(page, /id="onlyInterests"/);
  assert.doesNotMatch(page, /id="onlyInterests" checked/);
  assert.match(page, /Job interests/);
  assert.doesNotMatch(page, /localStorage|indexedDB|sessionStorage/);
  assert.doesNotMatch(page, /Example North Office/);
  assert.match(page, /Private user/);
  assert.match(pageRes.headers.get("content-security-policy"), /worker-src 'self'/);
});

test("placeholder username cannot authenticate; env username can", async () => {
  const kv = createKv({ data: DATA });
  const noUser = { KV: kv, TRACKER_PASSWORD: PASS };
  assert.equal((await call(noUser, "/api/data", { user: "TRACKER_USER_PLACEHOLDER", pass: PASS })).status, 401);
  assert.equal((await call({ ...noUser, TRACKER_USER: "TRACKER_USER_PLACEHOLDER" }, "/api/data")).status, 401);
  assert.equal((await call(testEnv(kv), "/api/data", { user: USER, pass: "wrong" })).status, 401);
  assert.equal((await call(testEnv(kv), "/api/data")).status, 200);
  const named = await call(testEnv(kv, { TRACKER_DISPLAY_NAME: "<Ada>" }), "/");
  const html = await named.text();
  assert.match(html, /&lt;Ada&gt;/);
  assert.doesNotMatch(html, /__DISPLAY_NAME__/);
  assert.match(named.headers.get("content-security-policy"), /worker-src 'self'/);
});

test("missing preferences are not an empty selection", async () => {
  const { kv, env } = await seeded();
  const res = await call(env, "/api/preferences");
  const body = await readJson(res);
  assert.equal(res.status, 200);
  assert.equal(body.configured, false);
  assert.equal(body.storage_state, "missing");
  assert.equal(body.selection_meaning, "not_configured");
  assert.deepEqual(body.nocs, []);
  assert.equal(body.empty_means, "no_searches");
  assert.equal(body.missing_means, "not_configured_do_not_search_and_do_not_assume_all");
  assert.equal(body.nocs.length, 0);
  assert.equal(kv.store.has(PREF), false);
  assert.deepEqual(body.allowed_nocs, ["13100", "13110", "22221", "22220", "62010", "14400", "75101", "65102", "21234", "21232", "22222", "21233", "21223", "14111", "14100", "64409"]);
  assert.equal(body.aliases_by_noc["75101"].official_title, "Material handlers");
  assert.equal(body.aliases_by_noc["65102"].official_title, "Store shelf stockers, clerks and order fillers");
  assert.match(body.match_guidance.when_not_configured, /Do not run a search/);
  assert.match(body.match_guidance.when_explicit_empty, /zero NOC/);
  assert.equal(body.catalogue.roles.length, 16);
  assert.equal(body.aliases_by_noc["22221"].official_title, "User support technicians");
  assert.ok(body.aliases_by_noc["22221"].also_called.includes("Email support technician"));
  assert.equal(body.catalogue.roles.find((role) => role.noc === "21234").fit_tier, "portfolio or further training");
  assert.equal(body.catalogue.roles.filter((role) => role.fit_tier).every((role) => role.noc !== "62010"), true);
});

test("an existing saved selection is not rewritten when the catalogue grows", async () => {
  const stored = JSON.stringify({
    version: 1,
    configured: true,
    nocs: ["13100", "22221"],
    updated_at: "2026-11-07T12:00:00.000Z",
    selection_meaning: "search_only_these_nocs",
    empty_means: "no_searches"
  });
  const kv = createKv({ data: DATA, [PREF]: stored });
  const body = await readJson(await call(testEnv(kv), "/api/preferences"));
  assert.deepEqual(body.nocs, ["13100", "22221"]);
  assert.equal(body.updated_at, "2026-11-07T12:00:00.000Z");
  assert.equal(body.configured, true);
  assert.equal(kv.store.get(PREF), stored);
  assert.equal(kv.store.get("data"), DATA);
});

test("new catalogue codes can be saved without becoming the default", async () => {
  const { kv, env } = await seeded();
  const before = await readJson(await call(env, "/api/preferences"));
  assert.equal(before.configured, false);
  const saved = await readJson(await call(env, "/api/preferences", {
    method: "PUT",
    headers: browser,
    body: { nocs: ["14111", "21234"] }
  }));
  assert.deepEqual(saved.nocs, ["21234", "14111"]);
  assert.equal(saved.selection_meaning, "search_only_these_nocs");
  assert.equal(saved.nocs.includes("64409"), false);
  const again = await readJson(await call(env, "/api/preferences"));
  assert.deepEqual(again.nocs, ["21234", "14111"]);
  assert.equal(kv.store.get("data"), DATA);
});

test("save, reload, other device, empty selection, and data sync", async () => {
  const { kv, env } = await seeded();
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    const saved = await call(env, "/api/preferences", {
      method: "PUT",
      headers: browser,
      body: { nocs: ["75101", "62010", "62010"] }
    });
    const savedBody = await readJson(saved);
    assert.equal(saved.status, 200);
    assert.equal(savedBody.saved, true);
    assert.equal(savedBody.configured, true);
    assert.deepEqual(savedBody.nocs, ["62010", "75101"]);
    assert.equal(savedBody.selection_meaning, "search_only_these_nocs");
    assert.equal(logs.some((line) => line.includes("75101")), false);

    const again = await readJson(await call(env, "/api/preferences", { headers: { "user-agent": "OtherDevice" } }));
    assert.deepEqual(again.nocs, ["62010", "75101"]);
    assert.equal(again.updated_at, savedBody.updated_at);
    assert.equal(again.configured, true);
    const workerSource = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
    assert.equal(workerSource.includes(savedBody.updated_at), false);

    const synced = JSON.stringify({ meta: { synthetic: true, count: 1 }, jobs: [{ job_id: "sync", status: "sent", title: "still synthetic" }] });
    await kv.put("data", synced);
    assert.equal(await (await call(env, "/api/data")).text(), synced);
    const afterSync = await readJson(await call(env, "/api/preferences"));
    assert.deepEqual(afterSync.nocs, ["62010", "75101"]);
    assert.equal(kv.store.get(PREF).includes("75101"), true);

    const empty = await readJson(await call(env, "/api/preferences", {
      method: "PUT",
      headers: { "x-tracker-intent": "save-job-interests" },
      body: { version: 1, nocs: [] }
    }));
    assert.equal(empty.configured, true);
    assert.equal(empty.selection_meaning, "explicit_empty");
    assert.deepEqual(empty.nocs, []);
    assert.match(empty.message, /no NOC groups/);
    const reread = await readJson(await call(env, "/api/preferences"));
    assert.equal(reread.selection_meaning, "explicit_empty");
    assert.notEqual(reread.selection_meaning, "not_configured");
    assert.equal(await (await call(env, "/api/data")).text(), synced);
  } finally {
    console.log = original;
  }
});

test("rejects unknown codes, bad bodies, cross-origin writes, and unauthenticated reads", async () => {
  const { kv, env } = await seeded();
  await call(env, "/api/preferences", { method: "PUT", headers: browser, body: { nocs: ["13100"] } });
  const before = kv.store.get(PREF);

  const unknown = await call(env, "/api/preferences", { method: "PUT", headers: browser, body: { nocs: ["95106", 13100] } });
  const unknownBody = await readJson(unknown);
  assert.equal(unknown.status, 400);
  assert.equal(unknownBody.error, "unknown_noc");
  assert.equal(kv.store.get(PREF), before);

  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: browser, body: { nocs: ["13100"], search_all: true } })).status, 400);
  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: browser, body: { version: 2, nocs: ["13100"] } })).status, 400);
  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: browser, body: {} })).status, 400);
  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: { ...browser, "content-type": "text/plain" }, body: "{\"nocs\":[]}" })).status, 415);
  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: browser, body: "" })).status, 400);
  const huge = await call(env, "/api/preferences", { method: "PUT", headers: browser, body: { nocs: ["13100"], pad: "x".repeat(5000) } });
  assert.equal(huge.status, 413);
  assert.equal(kv.store.get(PREF), before);

  const cross = await call(env, "/api/preferences", {
    method: "PUT",
    headers: { ...browser, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    body: { nocs: [] }
  });
  assert.equal(cross.status, 403);
  assert.equal((await readJson(cross)).error, "cross_origin_blocked");
  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: { ...browser, origin: "null" }, body: { nocs: [] } })).status, 403);
  assert.equal((await call(env, "/api/preferences", { method: "PUT", headers: { origin: ORIGIN, "sec-fetch-site": "same-origin" }, body: { nocs: ["13100"] } })).status, 403);
  assert.equal((await call(env, "/api/preferences", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status, 403);
  const options = await call(env, "/api/preferences", { method: "OPTIONS" });
  assert.equal(options.status, 405);
  assert.equal(options.headers.get("access-control-allow-origin"), null);

  const hidden = await call(env, "/api/preferences", { auth: false });
  const hiddenText = await hidden.text();
  assert.equal(hidden.status, 401);
  assert.equal(hiddenText, "Authentication required");
  assert.equal(hiddenText.includes("13100"), false);
  assert.equal(kv.store.get(PREF), before);
  assert.equal(kv.store.get("data"), DATA);
});

test("unreadable preferences are distinct and a failed write does not clear them", async () => {
  const kv = createKv({ data: DATA, [PREF]: "{not json" });
  const env = testEnv(kv);
  const broken = await readJson(await call(env, "/api/preferences"));
  assert.equal(broken.ok, false);
  assert.equal(broken.storage_state, "unreadable");
  assert.equal(broken.configured, false);
  assert.equal(broken.selection_meaning, "unreadable");
  kv.failPut = true;
  const failed = await call(env, "/api/preferences", { method: "PUT", headers: browser, body: { nocs: ["13110"] } });
  assert.equal(failed.status, 503);
  assert.equal(kv.store.get(PREF), "{not json");
  const unbound = await call({ TRACKER_USER: USER, TRACKER_PASSWORD: PASS }, "/api/preferences");
  assert.equal(unbound.status, 503);
});

test("public PWA assets are installable and carry no private data", async () => {
  const { env } = await seeded();
  const manifestRes = await call(env, "/manifest.webmanifest", { auth: false });
  assert.equal(manifestRes.status, 200);
  assert.match(manifestRes.headers.get("content-type"), /manifest/);
  const manifest = await readJson(manifestRes);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.prefer_related_applications, false);
  assert.equal(manifest.related_applications, undefined);
  for (const origin of ["https://canada-job-tracker.example", "https://tracker.test"]) {
    const manifestUrl = new URL("/manifest.webmanifest", origin);
    const scope = new URL(manifest.scope, manifestUrl);
    const start = new URL(manifest.start_url, manifestUrl);
    const id = new URL(manifest.id, manifestUrl);
    assert.equal(scope.origin, origin);
    assert.equal(start.origin, origin);
    assert.equal(id.origin, origin);
    assert.ok(start.href.startsWith(scope.href));
  }
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512", "512x512"]);
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  const fileManifest = JSON.parse(await readFile(new URL("../src/manifest.webmanifest", import.meta.url), "utf8"));
  assert.deepEqual(manifest, fileManifest);

  const sw = await call(env, "/sw.js", { auth: false });
  const swText = await sw.text();
  assert.equal(swText, await readFile(new URL("../src/sw.js", import.meta.url), "utf8"));
  assert.match(sw.headers.get("cache-control"), /no-cache/);
  assert.match(swText, /NEVER_CACHE_PREFIXES = \["\/api\/", "\/file\/", "\/logout"\]/);
  assert.doesNotMatch(swText, /\/api\/data|\/api\/preferences/);

  const expected = {
    "/icons/icon-192.png": [192, 192],
    "/icons/icon-512.png": [512, 512],
    "/icons/icon-maskable-512.png": [512, 512],
    "/icons/apple-touch-icon.png": [180, 180],
    "/icons/favicon-32.png": [32, 32]
  };
  for (const [path, [width, height]] of Object.entries(expected)) {
    const res = await call(env, path, { auth: false });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(pngSize(bytes), { width, height });
    const disk = await readFile(new URL("../public" + path, import.meta.url));
    assert.equal(bytes.equals(disk), true);
    assert.equal(bytes.includes(Buffer.from("Example North")), false);
  }
  const offline = await (await call(env, "/offline.html", { auth: false })).text();
  assert.match(offline, /not stored on this device/);
  assert.doesNotMatch(offline, /Example North|fixture-password|13100/);
  assert.equal((await call(env, "/manifest.webmanifest", { method: "POST", auth: false })).status, 405);
});

test("service worker caches only public assets and clears them on logout", async () => {
  const code = await readFile(new URL("../src/sw.js", import.meta.url), "utf8");
  const stores = new Map();
  const fetched = [];
  function bucket(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }
  const caches = {
    async open(name) {
      const map = bucket(name);
      return {
        async addAll(urls) {
          for (const url of urls) await this.put(url, await fetch(url));
        },
        async put(key, response) {
          const path = typeof key === "string" ? key : new URL(key.url).pathname;
          if (path.startsWith("/api/") || path.startsWith("/file/") || path === "/" || path === "/logout") {
            throw new Error("private response cached: " + path);
          }
          map.set(path, response);
        },
        async match(key) {
          const path = typeof key === "string" ? key : new URL(key.url).pathname;
          return map.get(path) || null;
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const responses = new Map();
  async function fetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url, "https://tracker.test");
    fetched.push(url.pathname);
    if (responses.has(url.pathname)) return responses.get(url.pathname)();
    if (url.pathname === "/api/data") return new Response('{"jobs":[{"company":"Example North Office Ltd"}]}', { headers: { "Cache-Control": "private, no-store" } });
    if (url.pathname === "/logout") return new Response("Authentication required", { status: 401 });
    if (url.pathname === "/") return new Response("private page", { status: 401, headers: { "WWW-Authenticate": "Basic" } });
    return new Response("public " + url.pathname, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  const self = {
    location: { origin: "https://tracker.test" },
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    skipWaiting() {},
    clients: { claim: async () => {} }
  };
  const factory = new Function("self", "caches", "fetch", "Response", "URL", "console", `${code}\nreturn self;`);
  const scope = factory(self, caches, fetch, Response, URL, console);
  const installWaits = [];
  scope.listeners.install({ waitUntil(p) { installWaits.push(p); } });
  await Promise.all(installWaits);
  assert.ok(fetched.includes("/offline.html"));
  assert.equal(fetched.includes("/api/data"), false);
  assert.equal(fetched.includes("/sw.js"), false);

  async function handle(request) {
    let promise;
    let responded = false;
    scope.listeners.fetch({
      request,
      respondWith(value) { responded = true; promise = value; }
    });
    if (!responded) return { responded: false };
    return { responded: true, response: await promise };
  }

  const api = await handle(new Request("https://tracker.test/api/data"));
  assert.equal(await api.response.text(), '{"jobs":[{"company":"Example North Office Ltd"}]}');
  const file = await handle(new Request("https://tracker.test/file/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cv.pdf"));
  assert.equal(file.responded, true);
  assert.equal([...stores.get("cjt-public-v1").keys()].some((key) => key.startsWith("/api") || key.startsWith("/file")), false);

  responses.set("/", () => { throw new Error("offline"); });
  const nav = await scope.handleFetch({
    url: "https://tracker.test/",
    method: "GET",
    mode: "navigate",
    headers: { get() { return null; } }
  });
  assert.match(await nav.text(), /public \/offline.html|not stored on this device/);
  const font = await handle(new Request("https://fonts.googleapis.com/css?family=Inter"));
  assert.equal(font.responded, false);

  const messageWaits = [];
  scope.listeners.message({ data: { type: "LOGOUT_CLEAR" }, waitUntil(p) { messageWaits.push(p); } });
  await Promise.all(messageWaits);
  assert.equal(stores.size, 0);
  stores.set("leftover", new Map([["/api/data", "must not survive logout"]]));
  const logoutWaits = [];
  scope.listeners.fetch({
    request: new Request("https://tracker.test/logout"),
    respondWith(p) { logoutWaits.push(p); }
  });
  assert.equal((await logoutWaits[0]).status, 401);
  assert.equal(stores.size, 0);
});
