# Test report

Date: 2026-11-07. The Worker was built and tested locally. It was not deployed. Production KV was not opened or written.

## Commands

`node scripts/build-worker.mjs` wrote `src/worker.js` (104995 bytes).

`node --test test/worker.test.mjs` — 8 tests, 8 passed.

`TRACKER_USER=preview TRACKER_PASSWORD=preview-fixture node scripts/browser-check.mjs` against http://127.0.0.1:41773/ — passed. Chrome drove the real Basic Auth challenge against the in-memory preview. The fixture is `test/fixtures/data.json` (6 synthetic jobs, 2 sent).

## Worker results

- Unauthenticated `/`, `/api/data`, `/api/preferences`, and `/file/...` return 401 `Authentication required` with the existing Basic challenge and `Cache-Control: private, no-store`.
- `TRACKER_USER_PLACEHOLDER` does not authenticate, including when it is copied into `TRACKER_USER`. A different `TRACKER_USER` plus `TRACKER_PASSWORD` does. A wrong password does not.
- `GET /api/data` returns the stored document unchanged. `HEAD` is 200. `POST` is 405. File bytes under `f:<hash>` still download as PDF.
- The page still computes All and New jobs from `D.length` and Applied from the sent count. On the fixture those are 6, 6, and 2. The optional interests checkbox is off in the HTML.
- Missing key `prefs:job-interests`: `configured: false`, `selection_meaning: "not_configured"`. The key is not created by a read.
- PUT `{nocs:["75101","62010","62010"]}` stores `["62010","75101"]` with `selection_meaning: "search_only_these_nocs"`. A second GET, including another User-Agent, returns the same codes and timestamp. That timestamp is not baked into `src/worker.js`.
- PUT `{nocs:[]}` is `explicit_empty`, distinct from missing. Replacing the `data` key afterward leaves the preferences value in place, and `GET /api/data` returns the replacement.
- Unknown code `95106`, a numeric code, an extra field, `version: 2`, a missing `nocs` array, a non-JSON body, and a body over 4096 bytes do not change the stored value.
- Cross-origin PUT, `Origin: null`, a same-origin PUT without `X-Tracker-Intent`, and a cross-site GET are rejected. `OPTIONS` is 405 and sends no `Access-Control-Allow-Origin`.
- An unauthenticated read after a save is still only `Authentication required`.
- An unreadable stored value stays `unreadable` and is not treated as empty. A KV put failure returns 503 and leaves the old value.
- Manifest `id`, `scope`, and `start_url` are `/`, `display` is `standalone`, and there is no related application. Icons are real PNGs at 192, 512, maskable 512, apple 180, and favicon 32, matching the files in `public/icons/`.
- The service worker precaches only those public files. Runtime checks reject caching `/api/`, `/file/`, `/`, and `/logout`. A failed navigation returns the offline page. Logout and `LOGOUT_CLEAR` delete the cache. Google font requests are not intercepted.

Node does not implement `crypto.subtle.timingSafeEqual`. The Worker uses it when the runtime provides it, and a same-length byte compare otherwise. Cloudflare Workers provide the SubtleCrypto method, so production takes that branch. No compatibility date was added. The source archive had none.

## Browser results

- Desktop: tabs read All 6, New jobs 6, Applied 2, and Job interests with no number before the first save. The bakery fixture row stays in the list. Six of six jobs show. The install button is absent until a `beforeinstallprompt` event is dispatched; dismissing it leaves the button. iPhone Safari text says Share, then Add to Home Screen, and that there is no App Store app.
- Checking NOC 13100 and 22221 shows "2 of 8 selected · unsaved changes". Save, reload, and the same two boxes are checked. Tab badges stay All 6, New jobs 6, Applied 2, and Job interests 2.
- The optional limit does nothing until a selection is saved. After the save it shows 2 of 6 and hides the bakery row. Unchecking it shows every job again.
- Saving with nothing checked shows the explicit-empty message. The mobile catalogue screenshot is that state: "0 of 8 selected" and "Saved empty selection".
- No page errors.

Screenshots:

- `artifacts/desktop-all-jobs.png`
- `artifacts/desktop-interests-unsaved.png`
- `artifacts/desktop-interests-saved.png`
- `artifacts/mobile-all-jobs.png`
- `artifacts/mobile-job-cards.png`
- `artifacts/mobile-job-interests.png`

Copies of the same files are under `/opt/cursor/artifacts/`.

## Not done

The live Worker at `https://canada-job-tracker.tiny-mouse-bea5.workers.dev` was not modified. The search routine was not changed. No production username, password, or job export was used.
