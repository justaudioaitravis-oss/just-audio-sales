**BRIEF — Just Audio field sales PWA**

Build a lightweight Progressive Web App for field sales lead capture. I am not a developer — explain what you're doing in plain language and don't assume I can debug.

> **STATUS (updated 28 Sep 2026, end of session): Built, hardened and deployed.** This file describes the app as it actually is, not just as originally requested — read this before making further changes so nothing gets rebuilt or redeployed unnecessarily. **To pick up where we left off, read SESSION LOG, KNOWN ISSUES and NEXT — EFFICIENCY PLAN at the bottom first.**
>
> - **Live app:** `https://justaudioaitravis-oss.github.io/just-audio-sales/`
> - **GitHub repo:** `https://github.com/justaudioaitravis-oss/just-audio-sales` (public repo — GitHub Pages on the free tier requires this, so nothing secret may ever go in it; see PASSCODE LOCK below)
> - **Google Sheet:** tab named `Leads`, columns match the APPS SCRIPT section below
> - **Apps Script:** deployed as a Web App, URL pasted into `config.js` → `APPS_SCRIPT_URL`. To ship a script change, edit `apps-script.gs`, paste into the Apps Script editor, then Deploy → Manage deployments → edit → **New version** → Deploy (the live URL does not change, so `config.js` never needs re-editing for a script-only change)
> - Installed to home screen on the owner's phone, behind a passcode screen checked by the Apps Script (see PASSCODE LOCK)
> - **Live versions:** app = commit `8429cfd` on GitHub Pages; Apps Script = API version **4** (deployed, `PASSCODE` script property set, 8+ chars); Drive photo folder confirmed private. The owner deleted all Sheet rows on 28 Sep 2026 to start fresh.
> - **Shipping any app change:** deploy Apps Script first (if changed), then upload files. No version bump needed — phones pick up changed files automatically (see OFFLINE)

**Stack constraints (strict):** Plain HTML, CSS and vanilla JavaScript. No React, no Vue, no Tailwind, no npm packages, no build step, no bundler. Total payload under 50KB excluding photos. It must open in under one second on a mid-range Android phone on weak wifi.

