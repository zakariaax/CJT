import worker from "../src/worker.js";

export const USER = "fixture-user";
export const PASS = "fixture-password";
export const ORIGIN = "https://tracker.test";

export function createKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    failPut: false,
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
    async put(key, value) {
      if (this.failPut) {
        const err = new Error("forced kv failure");
        err.name = "KVError";
        throw err;
      }
      store.set(key, typeof value === "string" ? value : value);
    }
  };
}

export function testEnv(kv, extra = {}) {
  return { KV: kv, TRACKER_USER: USER, TRACKER_PASSWORD: PASS, ...extra };
}

export function basic(user, pass) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export async function call(env, path, { method = "GET", user = USER, pass = PASS, headers = {}, body, auth = true } = {}) {
  const h = new Headers(headers);
  if (auth) h.set("authorization", basic(user, pass));
  let payload;
  if (body !== undefined) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  const req = new Request(ORIGIN + path, { method, headers: h, body: payload });
  return worker.fetch(req, env, { waitUntil() {} });
}

export async function readJson(res) {
  return JSON.parse(await res.text());
}
