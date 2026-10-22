# HoursWatch

A private, local website-activity tracker for Chrome. It records **which websites you actively looked at, when, and for how long**, and shows it as a 24-hour timeline with daily stats, searchable history and CSV export.

Everything stays on your computer. No account, no server, no analytics.

Built with TypeScript, Manifest V3 and [Extension.js](https://extension.js.org). No UI framework: plain TypeScript, HTML and CSS.

## Install (Load unpacked)

Requires Node 20+ and Chrome 116+.

```bash
npm install
npm run build          # writes the extension to dist/chrome
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the **`dist/chrome`** folder inside this project (the folder that contains `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and **pin HoursWatch**.

Tracking starts immediately. After changing the code, run `npm run build` again and press the reload icon on the extension's card in `chrome://extensions`.

### Development

```bash
npm run dev            # builds, opens Chrome with the extension, reloads on change
npm test               # unit tests (Vitest)
npm run typecheck
```

## Using it

- **Toolbar icon**: a popup with the current status (tracking / paused), today's total, a mini 24-hour strip, your top sites, a **Pause/Resume** button and **Open dashboard**.
- **Dashboard** (opens in a tab; also reachable from `chrome://extensions` → HoursWatch → *Extension options*):
  - **Header**: previous/next day, date picker, *Today*, *Export CSV*, *Settings*.
  - **Summary**: total tracked time, visits, unique websites, most time on, most visits, average visit.
  - **24-hour timeline**: one colored block per visit, positioned and sized by real start/end time. Hatched areas are time with no tracked browsing; a red line marks *now* (today only). Hover a block for details, click it for the visit panel. Zoom with **+/−** or **Ctrl + scroll**, scroll sideways when zoomed, **Jump to now**. Visits crossing midnight are split across both days.
  - **Website breakdown**: per-domain time, share, visit count and bars. Click a domain to filter the history and dim other sites on the timeline.
  - **Visit history**: search by domain; scope = selected day / date range / all history; sort by time, duration or domain (either direction); grouped by date when viewing several days; *Reset filters*.
  - **Export CSV**: selected day, custom range, or all history (see below).
  - **Settings**: theme, 12/24-hour time, pause tracking, ignore very short visits, never-track list, privacy summary, **delete all data**.

### CSV export

Columns: `Date, Website Domain, Visit Start Time, Visit End Time, Duration in Seconds, Duration (Human-Readable)`.
Times are local (`YYYY-MM-DD HH:mm:ss`). A visit crossing midnight is exported as one row per day, each with that day's share of the duration. Files are UTF-8 with a BOM so Excel opens them correctly, values are RFC 4180-escaped, and cells that look like spreadsheet formulas are neutralised. Filenames: `hourswatch-2025-06-10.csv`, `hourswatch-2025-06-01_to_2025-06-10.csv`, `hourswatch-all-history-2025-06-10.csv`. Files are generated in the page; nothing is uploaded.

## What counts as tracked time

Time accrues only while **both** are true: the Chrome window is focused, **and** the site is the active tab of that window.

It pauses immediately when you switch tabs, switch to another app, lose window focus, navigate to an unsupported page, or close the tab. It resumes when Chrome is focused again on an eligible tab.

- Only `http(s)` pages are tracked. `chrome://`, extension pages (including this dashboard), `file:`, `about:`, `data:`, `view-source:` and the Chrome Web Store are ignored.
- Incognito is never tracked (the extension is not allowed in incognito).
- A domain is the hostname without a leading `www.` (`www.github.com` = `github.com`). Other subdomains are separate (`gist.github.com` ≠ `github.com`).
- Navigating within one domain (links, SPA route changes, switching between two tabs of the same site) continues the same visit. Switching domains closes it and starts a new one.
- Visits shorter than 1 second (configurable) are dropped, so flicking through tabs doesn't create noise.

## Permissions and why

| Permission | Why it is needed |
| --- | --- |
| `tabs` | Read the **URL of the active tab** so its domain can be recorded and eligibility decided. Without it Chrome hides `tab.url`. Only the hostname is ever stored. |
| `storage` | Save visits and settings in `chrome.storage.local`. |
| `unlimitedStorage` | Local storage is capped at 10 MB, which heavy browsing (tens of thousands of visits) can exceed. Without this, recording would silently start failing. |
| `alarms` | A one-minute heartbeat that wakes the service worker if Chrome suspended it, so an open visit is re-verified and checkpointed. It never counts time. |

No host permissions, no content scripts, no `webNavigation`, no `history`, no network access. Navigation is detected through `tabs.onUpdated`, which also reports single-page-app URL changes, so `webNavigation` isn't needed.

## Privacy

**Stored**, per visit: the domain (e.g. `github.com`), start time, end time, duration, and a random id. Plus your settings and a domain → color map (cosmetic).

**Never stored**: page URLs, paths, query strings, titles, page contents, form data, passwords, cookies, or anything from incognito windows. The extension has no content scripts and cannot read pages.

**Where**: only in this browser profile's local extension storage. There is no backend, account, analytics or network code. **Settings → Delete all activity data** removes every record and the color map.

## How it works

```
src/
  background/   service worker: events -> TrackingEngine (the state machine)
    engine.ts     reconciles persisted session with the real browser state
    chrome-env.ts reads focused window / active tab from chrome.*
    index.ts      event wiring, 1-minute heartbeat, focus verification
  storage/      KeyValueStore abstraction, date-bucketed visit repo, migrations
  shared/       time/day-splitting, domain rules, stats, CSV (pure, unit-tested)
  dashboard/    full-page UI (timeline, summary, breakdown, history, dialogs)
  popup/        toolbar popup
tests/          Vitest unit tests
```

**State machine.** Every relevant event (tab activated/created/closed/updated, window focus/removal, startup, alarm) calls `engine.sync(at)`. `sync` asks Chrome what is true *now*, then reconciles: close the open visit if the target changed or disappeared, checkpoint it if unchanged, open one if a new eligible tab appeared. Calls are serialised, and the visit and tracker state are written in a single atomic `storage.local.set`.

**Time source.** Visits store absolute epoch-ms `startTime`/`endTime`; durations are derived from timestamps. No timer is ever used to *count* time, so service-worker suspension cannot skew it.

**Focus verification.** Chrome does not reliably fire `windows.onFocusChanged` when focus moves to another *application* (observed on Linux; it does fire when focus returns). So while a visit is open the worker re-verifies eligibility every second. This only detects changes quickly; it adds no time itself, and it stops as soon as nothing is being tracked. Persisted checkpoints from this loop are throttled to once per 15 s.

**Recovery.** The persisted checkpoint is the last moment eligibility was verified. If the next sync finds it more than 150 s old (worker killed, laptop asleep, crash), the visit is closed *at the checkpoint* and the gap is not counted. On a browser restart or extension reload (detected through `storage.session`, which is cleared by both) any leftover visit is closed at its checkpoint, even after a quick restart. If Chrome's APIs fail, the visit stops at the last verified moment.

**Storage.** `visits:YYYY-MM-DD` buckets (keyed by the UTC date of the start time, so timezone/DST changes never move records), plus `visitIndex`, `tracker`, `settings`, `domainColors`, and `schemaVersion` with a migration runner (`src/storage/migrations.ts`). Queries read only the buckets that overlap the requested range.

**Midnight and DST.** Visits are stored whole and split at **local** midnight when reporting/rendering. Days are computed with calendar arithmetic, so 23- and 25-hour DST days are correct; the timeline axis uses the day's real length.

## Tests

`npm test` runs 101 tests covering tab switching, window-focus changes (including focus loss with no event), same/cross-domain navigation, ineligible pages, incognito, pause and exclusions, service-worker restart and gap recovery, browser restart, clock skew, midnight and DST boundaries, duration/stat calculations, storage persistence and migrations, colors, and CSV output.

## Known limitations

- **Idle/locked screens are not detected.** If Chrome stays focused on a tab while you're away, that time counts. Eligibility is defined as window focus + active tab only.
- A crash or power loss can lose up to ~15 s at the end of the last visit (the throttled checkpoint), never more.
- Domains are hostnames, not registrable domains (no public-suffix list), so subdomains are listed separately.
- Domains are stored as Chrome reports them (IDN hostnames appear in punycode).
- Per-visit records only: there is no per-page or per-title breakdown, by design.