*(As of 28 Sep 2026 the app files total ~60KB raw / ~18KB compressed — over the 50KB raw target because of plain-English comments. Measured: stripping every comment would save only ~3KB compressed, so it was left readable. Opening is ~50–100ms from the phone's saved copy.)*

**Files, exactly these:**
```
index.html
app.js
styles.css
config.js
manifest.json
sw.js
icons/ (192px and 512px PNG, generate simple ones)
```
Plus `apps-script.gs` (Apps Script backend, kept in this same folder for reference — it isn't deployed via GitHub Pages, it's pasted into the Apps Script editor by hand) and `README.md` (end-user instructions).

**Context:** Single-page app used on a phone from the home screen, in restaurants and bars in Goa. Often poor signal. Used one-handed while standing and talking to someone. Hosted on GitHub Pages. Data goes to a Google Sheet via Apps Script.

---

**LAYOUT**

Fixed bottom nav with exactly two tabs: "Follow-ups" and "New". No other navigation, no back buttons, no menus, no search. Tabs switch by showing/hiding sections — no routing, no page reloads. Active tab label is dark and semibold; inactive is muted grey.

All touch targets minimum 44px tall. Respect `env(safe-area-inset-bottom)` so the nav clears the home indicator on iPhone.

---

**PASSCODE LOCK**

Because GitHub Pages on the free tier can only serve public sites, everything in the repo — including `config.js` and the Apps Script URL — is public. So the passcode is **checked by the Apps Script, not the app**: it is stored in the script's Script Properties (`PASSCODE`), never in the repo, and every `doPost` must carry it as `key` or the script reads and writes nothing (`{ok: false, auth: true}`). A wrong passcode waits 1.5s before answering (slows guessing — Apps Script can't see who is calling, so per-caller lockouts aren't possible), and the script refuses to work at all if the stored passcode is missing or under 8 characters (`setup: true`).

The app shows a full-screen passcode prompt before anything else (including the rep name prompt) until the script accepts a passcode, then stores it in localStorage (`ja_key`) and sends it with every request — added at send time, never stored inside queued items. The first unlock needs signal; wrong code / no signal / script not set up / script too old each show their own inline message, no `alert()`. If the script ever answers `auth` (passcode changed), the app forgets the stored passcode and shows the prompt again over whatever is on screen (form contents are kept); queued uploads wait and go once the new passcode is entered. Phones unlocked by the first build's client-side check (`ja_unlocked`, code `1234` in public `config.js`) are asked once for the new passcode.

`doGet` only answers `?v=1` (version check) and never returns lead data. The duplicate-number lookup is a passcode-protected `doPost` (`kind: "lookup"`) returning only `lead_id`, `created_at`, `contact_name`, `venue`, `last_contacted`, `status`, `source` — never notes, phone, rep or photo folder.

Photos in Drive are private to the script owner by default; don't share the "Just Audio - Lead Photos" folder publicly. If per-person logins are ever needed (rather than one shared passcode), the upgrade is hosting on Cloudflare Pages + Cloudflare Access (free, email-verified login).

---

**TAB 1 — FOLLOW-UPS**

Heading: "Follow-ups".

Lists **every lead on this phone**, the moment a visit is logged for it — not only once its reminder is due. Sorted by `next_action_date` ascending (soonest/most-overdue first).

Each row shows two lines:
- Line 1: venue name, 18px, semibold
- Line 2: which draft will be sent, 13px, muted, plus timing context:
  - Overdue: `"2-day nudge · 3 days late"`
  - Due today: `"1-week nudge"` (no extra suffix)
  - Not yet due: `"2-week nudge · due 5 Oct"`

Rows are separated by 1px hairlines, not cards.

Leads are never removed from this list, so it grows (~1,000 a year at 5 visits a day). To keep it quick: row labels are computed without building the full WhatsApp message (that happens only on tap), the date formatter is created once, rows are built in a DocumentFragment and swapped in at once, one delegated click listener per list (rows carry `data-id`), and `content-visibility: auto` skips laying out off-screen rows. Measured at 6× CPU throttle (budget Android): 1,000 leads ≈ 45ms to show the list, 3,000 ≈ 100ms (about half what it was). Minifying was measured and skipped: stripping every comment saves ~3KB of compressed download, not worth the readability.

**A reminder can only be sent from its due date onward** — rows that are due today or overdue can be tapped; rows not yet due (e.g. the 2-day nudge on the day of the visit) are shown with a muted venue name and do nothing when tapped. (Changed from the original brief, which allowed tapping early.)

**Tapping a due row does three things in this order:**
1. Opens `https://wa.me/{phone}?text={encoded draft message}` in a new tab
2. Advances that lead's reminder stage (see REMINDER SCHEDULE below) and recomputes `next_action_date`; sets `last_contacted` to today. These three fields (and only these — never `status` or anything else) are queued to the Sheet as a `kind: "update"` upload; undo queues the restored values the same way
3. Moves the row to a "done" group at the bottom: faded grey, tick icon, still visible

Done rows persist until local midnight and read `"✓ 2-day nudge sent · tap to undo"` — the message that was sent, not the next one (showing the next stage's label made done rows look like a reminder waiting to go out). Tapping a done row **undoes** the push — restores the previous `reminder_stage`/`next_action_date`/`last_contacted`/`status` and returns it to the active list. This undo is important; don't skip it.

Empty state: centred, muted — "No leads yet." (shown only when the phone has zero leads at all, since the list itself is now always-visible/never date-filtered).

---

**REMINDER SCHEDULE (automatic — no manual "nudge interval" picker)**

Every visit logged in New Entry (see below) resets a lead's reminder countdown to start counting from that visit's date (`schedule_anchor` = the visit date, `reminder_stage` = 0). The next few reminders fall due on a fixed cadence measured in days from that anchor date — **not** from whenever the previous reminder actually went out:

- Reminder 1 (stage 0): `REMINDER_SCHEDULE_DAYS[0]` days after the visit — default **2 days**
- Reminder 2 (stage 1): `REMINDER_SCHEDULE_DAYS[1]` days after the visit — default **1 week**
- Reminder 3 (stage 2): `REMINDER_SCHEDULE_DAYS[2]` days after the visit — default **2 weeks**
- Reminder 4 onward (stage 3+): repeats every `MONTHLY_INTERVAL_DAYS` days after that — default **monthly**

Each stage has its own prewritten WhatsApp template (see config.js section below) — `nudge_2day`, `nudge_1week`, `nudge_2week`, `nudge_monthly` — the same way the very first contact message is prewritten per enquiry type. Tapping a Follow-ups row sends whichever template matches the lead's current stage, then advances to the next stage.

If a lead's `status` has been manually set to `"quoted"` (there's no UI control for this yet — it would need to be edited directly in the Sheet, or a future UI added), the `quote_chase` template is used instead of the staged nudge, regardless of stage. *(A phone only learns about a status set in the Sheet when that number goes through the duplicate check again — phones don't pull changes from the Sheet yet; see NEXT — EFFICIENCY PLAN, P2.)*

---

**TAB 2 — NEW ENTRY**

Heading: "New entry". Fields top to bottom:

1. **Phone.** Static "+91" prefix, then input. `type="tel"`, `inputmode="numeric"`. Accept exactly 10 digits, allow spaces while typing, strip them on save. Store as `+91XXXXXXXXXX`. Largest text on the screen, ~24px. Reject on submit if not 10 digits, with an inline message — no alert() dialogs anywhere in this app.

2. **Contact name** and **Venue name**, side by side on one row, underline-style inputs.

3. **Enquiry** — three chips, single select, default "Sales": Sales / Service / Acoustics. Selected chip is dark fill with light text.

4. **Photos** — labeled, room-based, not a flat row of five anymore:
   - Room 1 has 5 slots, one per label, in this order: **Front wall, Left wall, Right wall, Back wall, Ceiling**.
   - A **"+ Add another room"** button appends another room with 6 slots: **Front wall, Left wall, Right wall, Back wall, Ceiling, Overview**. Can be tapped repeatedly for as many rooms as needed.
   - Labels live in `config.js` (`ROOM_ONE_LABELS`, `EXTRA_ROOM_LABELS`) so they can be changed without touching layout code.
   - Each slot opens the camera via `<input type="file" accept="image/*" capture="environment">`. Filled slots show the thumbnail with the label underneath; empty slots show a dashed border. Tapping a filled slot offers retake. All photos optional, never block submission.

5. **Note** — one full-width text input, placeholder "Note — zones, music, deadline". Plain text field so the phone keyboard's own dictation works. Do not build a recorder.

6. **Submit button** — full width, green, pill-shaped, label reads `Send to +91 98765 43210` using the live value of the phone field.

**On submit, in this order:**
1. Validate phone. Stop if invalid.
2. Compress photos (below).
3. Reset the reminder schedule for this lead: `schedule_anchor` = today, `reminder_stage` = 0, `next_action_date` = today + `REMINDER_SCHEDULE_DAYS[0]`, `last_contacted` = today.
4. Save the visit to the offline queue on the phone (row + one item per photo), then send in the background (see OFFLINE).
5. Open WhatsApp with the pre-filled first-contact message (`first_sales` / `first_service` / `first_acoustics`, matching the Enquiry chip) straight away — it does not wait for the upload (it must open within the tap, or phones block it).
6. Reset the form and switch to the Follow-ups tab.

Send is disabled ("Preparing photos…") while any photo is still compressing. A revisit is matched to an existing lead by the duplicate check, or — if that couldn't run — by the same phone number already on this phone.

Never block submission on photos.

---

**PHOTO COMPRESSION**

Before upload, in a canvas: resize so the longest edge is max 1600px, export JPEG at quality 0.7. Convert to base64 for the POST. This is not optional — raw phone photos will fail on venue wifi.

Implementation details (as built): the file is read via an object URL (not FileReader), and each photo produces two JPEGs — the 1600px upload and a 192px thumbnail used for the on-screen slot (showing the 1600px image in a 58px slot would hold ~8MB of decoded memory per photo). Canvases are zeroed after use (iPhone memory), and an out-of-memory `"data:,"` result counts as a failure. While any photo is compressing, Send is disabled and reads "Preparing photos…", so a photo can't be dropped or leak into the next visit's form. A photo that can't be decoded leaves the slot as it was with a red "Try again" caption, never blocking submission. Each slot tracks its newest attempt, so a slow earlier shot can't overwrite a quick retake.

---

**DUPLICATE CHECK**

When the phone field loses focus **and** contains 10 valid digits, ask the Apps Script with that number — a passcode-protected POST (`kind: "lookup"`), sent only once the script is known to be version 4+ (see PASSCODE LOCK). The answer is ignored if the phone field changed meanwhile. *(Known weakness: each Apps Script call takes 4–10s, so the answer often arrives after Send — see NEXT — EFFICIENCY PLAN, P1c/P2.)*

If a match exists, show one muted line directly below the field:
`Priya · Anjuna Social · last contacted 12 Mar`

Pre-fill name and venue from the record. On submit, update that lead's row rather than appending a new one — this also means visiting an existing venue again resets its reminder schedule to start from today's new visit (see REMINDER SCHEDULE above), which is intentional: a fresh in-person conversation restarts the follow-up clock. Silent failure if the lookup errors — never block the form on it.

If the number is in the Sheet but not on this phone (logged by another rep/phone), the phone adopts that row's `lead_id`, `created_at`, `status` and `source`, so the visit updates the existing row. A `status` found in the Sheet (e.g. `quoted`, set by hand) is always kept, never reset to `new`. If the lookup couldn't run (no signal), the phone falls back to its own lead with the same number, so an offline revisit still doesn't create a duplicate.

---

**OFFLINE**

Register a service worker that caches the app shell with a cache-first strategy, so the app opens instantly and works with no signal.

Updates are automatic — there is no cache version to bump. On every app open (navigation), the service worker serves the saved copy immediately, then in the background re-downloads all shell files (`cache: "no-cache"`, so unchanged files are cheap 304s) and compares them byte-for-byte with the saved copy. If anything differs, the complete set is saved as a new cache (`just-audio-shell-<timestamp>`) and only then are older caches deleted — never a half-updated mix; any failed download keeps the old copy. The new version runs from the next open. `app.js` also calls `registration.update()` on load so changes to `sw.js` itself are picked up promptly.

Every submit is saved to an offline queue on the phone **first**, then sent — never sent-then-saved-on-failure. The queue lives in **IndexedDB**, not localStorage: localStorage caps at ~5MB, which two photo-heavy visits fill, silently losing leads (this was a real bug in the first build, caught by stress testing).

Each visit is queued as small separate uploads: one `kind: "lead"` item (the Sheet row), then one `kind: "photo"` item per photo, each with a fixed `photo_id`. Items go one at a time, oldest first, and are deleted only after the Apps Script replies `{ok: true}`. No signal / timeout / Google error page → stop and retry later. `{ok: false}` → keep it, carry on with the rest, retry that item after 10 minutes or on next app open. Only one retry runs at a time (plus `navigator.locks` across tabs). Before sending anything an older script wouldn't understand, the app checks the Apps Script's version (`GET ?v=1`, remembered for the session): photos need v2+, Follow-ups updates v3+, passcode checks and duplicate lookups v4+ — so an out-of-date deployment can never receive a request it would misread as a lead and write a damaged row. The passcode is added to each request at send time (never stored in queued items); an `auth` refusal re-locks the app and the item waits; a `busy` answer (Sheet lock timed out) retries within a minute instead of pausing 10.

Retries run on app load, on `window.online`, when the app comes back to the foreground (e.g. returning from WhatsApp), and every minute while open. Anything left in the old localStorage queue (`ja_queue`) from the first build is moved to IndexedDB on load. While anything is queued, the Follow-ups tab shows a badge counting visits with something still to send: "2 waiting". Clears when the queue drains.

The queue must survive the app being closed. Test this path carefully — it is the most likely thing to be silently broken.

---

**REP IDENTITY**

On first open (after the passcode screen), show a single full-screen prompt: "Your name?" with one input and a Save button. Store in localStorage, write to the `rep` column on every row. No login, no accounts, no password. Build it so a future version can filter the Follow-ups list by rep.

---

**config.js**

Every value I might change lives here and nowhere else. Comment each one in plain English.

```js
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby0FDcwHB7LoKkEqs1MaOE2JD7WDHg5nsArNaB6ZLxOWmn3IXLqrQiXtcvQuoI9eSVI/exec",

  // (No PASSCODE here — it lives in the Apps Script's Script Properties;
  //  see PASSCODE LOCK above. This file is public.)

  // Brochure links — one per enquiry type.
  // Set all three to the same URL if there is only one page.
  BROCHURE: {
    sales:     "BROCHURE_URL_SALES_PLACEHOLDER",
    service:   "BROCHURE_URL_SERVICE_PLACEHOLDER",
    acoustics: "BROCHURE_URL_ACOUSTICS_PLACEHOLDER"
  },

  COMPANY_NAME: "Just Audio",

  // See REMINDER SCHEDULE section above.
  REMINDER_SCHEDULE_DAYS: [2, 7, 14],
  MONTHLY_INTERVAL_DAYS: 30,

  // See TAB 2 — NEW ENTRY, photos, above.
  ROOM_ONE_LABELS: ["Front wall", "Left wall", "Right wall", "Back wall", "Ceiling"],
  EXTRA_ROOM_LABELS: ["Front wall", "Left wall", "Right wall", "Back wall", "Ceiling", "Overview"],

  // {name} {venue} {brochure} {rep} {company} are replaced at send time
  TEMPLATES: {
    first_sales: "...",
    first_service: "...",
    first_acoustics: "...",
    nudge_2day: "...",
    nudge_1week: "...",
    nudge_2week: "...",
    nudge_monthly: "...",
    quote_chase: "...",
    survey_offer: "..."
  }
};
```

All nine templates should read warm, plain Indian English, no exclamation marks, no emoji, under 60 words each. The `first_sales` one should promise a quote and offer a free site survey.

**Critical:** when building the `wa.me` URL, encode the whole message with `encodeURIComponent`. Line breaks must be real `\n` in the template and must survive encoding as `%0A`. A message arriving as one unbroken paragraph is a bug.

---

**APPS SCRIPT**

The complete Google Apps Script lives in `apps-script.gs`:

- `doPost` — append a new row, or update the existing row when `lead_id` is supplied. Accepts `kind: "lead"` (row only), `kind: "photo"` (one photo; skipped if its `photo_id` was already saved; links the venue folder into the row), and the first build's single all-in-one payload (row + `photos` list). Runs under a script lock (`tryLock(30000)`); if the lock can't be had, returns `{ok: false, busy: true}`, which the app treats like a network failure (retry shortly) rather than a refusal. Row lookups (`lead_id`, and `phone` for the duplicate check) read only that one column, not the whole sheet. Requires the passcode (`key`) — see PASSCODE LOCK. Also handles `kind: "verify"` (passcode check) and `kind: "lookup"` (duplicate check). Always returns `{ok: true, v: 4}` or `{ok: false, error}`
- `doPost` `kind: "update"` — Follow-ups tap/undo: writes only `reminder_stage`, `next_action_date`, `last_contacted`; `{ok: false}` if the row doesn't exist yet (app retries). Unknown `kind` values are refused. *(Known bug: if the row was deleted from the Sheet by hand, this update is refused forever and the "1 waiting" badge never clears — see KNOWN ISSUES.)*
- `doGet ?v=1` — returns `{ok: true, v: 4}` (API version check; the app needs v2+ before sending photos, v3+ before sending updates, v4+ before a passcode check or lookup). `doGet` returns nothing else.
- Photo handling — decode base64, save into a Drive folder named after the venue (inside one root folder, `Just Audio - Lead Photos`), with a subfolder per room (`Room 1`, `Room 2`, ...), each photo filed under its label as the filename (e.g. `Front wall.jpg`); write the venue folder's URL into the row
- CORS handled correctly for GitHub Pages
- Return JSON always, never HTML

**Sheet columns, in this exact order:**
`lead_id` · `created_at` · `rep` · `phone` · `contact_name` · `venue` · `enquiry` · `visit_date` · `note` · `photo_folder` · `reminder_stage` · `schedule_anchor` · `next_action_date` · `last_contacted` · `status` · `source`

`lead_id` is a timestamp-based string. `phone` is always `+91XXXXXXXXXX`. Dates are `YYYY-MM-DD`. `reminder_stage` is an integer (0 = no reminders sent since the last visit yet). `schedule_anchor` is the visit date the reminder countdown resets from. `status` starts as `new` (manually settable to `quoted` to switch that lead's Follow-ups draft to the quote-chase template). `source` is `visit` or `qr`.

Every cell is written as **plain text** (number format `@`) except `reminder_stage` — otherwise Google Sheets converts values on write (`+91…` → a number, dates → date objects, notes starting `=`/`+` → formulas), which broke the duplicate check. The duplicate lookup also normalises rows written before this fix (numeric phones/lead_ids, Date cells) back to the formats above, matches phones on their last 10 digits, and returns the newest matching row.

---

**VISUAL DESIGN**

Restrained and typographic. Background `#FAF8F4`, text `#16150F`, muted `#6A6455`, hairlines `#DFD9CD`, accent `#B84A28`, send button green `#2F6B4F`.

Hairline dividers, not cards. No shadows, no gradients, no icons except the tick on done rows and the camera affordance. Generous whitespace. Headings in a serif; everything else in the system font stack for speed. If you use a web font, one weight only, `font-display: swap`, with a real fallback.

---

**DELIVERY (completed)**

1. Build all files. ✅
2. Start a local server and tell me the URL to open. ✅
3. Tell me how to switch my browser to phone view. ✅
4. `git init` and commit once it runs. ✅
5. Walk through deployment one step at a time — Google Sheet, Apps Script, GitHub Pages, adding to home screen — waiting for confirmation at each step. ✅ Originally done via GitHub Desktop. Since 28 Sep 2026, `git push origin main` from the command line also works in this environment.

`README.md` covers: how to change the brochure URLs, how to edit the message templates, how to change the reminder schedule, how to change the passcode, how the photo rooms work, how to export the sheet to Excel, and what to do if a submission doesn't appear.

---

**SESSION LOG — 28 Sep 2026**

A full review → fix → stress-test pass, shipped in these commits (all pushed and live):

| Commit | What changed |
|---|---|
| `24eccdd` | **Offline queue made lossless.** Queue moved from localStorage (~5MB cap silently dropped photo-heavy visits) to IndexedDB; save-first-then-send; each visit split into a row upload + one upload per photo with a fixed `photo_id`; one drain at a time (+ `navigator.locks`); delete only on `{ok: true}`; timeouts; retries on load / online / foreground / every minute; old localStorage queue migrated. Apps Script: `kind` uploads, photo de-duplication, script lock, version check. |
| `14944b6` | **Sheet sync fixed.** Cells written as plain text (Sheets was turning `+91…` numbers, lead_ids and dates into numbers/dates, which broke the duplicate check); revisits of leads first logged on another phone update that row and keep a hand-set `quoted` status; offline revisits match locally; Follow-ups taps/undos reach the Sheet as `kind: "update"` (three reminder cells only). |
| `8aadc8f` | **Automatic app updates.** Service worker re-checks all files on each open and swaps in a complete new copy atomically — no more manual cache-version bumps. |
| `132ab0b` | **Faster lookups, busy retries, safer photos.** Script reads one column to find rows (5,000-row sheet: 5,016 cells instead of 80,016); busy lock → quick retry; 192px thumbnails instead of 1600px images in 58px slots (~8MB memory each); Send waits while photos compress; unreadable photos say "Try again"; newest retake wins. |
| `3da3d1e` | **Faster Follow-ups list.** Labels without building messages, one date formatter, DocumentFragment, delegated clicks, `content-visibility: auto`. 3,000 leads: 267ms → 101ms to show at 6× CPU throttle. |
| `30dc1e6` | **Reminders only from their due date** (owner's request: no 2-day nudge on the visit day); done rows read "✓ 2-day nudge sent · tap to undo". |
| `8429cfd` | **Passcode checked by the Apps Script.** Removed from public `config.js`; stored in Script Properties; required on every request; lookup returns only what the form needs; `doGet` returns no data; weak/missing passcode refuses all. Before this, anyone reading the public repo could look up any customer by phone number and write to the Sheet. |

**Owner decisions recorded this session:** reminders are sendable only from their due date onward (overdue still sendable); undo on done rows kept; passcode kept server-side (8+ characters); minifying skipped (readability); the brief's 1600px / 0.7 photo spec unchanged.

---

**KNOWN ISSUES (open, not yet fixed)**

1. **Stuck "1 waiting" after deleting Sheet rows by hand.** A Follow-ups tap on a lead whose row was deleted produces an update the script refuses forever (`No row for lead_id`); the phone keeps retrying. The owner deleted all rows on 28 Sep 2026, so any old test leads still on the phone would trigger this when their reminder comes due. Fix: script answers `{ok: true, missing: true}` for an update with no row (or the app drops an update refused with "No row").
2. **No way to remove leads from a phone.** Old/test leads stay in Follow-ups forever. Fixed properly by P2 (sync down) — or a small remove/archive control (owner to decide).
3. **Duplicate check usually loses the race.** Each Apps Script call takes 4–10s (measured), and the first lookup of a session costs two calls (version check + lookup), so the rep has often pressed Send before the answer arrives → a revisit of a lead logged on *another* phone can still create a second row. See P1b, P1c, P2.
4. **Phones don't learn about Sheet changes** (status set to `quoted` by hand, rows deleted, other reps' leads) except via the duplicate check. See P2.
5. **localStorage leads have a ceiling.** ~380 bytes per lead (measured) → Safari's ~5MB cap is reached somewhere around 6,000+ leads (years away), and `saveLeads` isn't guarded: if it ever throws, submit fails before the visit is queued. See P4.
6. **App files over the 50KB raw target** (~60KB raw / ~18KB compressed) — accepted for readability.

---

**NEXT — EFFICIENCY PLAN (planned 28 Sep 2026, not started)**

Owner's direction: **efficiency over everything.** Ordered by measured impact. Nothing here has been built yet.

*Measurements behind it:* Apps Script web-app calls from a fast connection (0.07s to google.com) took **4–10s each, one 31s** — even the trivial `?v=1` version check that touches no data, so it is Apps Script start-up + Google's redirect, not the network or the Sheet. On a 4× throttled CPU, a 12MP photo's `canvas.toDataURL` blocked the screen **136ms** (async `toBlob`: 29ms, output 25% smaller). Parsing 3,000 leads from localStorage: 3ms (not a bottleneck). Follow-ups list at 6× throttle: 3,000 leads ≈ 100ms to show, ≈ 136ms per tap.

**P1 — Cut Apps Script round trips (biggest win).** Today a visit with 11 photos = 12 POSTs (+1 version GET per session) ≈ 1–2+ minutes of uploading on good signal; each Follow-ups tap = 1 call; first unlock = 2 calls; first duplicate check of a session = 2 calls.
- **P1a Batch uploads:** a `kind: "batch"` request carrying several queue items (row + photos up to ~1–1.5MB, plus any queued updates) with a per-item result, so partial success still deletes what landed; photos stay idempotent via `photo_id`. Shrink the batch automatically after a timeout (weak wifi). Expected: 12 calls → ~3–4 per visit.
- **P1b Remember the script version** in localStorage (every response already carries `v`), re-checking only when a gated request fails — removes one 4–10s call per app open, and makes first unlock and the first lookup one call each.
- **P1c Start the duplicate check at the 10th digit** (on input, not on blur) — gains the seconds spent typing name/venue.
- **P1d Less work per photo in the script** (not yet measured — add a timing field to responses or read the Executions log first): each photo currently does ~5 Drive name searches (root, venue and room folders, same-name files for de-dup) plus Sheet reads/writes. Cache folder IDs (CacheService / Script Properties → `getFolderById`), de-dup via a CacheService `photo_id` record before falling back to search, write the `photo_folder` cell once per lead, and hold the script lock only for Sheet writes and folder creation (not the Drive file upload) so several reps' uploads don't queue behind each other.
- **P1e Wrong-passcode delay** (1.5s `sleep`) occupies one of Apps Script's ~30 concurrent executions; a flood of bad requests could slow real uploads. Only sleep when recent failures spike (CacheService counter).

**P2 — Pull changes from the Sheet ("sync down").** One call on app open (when idle, with signal) returning leads changed since the last pull — needs an `updated_at` column **appended at the end** of the sheet so the existing column order is kept. Makes the duplicate check instant and offline (no lookup calls), brings hand-set `quoted` statuses to phones, removes rows deleted in the Sheet (fixes KNOWN ISSUES 1 and 2), and lets phones know other reps' leads. **Owner decision needed:** every phone would then hold the team's contact list (privacy trade-off) — options include syncing only this rep's leads plus a phone-number index for the duplicate check.

**P3 — Photo pipeline on the phone.** Switch `toDataURL` → async `toBlob` (≈136ms → ≈29ms of frozen screen per photo; ~1.5s → ~0.3s across 11 photos); store Blobs in IndexedDB (queue ~25% smaller) and convert to base64 only when sending; optionally resize in a Web Worker (`createImageBitmap` + `OffscreenCanvas`; Chrome, Safari 16.4+) for zero screen freeze. Base64's +33% on the wire can't be avoided with Apps Script (it only accepts text bodies; binary bodies would need a CORS preflight Apps Script can't answer). **Owner decision:** 1280px / quality 0.65 would cut uploads ~35–40% vs the brief's 1600px / 0.7.

**P4 — Phone storage.** Guard `saveLeads` now (try/catch so a full storage can never stop a visit being queued); move leads into IndexedDB alongside P2.

**P5 — Follow-ups list growth.** Update only the tapped row instead of re-rendering the whole list; **owner decision:** archive leads (e.g. after N monthly nudges, or a won/lost status) or collapse not-due-for-2-weeks leads into a "Later (N)" group.

**P6 — Small wins.** Service worker re-checks 8 files on every open (background, ~0.1s each) — skip icons/manifest or check at most hourly; the every-minute retry timer only while something is queued; refresh the badge once per drain instead of per item.

Suggested order: KNOWN ISSUE 1 fix (tiny) → P1b + P1c (small, app-only) → P1a + P1d (script + app) → P3 → P2 (needs owner decisions) → P4/P5/P6.

---

**TESTING**

Every change this session was stress-tested with a harness that is **not in this repo** (the repo is public and GitHub Pages serves every file in it). It ran from a temporary session folder, which will be deleted — **save a copy outside the repo if you want to keep it** (e.g. `~/Desktop/jasalesapp-tests`). It uses `puppeteer-core` driving the locally installed Chrome — npm is used only for the tests, never in the app.

- `gas-sim.js` — runs the real `apps-script.gs` in Node against a fake Sheet (converts values like real Sheets unless cells are plain text), fake Drive, Lock, Cache/Properties, Utilities.
- `servers.js` — serves the real app files, plus a fake Apps Script server running the real script with Google-style 302 redirects and switchable faults: dropped connections, saved-but-reply-lost, 500 error pages, delays, refused items, busy lock, older script versions.
- `gas-unit.js` — direct script tests (row upsert, photo de-dup, plain-text cells, old converted rows, updates, busy, one-column reads on 5,000 rows, passcode protection, lookup field limits).
- `e2e.js` — 24 browser scenarios (A–Y): normal visit; 6 offline visits × 11 photos (19.8MB) surviving the app being closed; terrible wifi; two app copies + retry spam; refused items; old-queue migration; app newer than script; app killed mid-upload; revisits (same phone, other phone, offline); follow-up tap/undo sync; unreadable photos; Send while compressing; retake race; thumbnail/upload sizes; double-tap; busy Sheet; due-date rule; passcode (new phone, changed passcode, old-version phones, weak passcode).
- `sw-test.js` — 7 update scenarios (no-bump updates, offline after update, dropped download, rapid reloads, upgrade from the first build).
- `rollout-test.js` — both deploy orders from the live versions.
- `perf.js` — Follow-ups/startup timing at 50–3,000 leads, 6× CPU throttle.

Each new test was also run against the previous commit to confirm it catches the bug it targets.
