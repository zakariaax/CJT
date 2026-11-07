# Deployment merge

This draft is built. It is not deployed. The parent deploy keeps the existing Worker, the existing KV namespace, and the existing job documents. Do not create a second Worker, a Pages project, or a new KV namespace for this change.

There is no `wrangler.jsonc` on purpose. A default Wrangler file can provision a new namespace or publish over the wrong script. Use the deploy path that already updates this Worker.

## Do not do these

- Do not run `build_data.py`. It expects private files that are not in this repo.
- Do not upload `test/fixtures/data.json`, `site/data.example.json`, or `site/files.example.json` to KV.
- Do not `wrangler kv key put` the `data` key, and do not delete keys.
- Do not put a password, API token, account id, or namespace id in the repo or in `src/worker.js`.
- Do not deploy while `TRACKER_USER` is unset and the source still says `TRACKER_USER_PLACEHOLDER`. Login will fail closed. That placeholder must not become the production username.

## Bindings to preserve

| Binding | Keep |
| --- | --- |
| `env.KV` | The same namespace the live tracker already uses. Name stays `KV`. |
| `env.TRACKER_PASSWORD` | The existing secret. Do not rotate it for this change and do not print it. |
| `env.TRACKER_USER` | New. Set it to the username that is hardcoded in the live script today. Plaintext var or secret both work. |
| `env.TRACKER_DISPLAY_NAME` | Optional. The header name. If omitted, the page shows `Private user`, which is the redacted archive label, not a guess at the real name. |

KV keys this code reads or writes:

| Key | Owner |
| --- | --- |
| `data` | Existing job JSON. This upgrade only reads it on `GET /api/data`. |
| `f:<32 hex chars>` | Existing files. Unchanged. |
| `prefs:job-interests` | New. Interests only. A normal data sync must not write or delete it. |

The data sync may replace `data` and add or replace `f:` objects. It must not list-and-delete the namespace, and it must not write `prefs:job-interests`.

## Build the module

From this repo, on a machine that will not commit the result if you substitute a real name:

```bash
node scripts/build-worker.mjs
```

That writes `src/worker.js`. The committed copy is already the output of that command. It embeds the page, the catalogue, the manifest, the service worker, the offline page, and the PNGs. No extra asset binding is required. The existing "one module plus KV" shape stays.

The built file still contains `USER_FROM_SOURCE = "TRACKER_USER_PLACEHOLDER"`. That string is rejected unless `TRACKER_USER` is a different non-empty value, or the constant in the **deploy copy only** is replaced with the real username. Either method works. Prefer `TRACKER_USER` so the source stays redacted.

`__DISPLAY_NAME__` is replaced on each request from `TRACKER_DISPLAY_NAME`. Replacing that token inside a private deploy copy also works. Do not commit the real name.

Confirm the bundle before upload:

```bash
grep -n "TRACKER_USER_PLACEHOLDER" src/worker.js | head
# The constant may appear. A real password must not.
grep -E "preview-fixture|fixture-password|AKIA|ghp_" src/worker.js && echo "STOP" || echo "no fixture secrets"
```

## Upload

Use the existing deploy tool that updates this Worker script. Point it at `src/worker.js`. Keep the current compatibility date and flags. This patch uses `fetch`, `Request`, `Response`, Web Crypto, and `KV.get` / `KV.put`. It does not need a new compatibility flag. Workers provide `crypto.subtle.timingSafeEqual`; the extra byte compare runs only where that method is missing (the Node test runner).

If the old tool only substitutes the HTML placeholder inside `worker.template.js`, do not use it unchanged. The template now also expects the catalogue and the public assets. `scripts/build-worker.mjs` does all three substitutions. Deploy the built `src/worker.js`.

Leave observability as it already is on the Worker. If a new Wrangler config is written later, logs and traces are set separately (`observability.enabled` does not turn traces on by itself):

```jsonc
{
  "observability": {
    "enabled": true,
    "logs": { "enabled": true, "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.01 }
  }
}
```

That snippet is not a deploy manifest. Do not add a KV binding block that omits the existing namespace id.

## Check the live Worker before changing the search routine

1. `GET /api/data` with the real Basic Auth user still returns the production job list. Counts on All, New jobs, and Applied should match that list the same way as before.
2. `GET /api/preferences` the first time returns `storage_state: "missing"`, `configured: false`, and `nocs: []`. That means not configured. It does not mean "search nothing" and it does not mean "search all eight".
3. Save one role in the Job interests section, reload, then open the site in a second browser profile. The same role is checked. Workers KV can take about a minute to show a new value in another location. The default read cache is 60 seconds and cannot be set below 30. The save response itself is the confirmed value.
4. Run the normal data sync once. `GET /api/preferences` still returns the same `nocs` and `updated_at`. `GET /api/data` shows the synced jobs.
5. Only after those checks, point the search routine at `GET /api/preferences`. The contract is in `PREFERENCES_API.md`. This repo does not change that routine and does not send applications.

## PWA

The manifest, icons, service worker, and offline page are public and contain no job data. The signed-in pages stay on Basic Auth with `Cache-Control: private, no-store`. Chrome shows an Install button only after it fires `beforeinstallprompt`. iPhone uses Share, then Add to Home Screen. There is no store listing. Logout returns 401, as before, and asks the service worker to drop its public cache. It does not unregister the icon.
