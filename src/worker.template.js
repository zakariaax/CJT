// Canada Job Tracker – single Cloudflare Worker.
// Generated from this template by scripts/build-worker.mjs, which fills the HTML, catalogue, and public-asset placeholders.
// TRACKER_USER_PLACEHOLDER is an archive redaction, not a production username. It never authenticates by itself.
// Password is env.TRACKER_PASSWORD only. Do not put a password in this file.
const HTML = __HTML__;
const CATALOGUE = __CATALOGUE__;
const PUBLIC_ASSETS = __PUBLIC_ASSETS__;
const USER_FROM_SOURCE = "TRACKER_USER_PLACEHOLDER";
const PREF_KEY = "prefs:job-interests";
const PREF_VERSION = 1;
const MAX_PREF_BODY = 4096;
const BASE = {"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY","Strict-Transport-Security":"max-age=31536000"};
const enc = new TextEncoder();

function resolveUser(env) {
  const fromEnv = env && typeof env.TRACKER_USER === "string" ? env.TRACKER_USER.trim() : "";
  if (fromEnv && fromEnv !== "TRACKER_USER_PLACEHOLDER") return fromEnv;
  if (USER_FROM_SOURCE && USER_FROM_SOURCE !== "TRACKER_USER_PLACEHOLDER") return USER_FROM_SOURCE;
  return "";
}
function displayName(env) {
  const raw = env && typeof env.TRACKER_DISPLAY_NAME === "string" ? env.TRACKER_DISPLAY_NAME.trim() : "";
  if (!raw || raw === "TRACKER_USER_PLACEHOLDER" || raw.includes("__")) return "Private user";
  return raw.slice(0, 80);
}
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function timingSafeEqualBytes(x, y) {
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(x, y);
  // Node's Web Crypto build used for tests does not implement subtle.timingSafeEqual. Workers do, and take the branch above.
  const left = new Uint8Array(x), right = new Uint8Array(y);
  let diff = left.length ^ right.length;
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
async function eq(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return timingSafeEqualBytes(x, y);
}
async function authed(req, env) {
  const user = resolveUser(env);
  if (!user || !env.TRACKER_PASSWORD) return false;
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let dec; try { dec = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0))); } catch { return false; }
  const i = dec.indexOf(":"); if (i < 0) return false;
  const u = await eq(dec.slice(0, i), user), p = await eq(dec.slice(i + 1), env.TRACKER_PASSWORD);
  return u && p;
}
const deny = () => new Response("Authentication required", {status: 401, headers: {...BASE, "WWW-Authenticate": 'Basic realm="Canada Job Tracker", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8"}});
const pageHeaders = {...BASE, "Content-Type":"text/html; charset=utf-8", "Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; worker-src 'self'; manifest-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};

function allowedNocs() {
  return CATALOGUE.roles.map((role) => role.noc);
}
function canonicalNocs(list) {
  const wanted = new Set(list);
  return allowedNocs().filter((noc) => wanted.has(noc));
}
function aliasesByNoc() {
  const out = {};
  for (const role of CATALOGUE.roles) {
    out[role.noc] = {
      official_title: role.official_title,
      display_title: role.display_title,
      also_called: role.also_called
    };
  }
  return out;
}
function matchGuidance() {
  return {
    match_on: "noc_2021_code",
    aliases_are: "hints_to_map_a_posting_onto_a_noc_when_the_posting_has_no_code",
    do_not: "Require an exact job-title match, or treat an alias or NOC hit as enough when the duties are excluded.",
    exclusions_always_apply: CATALOGUE.exclusions,
    when_not_configured: "Do not run a search. Do not substitute all eight NOCs or invent a selection.",
    when_unreadable: "Do not run a search. Do not treat the value as empty and do not treat it as all roles.",
    when_explicit_empty: "Search zero NOC groups. Do not fall back to all roles.",
    when_saved: "Search only the nocs array, then drop postings whose duties hit the exclusions.",
    historical_tracker_rows: "Existing saved jobs stay visible. Preferences do not hide them unless the person turns on the optional on-screen limit."
  };
}
function selectionMeaning(configured, nocs, storageState) {
  if (storageState === "unreadable") return "unreadable";
  if (!configured) return "not_configured";
  if (!nocs.length) return "explicit_empty";
  return "search_only_these_nocs";
}
function preferenceView(stored) {
  const configured = stored.storage_state === "saved";
  const nocs = configured ? stored.nocs : [];
  const meaning = selectionMeaning(configured, nocs, stored.storage_state);
  return {
    ok: stored.storage_state !== "unreadable",
    version: PREF_VERSION,
    key: PREF_KEY,
    storage_state: stored.storage_state,
    configured,
    nocs,
    updated_at: configured ? stored.updated_at : null,
    selection_meaning: meaning,
    empty_means: "no_searches",
    missing_means: "not_configured_do_not_search_and_do_not_assume_all",
    allowed_nocs: allowedNocs(),
    aliases_by_noc: aliasesByNoc(),
    match_guidance: matchGuidance(),
    catalogue: CATALOGUE,
    note: meaning === "not_configured"
      ? "Preferences have never been saved. This is not an empty selection. Do not search all NOCs and do not invent a selection."
      : meaning === "explicit_empty"
        ? "The user saved an empty selection. Future searches must search no NOC groups, not fall back to all."
        : meaning === "unreadable"
          ? "A preferences value exists but could not be read. This is not an empty selection and not a choice of all roles. Nothing was changed."
          : "Future searches must search only these NOC 2021 codes, then apply the exclusions. Match on the code. Aliases are hints when a posting has no code."
  };
}
function interpretStored(raw) {
  if (raw == null) return {storage_state: "missing"};
  let doc;
  try { doc = JSON.parse(raw); } catch { return {storage_state: "unreadable"}; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.version !== PREF_VERSION || doc.configured !== true || !Array.isArray(doc.nocs)) {
    return {storage_state: "unreadable"};
  }
  const allowed = new Set(allowedNocs());
  const seen = new Set();
  for (const noc of doc.nocs) {
    if (typeof noc !== "string" || !allowed.has(noc) || seen.has(noc)) return {storage_state: "unreadable"};
    seen.add(noc);
  }
  return {
    storage_state: "saved",
    nocs: canonicalNocs(doc.nocs),
    updated_at: typeof doc.updated_at === "string" ? doc.updated_at : null
  };
}
function json(body, status, extra) {
  return new Response(JSON.stringify(body), {status, headers: {...BASE, "Content-Type":"application/json; charset=utf-8", ...extra}});
}
function kvReady(env) {
  return !!(env && env.KV && typeof env.KV.get === "function" && typeof env.KV.put === "function");
}
function logEvent(level, fields) {
  const line = JSON.stringify(fields);
  if (level === "error") console.error(line);
  else console.log(line);
}
function readSiteBlock(req, url) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "cross_site";
  const origin = req.headers.get("origin");
  if (!origin) return "";
  if (origin === "null") return "opaque_origin";
  try {
    if (new URL(origin).origin !== url.origin) return "origin_mismatch";
  } catch { return "bad_origin"; }
  return "";
}
async function readLimited(req) {
  const declared = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_PREF_BODY) return {error: "too_large"};
  if (!req.body) return {text: ""};
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PREF_BODY) {
      try { await reader.cancel(); } catch { /* already over the cap */ }
      return {error: "too_large"};
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {text: new TextDecoder().decode(buf)};
}
function validatePreferenceBody(text) {
  let body;
  try { body = JSON.parse(text); } catch { return {error: "invalid_json", message: "The body is not JSON. Nothing was saved."}; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {error: "invalid_body", message: "Send a JSON object with a nocs array. Nothing was saved."};
  const keys = Object.keys(body);
  for (const key of keys) {
    if (key !== "nocs" && key !== "version") return {error: "unexpected_field", field: key, message: "Only nocs and version are accepted. Nothing was saved."};
  }
  if (Object.prototype.hasOwnProperty.call(body, "version") && body.version !== PREF_VERSION) {
    return {error: "unsupported_version", message: "Only preferences version 1 can be saved. Nothing was saved."};
  }
  if (!Object.prototype.hasOwnProperty.call(body, "nocs")) return {error: "nocs_required", message: "Include nocs. An empty array is a real empty selection. Omitting nocs saves nothing."};
  if (!Array.isArray(body.nocs)) return {error: "nocs_type", message: "nocs must be an array of NOC code strings. Nothing was saved."};
  if (body.nocs.length > 50) return {error: "too_many", message: "Too many NOC entries. Nothing was saved."};
  const allowed = new Set(allowedNocs());
  const rejected = [];
  const accepted = [];
  for (const item of body.nocs) {
    if (typeof item !== "string") {
      rejected.push(item);
      continue;
    }
    const noc = item.trim();
    if (!allowed.has(noc)) rejected.push(noc);
    else if (!accepted.includes(noc)) accepted.push(noc);
  }
  if (rejected.length) {
    return {error: "unknown_noc", rejected: rejected.map((item) => typeof item === "string" ? item : typeof item), message: "One or more NOC codes are not in the job-interests list, or a code was not a string. Nothing was saved.", allowed_nocs: allowedNocs()};
  }
  return {nocs: canonicalNocs(accepted)};
}
async function loadPreferences(env) {
  if (!kvReady(env)) return {error: "kv_unbound"};
  let raw;
  try { raw = await env.KV.get(PREF_KEY); }
  catch (err) {
    logEvent("error", {event: "preferences_read", result: "kv_error", name: err && err.name || "Error"});
    return {error: "kv_read_failed"};
  }
  return {stored: interpretStored(raw)};
}
async function handlePreferences(req, env, url) {
  if (req.method === "GET" || req.method === "HEAD") {
    const blocked = readSiteBlock(req, url);
    if (blocked) return json({ok: false, error: "cross_origin_blocked", reason: blocked, message: "This read was rejected because its origin is not the tracker."}, 403);
    const loaded = await loadPreferences(env);
    if (loaded.error === "kv_unbound") return json({ok: false, error: "kv_unbound", message: "The KV binding is missing. Nothing was read or invented."}, 503);
    if (loaded.error) return json({ok: false, error: loaded.error, message: "Saved interests could not be read. This is not an empty selection."}, 503);
    return json(preferenceView(loaded.stored), loaded.stored.storage_state === "unreadable" ? 200 : 200);
  }
  if (req.method !== "PUT") return json({ok: false, error: "method_not_allowed", message: "Use GET to read interests and PUT to replace them."}, 405, {"Allow": "GET, HEAD, PUT"});
  const blocked = readSiteBlock(req, url);
  if (blocked) return json({ok: false, error: "cross_origin_blocked", reason: blocked, message: "This write was rejected because its origin is not the tracker. Nothing was saved."}, 403);
  if ((req.headers.get("x-tracker-intent") || "") !== "save-job-interests") {
    return json({ok: false, error: "missing_intent", message: "PUT requires header X-Tracker-Intent: save-job-interests. Nothing was saved."}, 403);
  }
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return json({ok: false, error: "unsupported_media_type", message: "Content-Type must be application/json. Nothing was saved."}, 415);
  if (!kvReady(env)) return json({ok: false, error: "kv_unbound", message: "The KV binding is missing. Nothing was saved."}, 503);
  const incoming = await readLimited(req);
  if (incoming.error === "too_large") return json({ok: false, error: "too_large", message: "The preferences body is too large. Nothing was saved."}, 413);
  const parsed = validatePreferenceBody(incoming.text || "");
  if (parsed.error) return json({ok: false, ...parsed}, 400);
  const doc = {
    version: PREF_VERSION,
    configured: true,
    nocs: parsed.nocs,
    updated_at: new Date().toISOString(),
    selection_meaning: parsed.nocs.length ? "search_only_these_nocs" : "explicit_empty",
    empty_means: "no_searches"
  };
  try {
    await env.KV.put(PREF_KEY, JSON.stringify(doc), {metadata: {kind: "job-interests", version: PREF_VERSION}});
  } catch (err) {
    logEvent("error", {event: "preferences_write", result: "kv_error", name: err && err.name || "Error"});
    return json({ok: false, error: "kv_write_failed", message: "The server could not store interests. Nothing was confirmed saved. Your last stored selection, if any, is unchanged."}, 503);
  }
  logEvent("info", {event: "preferences_write", result: "saved", count: doc.nocs.length, storage_key: PREF_KEY});
  const view = preferenceView({storage_state: "saved", nocs: doc.nocs, updated_at: doc.updated_at});
  return json({...view, saved: true, message: doc.nocs.length ? "Saved. Future searches are instructed to use only these NOC codes." : "Saved an empty selection. Future searches are instructed to search no NOC groups."}, 200);
}
function publicAsset(pathname, method) {
  const asset = PUBLIC_ASSETS[pathname];
  if (!asset) return null;
  const headers = {
    "Content-Type": asset.contentType,
    "Cache-Control": asset.cacheControl,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  };
  let body = null;
  if (method !== "HEAD") {
    if (asset.base64) body = Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0));
    else body = asset.body;
  }
  return new Response(body, {status: 200, headers});
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const asset = publicAsset(url.pathname, req.method);
    if (asset) {
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", {status: 405, headers: {"Allow": "GET, HEAD", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
      return asset;
    }
    if (url.pathname === "/logout") return deny();
    if (!(await authed(req, env))) return deny();
    if (url.pathname === "/api/preferences") return handlePreferences(req, env, url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", {status: 405, headers: {...BASE, "Allow": "GET, HEAD"}});
    if (url.pathname === "/" || url.pathname === "/index.html")
      return new Response(HTML.replaceAll("__DISPLAY_NAME__", escHtml(displayName(env))), {headers: pageHeaders});
    if (url.pathname === "/api/data") {
      const d = await env.KV.get("data");
      return new Response(d || '{"meta":{},"jobs":[]}', {headers: {...BASE, "Content-Type": "application/json; charset=utf-8"}});
    }
    const m = url.pathname.match(/^\/file\/([a-f0-9]{32})(?:\/([^/]*))?$/);
    if (m) {
      const b = await env.KV.get("f:" + m[1], "arrayBuffer");
      if (!b) return new Response("Not found", {status: 404, headers: BASE});
      let name = "document.pdf"; try { if (m[2]) name = decodeURIComponent(m[2]); } catch {}
      name = name.replace(/[^\w.\-]/g, "_");
      return new Response(b, {headers: {...BASE, "Content-Type": "application/pdf", "Content-Disposition": (url.searchParams.has("dl") ? "attachment" : "inline") + '; filename="' + name + '"'}});
    }
    return new Response("Not found", {status: 404, headers: BASE});
  }
};
