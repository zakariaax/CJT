# Preferences API

Authenticated JSON for the Job interests selection. The human saves it in the tracker. A future search routine **reads** it. This repo does not run that routine.

Base URL is the existing Worker origin. Every route below requires the same HTTP Basic Auth as the rest of the tracker. There is no CORS header. A browser on another site cannot read the body.

Storage key: `prefs:job-interests` in the `KV` binding. It is not inside the `data` document.

## GET /api/preferences

`GET` and `HEAD`. No extra header.

The routine must branch on `storage_state` and `selection_meaning`. `nocs: []` is not enough, because both "never saved" and "saved empty" use an empty array.

### Not configured

`storage_state` is `missing`. `configured` is false. `selection_meaning` is `not_configured`.

Do not search. Do not fill in all sixteen NOCs. Do not copy the person's past applications into this list.

### Saved empty

`storage_state` is `saved`. `configured` is true. `selection_meaning` is `explicit_empty`. `nocs` is `[]`.

Search zero NOC groups. Do not fall back to every role.

### Saved codes

`storage_state` is `saved`. `configured` is true. `selection_meaning` is `search_only_these_nocs`. `nocs` is a subset of the allowed list, in catalogue order.

Search only those NOC 2021 codes. Then drop postings whose duties are in `match_guidance.exclusions_always_apply`, even when the code matches. The allowed codes are:

`13100`, `13110`, `22221`, `22220`, `62010`, `14400`, `75101`, `65102`, `21234`, `21232`, `22222`, `21233`, `21223`, `14111`, `14100`, `64409`.

Adding a code to this list does not change a stored document. A GET leaves `nocs` and `updated_at` as they were saved. New codes stay unselected until a person saves them. `not_configured` is still not a search of all sixteen.

Match the posting's NOC code. `aliases_by_noc` is a hint for a posting that has **no** code: the words may point at one of these codes, and the duties still have to be checked. Do not require the job title to equal `official_title` or `display_title`. Do not treat an alias hit as enough on its own.

### Unreadable

`storage_state` is `unreadable`. `configured` is false. `ok` is false. HTTP 200, so a client can tell this apart from a transport failure.

Do not search. Do not treat it as empty and do not treat it as all roles. A later PUT replaces the bad value. A GET does not.

### Other fields

`version` is `1`. `updated_at` is ISO-8601 or null. `empty_means` is always `no_searches`. `missing_means` explains the not-configured case. `catalogue` is the role and course text the page renders. `allowed_nocs` is the only acceptable code list. `key` echoes `prefs:job-interests`.

Example, after the person saves two roles:

```json
{
  "ok": true,
  "version": 1,
  "key": "prefs:job-interests",
  "storage_state": "saved",
  "configured": true,
  "nocs": ["13100", "22221"],
  "updated_at": "2026-11-07T15:04:00.000Z",
  "selection_meaning": "search_only_these_nocs",
  "empty_means": "no_searches",
  "missing_means": "not_configured_do_not_search_and_do_not_assume_all",
  "allowed_nocs": ["13100", "13110", "22221", "22220", "62010", "14400", "75101", "65102", "21234", "21232", "22222", "21233", "21223", "14111", "14100", "64409"],
  "aliases_by_noc": {
    "13100": {
      "official_title": "Administrative officers",
      "display_title": "Administrative officer / Office administrator",
      "also_called": ["Administrative officer", "Office administrator"]
    }
  },
  "match_guidance": {
    "match_on": "noc_2021_code",
    "when_not_configured": "Do not run a search. Do not substitute all eight NOCs or invent a selection.",
    "when_explicit_empty": "Search zero NOC groups. Do not fall back to all roles.",
    "when_saved": "Search only the nocs array, then drop postings whose duties hit the exclusions."
  }
}
```

`aliases_by_noc` and `match_guidance` and `catalogue` are present on every GET. The snippet above shortens them.

Reads can lag a write by up to the KV cache window (default 60 seconds, minimum 30). The PUT body is the value that was stored. A data sync does not update this key.

## PUT /api/preferences

Replaces the saved selection. The page sends this. The search routine does not need to.

Required:

- `Content-Type: application/json`
- `X-Tracker-Intent: save-job-interests`
- Body: `{ "nocs": ["13100"] }`
- Optional `version: 1` only

A browser must send `Origin` equal to the Worker origin and `Sec-Fetch-Site: same-origin`. A non-browser caller omits both. Any other origin, `Origin: null`, or any other `Sec-Fetch-Site` is `403` with `error: "cross_origin_blocked"` and nothing is written.

`nocs` must be an array of strings from `allowed_nocs`. Duplicates are collapsed. Order in storage follows the catalogue, not the request. Unknown codes, numbers, extra fields, and `version` other than 1 are `400` and do not change the stored value. An empty array is valid and means explicit empty. Omitting `nocs` is `400`.

Success is `200` with `"saved": true` plus the same view as GET. Failure to write is `503` and the previous value stays.

| Status | Meaning |
| --- | --- |
| 200 | GET view, or PUT saved |
| 400 | Body rejected, nothing saved |
| 401 | Missing or wrong Basic Auth. Body is `Authentication required` and does not contain the selection |
| 403 | Cross-origin or missing `X-Tracker-Intent` |
| 405 | Method other than GET, HEAD, PUT. No CORS allow header |
| 413 | Body over 4096 bytes |
| 415 | Content-Type is not JSON |
| 503 | KV binding missing or the read/write failed |

KV allows about one write per second to the same key. The button stays disabled when the selection is unchanged. A second write inside that second can return 503; the checks remain on the page.

## What the selection does not do

Saving does not send an application, enroll in a course, or change All / New jobs / Applied. Those tabs keep counting every stored job and every sent job. The checkbox "Optional: limit this list to saved job interests" is off on each visit. It filters the on-screen list by the five-digit code already stored on each row. It does not apply the duty exclusions, and it does not change the tab badges.

Courses on the cards are optional online learning. Completion certificates are not professional licences, regulatory registration, or in-person employer training. Prices are not shown because they change. Saskatchewan registration for NOC 22220, a forklift certificate, and a driver's licence are called out as separate from those courses. None of the links promise a job or a visa.
