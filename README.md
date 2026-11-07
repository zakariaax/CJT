# Canada Job Tracker

Private browser app for the existing Canada job tracker. This repository is a code draft of that Worker. It does not collect jobs, and it is not a new Job Bank crawler.

The live tracker stays where it is until the parent deploy step. Nothing in this repo deploys, and nothing here writes production data.

## What changed

- **Job interests**, a fourth section beside All, New jobs, and Applied. Eight NOC 2021 roles, each with the official title, plain-language aliases, a duty summary, employment requirements, and links to optional online courses.
- **Saved interests** on `GET` and `PUT /api/preferences`. The value lives in the existing `KV` binding under `prefs:job-interests`, separate from `data` and `f:<hash>`.
- **Installable PWA** with a manifest, icons, and a service worker that caches only public install files. Job JSON, preferences, PDFs, and the signed-in page are not cached.

All, New jobs, and Applied still count the same way: every stored job, every stored job, and sent jobs. Interests do not hide those rows unless the optional checkbox is turned on.

## Run the preview

The preview uses `test/fixtures/data.json`. That file is marked synthetic. It is not production history.

```bash
npm run build
TRACKER_USER=preview TRACKER_PASSWORD=preview-fixture npm run preview
```

Open http://127.0.0.1:41773/ and sign in with those two values. They exist only for this local process. The preview keeps KV in memory, so a restart forgets saved interests. Production KV is never contacted.

```bash
npm test
```

`npm test` rebuilds `src/worker.js` and runs the Worker tests in Node. `node scripts/browser-check.mjs` drives the preview in Chrome. Set `PREVIEW_URL` if the port differs.

## Layout

| Path | Role |
| --- | --- |
| `src/worker.template.js` | Worker source with placeholders |
| `src/ui.html` | Tracker page. `__DISPLAY_NAME__` is filled per request |
| `src/catalogue.json` | The eight roles and course links |
| `src/sw.js`, `src/manifest.webmanifest`, `src/offline.html`, `public/icons/` | Public install files, also embedded into the built Worker |
| `src/worker.js` | Built module. No password. Username constant is still the archive placeholder |
| `scripts/build-worker.mjs` | Regenerates `src/worker.js` |
| `build_data.py` | Original local data-shape reference. Do not run it here |
| `DEPLOYMENT.md` | How to merge this onto the existing Worker without replacing production auth or job data |
| `PREFERENCES_API.md` | Response shape for a future search routine |

## Auth

Basic Auth is unchanged. The password is the existing secret `TRACKER_PASSWORD`. The archive username `TRACKER_USER_PLACEHOLDER` is not a login. Set `TRACKER_USER` on the Worker to the real username before a deploy, or replace that constant only in the private deploy copy. See `DEPLOYMENT.md`.

An installed icon still uses the browser's Basic Auth prompt. It is not an APK or an App Store app, and it does not keep applications on the device.
