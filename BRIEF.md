**BRIEF — Just Audio field sales PWA**

Build a lightweight Progressive Web App for field sales lead capture. I am not a developer — explain what you're doing in plain language and don't assume I can debug.

> **STATUS (updated 30 Sep 2026, round 2): Built, hardened and deployed. Round 2 (brand look, review/edit, music, location) is live — see SESSION LOG — 30 SEP (ROUND 2).** This file describes the app as it actually is, not just as originally requested — read this before making further changes so nothing gets rebuilt or redeployed unnecessarily. **To pick up where we left off, read SESSION LOG, KNOWN ISSUES and NEXT — EFFICIENCY PLAN at the bottom first.**
>
> - **Live app:** `https://justaudioaitravis-oss.github.io/just-audio-sales/`
> - **GitHub repo:** `https://github.com/justaudioaitravis-oss/just-audio-sales` (public repo — GitHub Pages on the free tier requires this, so nothing secret may ever go in it; see PASSCODE LOCK below)
> - **Google Sheet:** tab named `Leads`, columns match the APPS SCRIPT section below
> - **Apps Script:** deployed as a Web App, URL pasted into `config.js` → `APPS_SCRIPT_URL`. To ship a script change, edit `apps-script.gs`, paste into the Apps Script editor, then Deploy → Manage deployments → edit → **New version** → Deploy (the live URL does not change, so `config.js` never needs re-editing for a script-only change)
> - Installed to home screen on the owner's phone, behind a passcode screen checked by the Apps Script (see PASSCODE LOCK)
> - **Live versions (30 Sep 2026, round 2):** app = commit `354e80c` (map lock-down + CSP, round 4) on GitHub Pages; Apps Script = API version **6** (deployed and confirmed via `APPS_SCRIPT_URL?v=1` → `"v":6`; `PASSCODE` script property set, 8+ chars); Drive photo folder confirmed private. The owner deleted all Sheet rows on 28 Sep 2026 to start fresh.
> - **Shipping any app change:** deploy Apps Script first (if changed), then upload files. No version bump needed — phones pick up changed files automatically (see OFFLINE)

**Stack constraints (strict):** Plain HTML, CSS and vanilla JavaScript. No React, no Vue, no Tailwind, no npm packages, no build step, no bundler. Total payload under 50KB excluding photos. It must open in under one second on a mid-range Android phone on weak wifi.

*(As of 30 Sep 2026 round 2: ~95KB raw text files + a 10KB logo. On 28 Sep they were ~60KB raw / ~18KB compressed — over the 50KB raw target because of plain-English comments. Measured: stripping every comment would save only ~3KB compressed, so it was left readable. Opening is ~50–100ms from the phone's saved copy.)*

**Files, exactly these:**
```
index.html
app.js
styles.css
config.js
manifest.json
sw.js
icons/ (icon-192.png, icon-512.png — navy with the white wordmark; logo.png — the white wordmark for the logo bar)
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

**Content-Security-Policy** (meta tag in `index.html`, 30 Sep round 4): `default-src 'none'`; scripts/styles only from the app itself; images self/data/blob; network calls only to self, `script.google.com` and `script.googleusercontent.com` (the Apps Script and its redirect); frames only `https://www.openstreetmap.org`; `base-uri`/`form-action` none. So even if a lead's text contained code, nothing else could run or be loaded, and data can't be sent anywhere else. **If the Apps Script URL ever moves off `script.google.com`, or another outside service is added, update this policy or the browser will block it.** (The test server rewrites `connect-src` to allow its fake script.)

`doGet` only answers `?v=1` (version check) and never returns lead data. The duplicate-number lookup is a passcode-protected `doPost` (`kind: "lookup"`) returning only `lead_id`, `created_at`, `contact_name`, `venue`, `last_contacted`, `status`, `source` — never notes, phone, rep or photo folder.

Photos in Drive are private to the script owner by default; don't share the "Just Audio - Lead Photos" folder publicly. If per-person logins are ever needed (rather than one shared passcode), the upgrade is hosting on Cloudflare Pages + Cloudflare Access (free, email-verified login).

---

**TAB 1 — FOLLOW-UPS**

Heading: "Follow-ups".

Lists **every open lead on this phone** (status `new` or `quoted`) from the moment a contact is logged — not only once its reminder is due. Won/lost leads leave the list. Sorted by `next_action_date` ascending (soonest/most-overdue first).

Each row shows two lines:
- Line 1: venue name, 18px, semibold (muted when not yet due)
- Line 2: which message is next, 13px, muted, plus timing context:
  - Overdue: `"2-day nudge · 3 days late"`
  - Due today: `"1-week nudge"` (no extra suffix)
  - Not yet due: `"2-week quote chase · due 5 Oct"`

Rows are separated by 1px hairlines, not cards.

**Tapping a row opens a panel under it** (one open at a time): an info line (contact · phone · enquiries · music · venue type · size · quoted date · **Map** link if a location is saved), a full-width navy **Send "<message>"** button, and a row of five: **Call** (`tel:` link), **Edit**, **Quoted** ("Requoted" once quoted), **Won**, **Lost**. Due rows carry a thin navy bar on their left edge.

- **Edit** opens the lead in the New entry form (heading "Edit lead", a "Cancel edit" link, no site chips). Review → **Save changes** updates the lead on the phone and queues a full `kind: "lead"` upsert of its row (plus any new photos, numbered from Room 1 again in Drive). It does **not** reset reminders, change `visit_date`/`rep`, or open WhatsApp.

- **Send** works only from the due date onward (before that it is greyed out and reads `"1-week nudge · due 5 Oct"`). It opens `https://wa.me/{phone}?text={encoded message}`, advances `reminder_stage`, sets `next_action_date` = today + the next gap and `last_contacted` = today, and moves the row to "Done today" (faded, tick, `"2-day nudge sent"`) until local midnight. **No undo** — owner's decision on 30 Sep (the original brief required undo). Done rows do nothing when tapped. Queued to the Sheet as `kind: "update"` carrying only those three fields.
- **Quoted** → `status` = `quoted`, `quoted_on` = today, and reminders restart on the quote-chase track from today (`schedule_anchor` = today, stage 0).
- **Won / Lost** → `status` = `won`/`lost`, `closed_on` = today, `next_action_date` = "". Reminders stop; the row shows under Done today as "Closed — won/lost" until midnight, then disappears.
- Quoted, Won and Lost can't be undone, so each needs **two taps**: the first turns the button into an accent-filled "Confirm" for 4 seconds.

Empty state: centred, muted — "No leads yet." (no leads on the phone at all) or "No open leads."

Leads are never deleted from the phone (closed ones are kept for the site chips in New entry), so the list keeps its speed work: row labels computed without building the WhatsApp message, one shared date formatter, rows built in a DocumentFragment, one delegated click listener (rows carry `data-id`; opening a panel touches only that row, with no re-render), and `content-visibility: auto`. Measured at 6× CPU throttle (budget Android, 28 Sep): 1,000 leads ≈ 45ms to show the list, 3,000 ≈ 100ms.

---

**REMINDER SCHEDULE (automatic — no manual "nudge interval" picker)**

An open lead is on one of two tracks, each with its own templates:

- **Nudges** (status `new`): `nudge_2day`, `nudge_1week`, `nudge_2week`, then `nudge_monthly`. Gaps: `REMINDER_SCHEDULE_DAYS` = **[2, 7, 14]**, then every `MONTHLY_INTERVAL_DAYS` (**30**).
- **Quote chases** (status `quoted`): `quote_2day`, `quote_1week`, `quote_2week`, then `quote_monthly`. Gaps: `QUOTE_SCHEDULE_DAYS` = **[2, 7, 14]**, then every 30.

**Each gap counts from the previous message actually sent** (for stage 0: from the contact, or from tapping Quoted). This changed on 30 Sep from the original "days after the visit" anchor. The owner's words: "once the first message is sent, you can only send the next one after 2 days followed by 1 week, 2 weeks and then monthly". So a late reminder never makes the next one due sooner. Labels come from the gaps (`7` → "1-week", `2` → "2-day"; past the end of the list → "Monthly").

Every New entry for a site resets its track to stage 0, counting from that day. A `quoted` site restarts its quote chases; a `won`/`lost` site reopens as `new`.

---

**TAB 2 — NEW ENTRY**

Heading: "New entry" ("Edit lead" when editing). Fields top to bottom:

1. **Type of contact** — two single-select chips, default **Site visit** (`site_visit`), or **Walk-in** (`walkin`). (Round 1's Field visit / Inbound were removed on 30 Sep at the owner's request; old rows may still say `visit`/`inbound`, and editing such a lead keeps that value unless a chip is tapped.) Picks the first-message template (`first_site_visit` / `first_walkin`). Saved as `visit_type` (this contact) and, for a new lead, `source` (how it first came in — kept on later contacts).

2. **Phone.** Static "+91" prefix, then input. `type="tel"`, `inputmode="numeric"`. Accept exactly 10 digits, allow spaces while typing, strip them on save. Store as `+91XXXXXXXXXX`. Largest text on the screen, ~24px. Reject if not 10 digits, with an inline message — no alert() dialogs anywhere in this app. Below it: the duplicate-check line and the **site chips** (see DUPLICATE CHECK).

3. **Contact name** and **Venue name**, side by side on one row, underline-style inputs.

4. **Venue type** — dropdown from `CONFIG.VENUE_TYPES`: Hotel, Shack, Restaurant, Bar, Pub, Club, Home (Stereo), Home (Surround), Other. Optional.

5. **Venue size (feet)** — Length, Breadth, Height, Area sq ft: four small numeric inputs, each labelled underneath. Area fills itself in as round(L × B) unless typed by hand. All optional; saved as digits and decimal point only.

6. **Location** (free, no API key or account):
   - **"Pin my current location"** runs two requests together (fixed 30 Sep, round 3):
     - a quick rough fix (`getCurrentPosition`, `enableHighAccuracy: false`, `maximumAge` 2 min), so something shows in a second or two;
     - the GPS (`watchPosition`, high accuracy, no timeout option), which keeps refining.
   - The most precise fix is kept, with "· improving…" shown while it searches. It stops once within 20m, or after **60s**; tapping the button again ("Finding location… tap to stop") stops it early.
   - The result reads `15.587300, 73.744200 · ±8 m · Open in Maps`, with a small **OpenStreetMap embed** (iframe, loaded only when online). GPS works without signal; the first use asks location permission.
   - **Every failure says why:** blocked (code 1 — with iPhone or Android settings steps), location off (code 2), or nothing within 60s (a rough fix is kept if one arrived).
   - **"…or paste a Google Maps link"** is for walk-ins, where the rep isn't at the site. Coordinates are read from links containing `@lat,lng` or `q=lat,lng`; short `maps.app.goo.gl` links are saved as-is.
   - Saved as `location` ("lat, lng", 6 decimals), `location_accuracy_m`, and `map_link` (the pasted link, or `https://www.google.com/maps?q=lat,lng`).
   - Picking a known site pre-fills its location, but the map preview for it loads **only when "Show map" is tapped**. That way saved customers' coordinates aren't sent to OpenStreetMap just because a number was typed.
   - **The map preview is locked down** (owner asked for "the highest level of safety", 30 Sep round 4). The iframe has:
     - `sandbox="allow-scripts"`: no same-origin, popups, top navigation or forms, so it can't touch the app, localStorage or the passcode;
     - `credentialless`: no cookies (Chrome; ignored elsewhere);
     - `referrerpolicy="no-referrer"`: OSM isn't told the app's address;
     - `allow="geolocation 'none'; camera 'none'; microphone 'none'"`.

     OSM does receive the map area and marker coordinates and the phone's IP address (unavoidable to draw the map). It receives no names, numbers or other lead data. The owner chose to keep the preview on this basis; removing it is a one-line change if privacy needs tighten.

7. **Enquiry** — chips from `CONFIG.ENQUIRIES`, **multi-select**, default Sales: Sales / Service / Acoustics / Automation / Rental (3-per-row grid). Selected chips are navy with white text. At least one is required (inline error). Saved as e.g. `"sales, acoustics"`, in config order.

8. **Type of music** — chips from `CONFIG.MUSIC_TYPES`, **multi-select**, optional: Background / Live Band / Duo / Trio / DJ. Saved as `music`, e.g. `"Background, DJ"`, in config order. Picking a known site pre-fills it.

9. **Photos** — room-based: every room has 6 slots, `CONFIG.ROOM_LABELS` = **FRONT WALL, LEFT WALL, RIGHT WALL, BACK WALL, CEILING, OVERVIEW**. Labels are upper-cased in code, so they are always capitals on screen, in uploads and in Drive filenames. Shown 3 per row.
   - **"+ Add another room"** appends another full set and can be tapped repeatedly.
   - When there is more than one room, each has a heading `ROOM n` with a **"Remove room"** link. An empty room goes at once; a room with photos needs a second tap ("Tap again to remove its photos", 4s). The rooms after it renumber.
   - Each slot opens the camera via `<input type="file" accept="image/*" capture="environment">`. Filled slots show the thumbnail with the label underneath; empty slots show a dashed border. Tapping a filled slot offers retake. All photos optional, never block submission.

10. **Note** — one full-width text input, placeholder "Note — zones, music, deadline". Plain text field so the phone keyboard's own dictation works. Do not build a recorder.

11. **Review button** — full width, navy, pill-shaped, reads "Review" ("Review changes" when editing; "Preparing photos…" and disabled while any photo is compressing).

**Review, then confirm (added 30 Sep, round 2 — nothing is saved or sent before Confirm):**
1. **Review** validates the phone and at least one enquiry, then replaces the form with a **review list** (heading "Check and send" / "Check changes"). It shows: type of contact, phone, site (existing / new, when the number has sites), contact, venue, venue type, size, location, enquiry, music, photos per room, note — empty ones as "—".
2. **Edit** returns to the form with everything kept. **Send to +91 98765 43210** (new entry) or **Save changes** (edit) confirms.
3. Confirming a new entry:
   - **Pick the lead:** the selected site chip (this phone's lead, or adopt the Sheet row's `lead_id`/`created_at`/`status`/`source`/`quoted_on`), or a new lead for "+ New site" or an unknown number. If the phone and the Sheet disagree on status, the further-along one wins (new < quoted < won/lost); a won/lost site then reopens as `new`.
   - **Reset its reminders:** `schedule_anchor` = today, `reminder_stage` = 0, `last_contacted` = today, `next_action_date` = today + the first gap of its track.
   - **Save to the offline queue** (row + one item per photo), then send in the background (see OFFLINE).
   - **Open WhatsApp** with `first_<type of contact>` within the Confirm tap (phones block it otherwise). `{services}` = the chosen enquiries' phrases from `CONFIG.ENQUIRIES`, joined as "a, b and c".
   - **Reset the form** and switch to the Follow-ups tab.

Never block submission on photos.

---

**PHOTO COMPRESSION**

Before upload, in a canvas: resize so the longest edge is max 1600px, export JPEG at quality 0.7. Convert to base64 for the POST. This is not optional — raw phone photos will fail on venue wifi.

Implementation details (as built): the file is read via an object URL (not FileReader), and each photo produces two JPEGs — the 1600px upload and a 192px thumbnail used for the on-screen slot (showing the 1600px image in a small slot would hold ~8MB of decoded memory per photo). Canvases are zeroed after use (iPhone memory), and an out-of-memory `"data:,"` result counts as a failure. While any photo is compressing, Send is disabled and reads "Preparing photos…", so a photo can't be dropped or leak into the next visit's form. A photo that can't be decoded leaves the slot as it was with a red "Try again" caption, never blocking submission. Each slot tracks its newest attempt, so a slow earlier shot can't overwrite a quick retake.

---

**DUPLICATE CHECK / OWNERS WITH SEVERAL SITES**

Each site (venue) is its own lead, with its own `lead_id`, Sheet row and reminders. An owner's sites share the phone number.

As soon as the phone field has 10 digits (on input, not on blur), the app shows this number's sites as chips under the phone field. Sites already on this phone appear **instantly**, even offline. They are then merged with the Sheet's rows from a passcode-protected `kind: "lookup"` POST (needs script v5; the answer is ignored if the number changed meanwhile). Chips: one per site (venue name, plus "· won"/"· lost" if closed), newest first, then **"+ New site"**. The newest site is pre-selected unless the rep taps another.

Above the chips, one muted line: `Priya · Anjuna Social · last contacted 12 Mar` (one site) or `Priya · 2 sites · last contacted 12 Mar`.

Selecting a site fills in contact name, venue, venue type and size from it. "+ New site" keeps the contact name and clears the venue fields. The lookup fails silently if it errors — never block the form on it. *(Known weakness: each Apps Script call takes 4–10s, so a site known only to the Sheet can appear after Send — see NEXT, P2.)*

---

**OFFLINE**

Register a service worker that caches the app shell with a cache-first strategy, so the app opens instantly and works with no signal.

Updates are automatic — there is no cache version to bump. On every app open (navigation), the service worker serves the saved copy immediately, then in the background re-downloads all shell files (`cache: "no-cache"`, so unchanged files are cheap 304s) and compares them byte-for-byte with the saved copy. If anything differs, the complete set is saved as a new cache (`just-audio-shell-<timestamp>`) and only then are older caches deleted — never a half-updated mix; any failed download keeps the old copy. The new version runs from the next open. `app.js` also calls `registration.update()` on load so changes to `sw.js` itself are picked up promptly.

Every submit is saved to an offline queue on the phone **first**, then sent — never sent-then-saved-on-failure. The queue lives in **IndexedDB**, not localStorage: localStorage caps at ~5MB, which two photo-heavy visits fill, silently losing leads (this was a real bug in the first build, caught by stress testing).

Each visit is queued as small separate uploads: one `kind: "lead"` item (the Sheet row), then one `kind: "photo"` item per photo, each with a fixed `photo_id`. Items go one at a time, oldest first, and are deleted only after the Apps Script replies `{ok: true}`. No signal / timeout / Google error page → stop and retry later. `{ok: false}` → keep it, carry on with the rest, retry that item after 10 minutes or on next app open. Only one retry runs at a time (plus `navigator.locks` across tabs). Before sending anything, the app checks the Apps Script's version: leads, updates and lookups need **v5+**, photos v2+, passcode checks v4+. An out-of-date deployment therefore never receives a request it would misread, or save without the new columns; the item waits in the queue and is retried after 10 minutes or on the next app open. The version is **remembered in localStorage** (`ja_server_v`) and refreshed from the `v` on every script answer, so the `GET ?v=1` call only happens when the remembered version is too old. A lead's row and its updates reach the Sheet **in order**: once one is held back (refused or waiting to retry), later items for that lead wait too in that pass. The passcode is added to each request at send time (never stored in queued items); an `auth` refusal re-locks the app and the item waits; a `busy` answer (Sheet lock timed out) retries within a minute instead of pausing 10.

Retries run on app load, on `window.online`, when the app comes back to the foreground (e.g. returning from WhatsApp), and every minute while open. Anything left in the old localStorage queue (`ja_queue`) from the first build is moved to IndexedDB on load. While anything is queued, the Follow-ups tab shows a badge counting visits with something still to send: "2 waiting". Clears when the queue drains.

The queue must survive the app being closed. Test this path carefully — it is the most likely thing to be silently broken.

---

**REP IDENTITY**

On first open (after the passcode screen), show a single full-screen prompt: "Your name?" with one input and a Save button. Store in localStorage, write to the `rep` column on every row. No login, no accounts, no password. Build it so a future version can filter the Follow-ups list by rep.

---

**config.js**

Every value I might change lives here and nowhere else. Comment each one in plain English. Current keys: `APPS_SCRIPT_URL`, `BROCHURE_URL` (one brochure for all services), `COMPANY_NAME`, `REMINDER_SCHEDULE_DAYS`, `MONTHLY_INTERVAL_DAYS`, `QUOTE_SCHEDULE_DAYS`, `ENQUIRIES` (key → phrase used in `{services}`), `VENUE_TYPES`, `ROOM_LABELS`, `MUSIC_TYPES`, `TEMPLATES`: `first_site_visit`, `first_walkin`, `nudge_2day`, `nudge_1week`, `nudge_2week`, `nudge_monthly`, `quote_2day`, `quote_1week`, `quote_2week`, `quote_monthly`, `survey_offer`. Placeholders: `{name} {venue} {brochure} {rep} {company} {services}`. There is no passcode here — it lives in the Apps Script's Script Properties (see PASSCODE LOCK), because this file is public.

All templates should read warm, plain Indian English, no exclamation marks, no emoji, under 60 words each. The first messages promise a quote and offer a free site survey (the site-visit one says the quote is on its way).

**Critical:** when building the `wa.me` URL, encode the whole message with `encodeURIComponent`. Line breaks must be real `\n` in the template and must survive encoding as `%0A`. A message arriving as one unbroken paragraph is a bug.

---

**APPS SCRIPT**

The complete Google Apps Script lives in `apps-script.gs`:

- `doPost` — append a new row, or update the existing row when `lead_id` is supplied. Accepts `kind: "lead"` (row only), `kind: "photo"` (one photo; skipped if its `photo_id` was already saved; links the venue folder into the row), and the first build's single all-in-one payload (row + `photos` list). Runs under a script lock (`tryLock(30000)`); if the lock can't be had, returns `{ok: false, busy: true}`, which the app treats like a network failure (retry shortly) rather than a refusal. Row lookups (`lead_id`, and `phone` for the duplicate check) read only that one column, not the whole sheet. Requires the passcode (`key`) — see PASSCODE LOCK. Also handles `kind: "verify"` (passcode check) and `kind: "lookup"` (duplicate check). Always returns `{ok: true, v: 6}` or `{ok: false, error}`
- `doPost` `kind: "update"` — Follow-ups Send/Quoted/Won/Lost: writes only the fields present, from the allow-list `reminder_stage`, `next_action_date`, `last_contacted`, `schedule_anchor`, `status`, `quoted_on`, `closed_on` (plus `updated_at`). If the row doesn't exist (deleted by hand), it answers `{ok: true, missing: true}` so the phone stops retrying. This is safe because the app always sends a lead's row before its updates. Unknown `kind` values are refused.
- `kind: "lookup"` returns `records`: up to 20 rows for that phone, newest first, each with only `lead_id`, `created_at`, `contact_name`, `venue`, `last_contacted`, `status`, `source`, `venue_type`, `length_ft`, `breadth_ft`, `height_ft`, `area_sqft`, `quoted_on`, `music`, `location`, `location_accuracy_m`, `map_link` (plus `record` = the newest, for older app copies).
- Lead upserts keep the Sheet's existing value for any column the upload leaves out, and stamp `updated_at`. The header row is extended automatically if the Sheet has fewer columns than the script.
- `doGet ?v=1` — returns `{ok: true, v: 6}` (API version check). `doGet` returns nothing else. The app needs v6 for leads and lookups, v5 for updates, v4 for the passcode check, v2 for photos.
- The script **adds columns to the Sheet if it has fewer than it needs** (`insertColumnsAfter`) — a new Google Sheet has only 26 columns (A–Z) and v6 uses 29, so writing column 27+ would otherwise fail with "coordinates of the range are outside the dimensions of the sheet".
- Photo handling — decode base64, save into a Drive folder named after the venue (inside one root folder, `Just Audio - Lead Photos`), with a subfolder per room (`Room 1`, `Room 2`, ...), each photo filed under its label as the filename (e.g. `FRONT WALL.jpg`); write the venue folder's URL into the row
- CORS handled correctly for GitHub Pages
- Return JSON always, never HTML

**Sheet columns, in this exact order:**
`lead_id` · `created_at` · `rep` · `phone` · `contact_name` · `venue` · `enquiry` · `visit_date` · `note` · `photo_folder` · `reminder_stage` · `schedule_anchor` · `next_action_date` · `last_contacted` · `status` · `source` · `venue_type` · `length_ft` · `breadth_ft` · `height_ft` · `area_sqft` · `visit_type` · `quoted_on` · `closed_on` · `updated_at` · `music` · `location` · `location_accuracy_m` · `map_link`

29 columns. `venue_type`…`updated_at` were added in v5 and `music`…`map_link` in v6, always **appended at the end** so the original order is kept. `music` is e.g. `Background, DJ`; `location` is `lat, lng`; `location_accuracy_m` is the GPS precision in metres (blank for a pasted link); `map_link` opens the spot in Google Maps. One row per site. `lead_id` is a timestamp-based string. `phone` is always `+91XXXXXXXXXX`. Dates are `YYYY-MM-DD`; `updated_at` is `YYYY-MM-DD HH:mm:ss` (script time zone), set by the script. `enquiry` is a comma-separated list (`sales, service, acoustics, automation, rental`). `reminder_stage` is an integer (0 = nothing sent yet on the current track). `schedule_anchor` is when the current track started. `status` is `new`, `quoted`, `won` or `lost` (set by the Follow-ups buttons, or edited by hand). `source` is how the lead first came in and `visit_type` is the latest contact: `site_visit` or `walkin` (rows from before 30 Sep round 2 may say `visit`, `inbound` or `qr`).

Every cell is written as **plain text** (number format `@`) except `reminder_stage` — otherwise Google Sheets converts values on write (`+91…` → a number, dates → date objects, notes starting `=`/`+` → formulas), which broke the duplicate check. The duplicate lookup also normalises rows written before this fix (numeric phones/lead_ids, Date cells) back to the formats above, matches phones on their last 10 digits, and returns the newest matching row.

---

**VISUAL DESIGN**

Minimal and typographic, in the **Just Audio brand** (30 Sep round 2, replacing the original warm palette). Brand navy `#0C4670` was sampled from the cover of `~/Desktop/Just Audio/Just_Audio_Company_Profile_Updated.pdf`. The logo is the white wordmark `~/Desktop/Just Audio/JA LOGO.png` (449×91, transparent), cropped and resized into `icons/logo.png` (52px tall, shown at 26px). Home-screen icons are the wordmark on navy.

Colours are CSS variables in `styles.css` `:root`: `--brand #0C4670` (logo bar, buttons, selected chips, headings, active nav), `--brand-soft #E7EEF4` (open row, badge), `--bg #F7F9FB`, `--text #0E1A24`, `--muted #5E6B78`, `--hairline #DCE3EA`, `--error #B3261E` (errors, armed Confirm buttons). The manifest and `theme-color` are navy.

- **Logo bar:** a navy bar across the top of the app (respects `safe-area-inset-top`) with the white logo. The passcode and name screens are full navy with the logo, white inputs and a white button.
- **Type and layout:** hairline dividers, not cards. No gradients; no icons except the tick on done rows, the dropdown ▾ and the camera affordance. Generous whitespace. System font stack everywhere; headings in navy semibold (the serif was dropped to match the brand).

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

**SESSION LOG — 30 SEP 2026**

The owner's feature round, plus fixes from the plan below. **Live:** Apps Script v5 deployed by the owner and confirmed, then the app pushed (30 Sep).

- Multiple enquiries per lead; Automation and Rental added. A single `first_<contact type>` template with `{services}` replaces the three per-enquiry first messages.
- Single brochure (`BROCHURE_URL`).
- Type of contact chips (Field visit / Walk-in / Inbound / Site visit). The owner asked for "a section for inbound/walk in clients or site visit clients". It was built as chips at the top of New entry rather than a third tab: this keeps the two-tab layout, and photos/size stay optional for walk-ins.
- Venue type dropdown; venue size L/B/H/area (feet; area = L × B automatically).
- 6 photos per room, labels in capitals (`ROOM_LABELS`).
- Owners with multiple sites: one lead per site, site chips + "+ New site"; the lookup returns every row for the number.
- Follow-ups: tap-to-open panel (Send / Call / Quoted / Won / Lost). **Undo removed** (reverses the 28 Sep decision to keep it). Gaps count from the previous send. A quote-chase track with its own 4 templates. Won/Lost close the lead. Quoted/Won/Lost need a confirming second tap.
- Fixed KNOWN ISSUE 1 (stuck "1 waiting" for rows deleted by hand), and a lead's queued items now go in order.
- Done from the efficiency plan: P1b (script version remembered on the phone), P1c (lookup at the 10th digit, local sites instantly and offline), and the P4 guard (`saveLeads` can't throw).
- Tests: the 28 Sep harness was lost with its temporary folder. A smaller replacement is kept outside the repo at `~/Desktop/jasalesapp-tests`:
  - `gas-sim.js` runs the real `apps-script.gs` on a fake Sheet and Drive.
  - `e2e.js` runs 44 checks in headless Chrome: all the new features, the other-phone site lookup, an update for a deleted row, old-script gating, and offline with the app closed.
  - `shots.js` takes phone-size screenshots.

  To run: `cd ~/Desktop/jasalesapp-tests && npm i puppeteer-core@23 && node e2e.js`. 10 of 11 runs passed cleanly. One run stopped early and did not happen again — most likely a timing wait in the test itself.

**SESSION LOG — 30 SEP 2026 (ROUND 2)**

The owner's requests, all built and committed. **Live:** Apps Script v6 deployed by the owner and confirmed, then the app pushed (30 Sep).

- **Brand look:**
  - Navy `#0C4670` and the white Just Audio wordmark, with a logo bar on every screen.
  - Navy full-screen passcode and name screens.
  - New navy home-screen icons; manifest/theme colours set to navy.
  - Serif headings dropped. Still minimal.
- **Type of contact:** only Site visit (default) and Walk-in. `first_visit`/`first_inbound` were removed, and `first_site_visit` was rewritten to suit any on-site visit.
- **Review before saving:** "Review" shows everything; Edit or Send/Save to confirm.
- **Edit a saved lead** from its Follow-ups panel: no reminder reset, no WhatsApp.
- **Remove room** link on each room when there are 2+ (a second tap if it has photos).
- **Type of music** multi-select chips (`MUSIC_TYPES`), saved as `music`.
- **Location:** free GPS pin with precision, an OpenStreetMap preview and a Google Maps link, or a pasted Maps link for walk-ins. Saved as `location`, `location_accuracy_m`, `map_link`.
- **Apps Script v6:** 4 new columns, and the Sheet grows past 26 columns automatically.
- **Tests:** `~/Desktop/jasalesapp-tests/e2e.js` now has 59 checks. It covers the review flow, edit, room removal, music, GPS (simulated), pasted-link parsing, and the 26-column Sheet limit; 3 of 3 runs passed. `shots.js` screenshots the Follow-ups panel, the form, the review screen and the lock screen.

**SESSION LOG — 30 SEP 2026 (ROUND 3)**

- **Fixed: "Pin my current location" not working on the owner's phone.** Cause: a 15-second limit that started at the tap (so it included time spent on the permission question), after which the search was cancelled **silently** — no message, and the button just reset. A phone GPS indoors often needs longer than that for its first fix. Now there's a quick rough fix plus GPS refinement, a 60s limit, tap-to-stop, and a plain-language message for every failure (see TAB 2 → Location).
- **Tests:** new `~/Desktop/jasalesapp-tests/loc-test.js` (9 checks with a scripted fake GPS: rough → precise, denied, location off, no answer, tap to stop, late fixes ignored). It fails 8 of 9 on the previous version, and passes on this one. `e2e.js` still passes all 59.
- App-only change (Apps Script unchanged at v6).

**SESSION LOG — 30 SEP 2026 (ROUND 4)**

- The owner asked whether locations are public. Answer: no. They are stored on the phone, in the private Sheet, and returned only to passcode holders; the OSM map preview sees coordinates and IP. The owner chose to keep the preview "as long as you can ensure the highest level of safety", so:
  - the map iframe is sandboxed, credentialless and no-referrer, with no device permissions;
  - saved sites' maps load only on "Show map";
  - a Content-Security-Policy now covers the whole app (see PASSCODE LOCK).
- **Tests:**
  - `e2e.js` has 62 checks and fails on any CSP violation (new checks: no map for a saved site until asked, Show map works, sandbox present).
  - `loc-test.js` passes 9 of 9.
  - `map-shot.js` confirms the sandboxed OSM map still draws (screenshot showed Anjuna with the marker).
- App-only change (Apps Script unchanged at v6).

**KNOWN ISSUES (open, not yet fixed)**

1. ~~Stuck "1 waiting" after deleting Sheet rows by hand~~ — fixed 30 Sep (the script answers `missing: true`).
2. **No way to remove leads from a phone** except closing them (Won/Lost hides them from Follow-ups), so old test leads can be closed as Lost. Proper cleanup still needs P2.
3. **Sites known only to the Sheet can arrive after Send.** Each Apps Script call takes 4–10s. Sites on this phone now appear instantly and the lookup starts at the 10th digit, but a site logged only on *another* phone can still be missed if the rep is quick → a second row. See P2.
4. **Phones don't learn about Sheet changes** (status edited by hand, rows deleted, other reps' leads) except through the site lookup. See P2 — the new `updated_at` column is ready for it.
5. **localStorage leads have a ceiling** (~380 bytes per lead → ~6,000+ leads on Safari). `saveLeads` is now guarded, so a full storage can't stop a visit being queued; moving leads to IndexedDB is still P4.
6. **App files over the 50KB raw target** (~95KB raw after round 2) — accepted for readability; opening is from the phone's saved copy.
7. **Old-script retry delay.** If the app is pushed before the Apps Script version it needs (now v6) is deployed, entries wait in the queue and only retry every 10 minutes or on app reopen. Harmless, but deploy the script first.
8. **Edited leads' new photos** go into `Room 1`, `Room 2`… of the venue's Drive folder again (alongside the earlier ones; nothing is overwritten — duplicates are told apart by their `photo_id`).
9. **Location for walk-ins** depends on the rep pasting a Maps link; short `maps.app.goo.gl` links are saved as a link only (no coordinates), because expanding them needs a network call that Google blocks from the browser.

---

**NEXT — EFFICIENCY PLAN (planned 28 Sep 2026, not started)**

Owner's direction: **efficiency over everything.** Ordered by measured impact. Nothing here has been built yet.

*Measurements behind it:* Apps Script web-app calls from a fast connection (0.07s to google.com) took **4–10s each, one 31s** — even the trivial `?v=1` version check that touches no data, so it is Apps Script start-up + Google's redirect, not the network or the Sheet. On a 4× throttled CPU, a 12MP photo's `canvas.toDataURL` blocked the screen **136ms** (async `toBlob`: 29ms, output 25% smaller). Parsing 3,000 leads from localStorage: 3ms (not a bottleneck). Follow-ups list at 6× throttle: 3,000 leads ≈ 100ms to show, ≈ 136ms per tap.

**P1 — Cut Apps Script round trips (biggest win).** Today a visit with 11 photos = 12 POSTs (+1 version GET per session) ≈ 1–2+ minutes of uploading on good signal; each Follow-ups tap = 1 call; first unlock = 2 calls; first duplicate check of a session = 2 calls.
- **P1a Batch uploads:** a `kind: "batch"` request carrying several queue items (row + photos up to ~1–1.5MB, plus any queued updates) with a per-item result, so partial success still deletes what landed; photos stay idempotent via `photo_id`. Shrink the batch automatically after a timeout (weak wifi). Expected: 12 calls → ~3–4 per visit.
- ~~**P1b Remember the script version**~~ (done 30 Sep) in localStorage (every response already carries `v`), re-checking only when a gated request fails — removes one 4–10s call per app open, and makes first unlock and the first lookup one call each.
- ~~**P1c Start the duplicate check at the 10th digit**~~ (done 30 Sep) (on input, not on blur) — gains the seconds spent typing name/venue.
- **P1d Less work per photo in the script** (not yet measured — add a timing field to responses or read the Executions log first): each photo currently does ~5 Drive name searches (root, venue and room folders, same-name files for de-dup) plus Sheet reads/writes. Cache folder IDs (CacheService / Script Properties → `getFolderById`), de-dup via a CacheService `photo_id` record before falling back to search, write the `photo_folder` cell once per lead, and hold the script lock only for Sheet writes and folder creation (not the Drive file upload) so several reps' uploads don't queue behind each other.
- **P1e Wrong-passcode delay** (1.5s `sleep`) occupies one of Apps Script's ~30 concurrent executions; a flood of bad requests could slow real uploads. Only sleep when recent failures spike (CacheService counter).

**P2 — Pull changes from the Sheet ("sync down").** One call on app open (when idle, with signal) returning leads changed since the last pull — uses the `updated_at` column (added 30 Sep). Makes the duplicate check instant and offline (no lookup calls), brings hand-set `quoted` statuses to phones, removes rows deleted in the Sheet (fixes KNOWN ISSUES 1 and 2), and lets phones know other reps' leads. **Owner decision needed:** every phone would then hold the team's contact list (privacy trade-off) — options include syncing only this rep's leads plus a phone-number index for the duplicate check.

**P3 — Photo pipeline on the phone.** Switch `toDataURL` → async `toBlob` (≈136ms → ≈29ms of frozen screen per photo; ~1.5s → ~0.3s across 11 photos); store Blobs in IndexedDB (queue ~25% smaller) and convert to base64 only when sending; optionally resize in a Web Worker (`createImageBitmap` + `OffscreenCanvas`; Chrome, Safari 16.4+) for zero screen freeze. Base64's +33% on the wire can't be avoided with Apps Script (it only accepts text bodies; binary bodies would need a CORS preflight Apps Script can't answer). **Owner decision:** 1280px / quality 0.65 would cut uploads ~35–40% vs the brief's 1600px / 0.7.

**P4 — Phone storage.** ~~Guard `saveLeads`~~ (done 30 Sep); move leads into IndexedDB alongside P2.

**P5 — Follow-ups list growth.** Update only the tapped row instead of re-rendering the whole list; **owner decision:** archive leads (e.g. after N monthly nudges, or a won/lost status) or collapse not-due-for-2-weeks leads into a "Later (N)" group.

**P6 — Small wins.** Service worker re-checks 8 files on every open (background, ~0.1s each) — skip icons/manifest or check at most hourly; the every-minute retry timer only while something is queued; refresh the badge once per drain instead of per item.

Suggested order now: P1a + P1d (script + app) → P3 → P2 (needs owner decisions) → P4/P5/P6.

---

**TESTING**

*(The 28 Sep harness described below was lost with its temporary folder. Its 30 Sep replacement is at `~/Desktop/jasalesapp-tests` — see SESSION LOG — 30 SEP.)* Every 28 Sep change was stress-tested with a harness that is **not in this repo** (the repo is public and GitHub Pages serves every file in it). It ran from a temporary session folder, which will be deleted — **save a copy outside the repo if you want to keep it** (e.g. `~/Desktop/jasalesapp-tests`). It uses `puppeteer-core` driving the locally installed Chrome — npm is used only for the tests, never in the app.

- `gas-sim.js` — runs the real `apps-script.gs` in Node against a fake Sheet (converts values like real Sheets unless cells are plain text), fake Drive, Lock, Cache/Properties, Utilities.
- `servers.js` — serves the real app files, plus a fake Apps Script server running the real script with Google-style 302 redirects and switchable faults: dropped connections, saved-but-reply-lost, 500 error pages, delays, refused items, busy lock, older script versions.
- `gas-unit.js` — direct script tests (row upsert, photo de-dup, plain-text cells, old converted rows, updates, busy, one-column reads on 5,000 rows, passcode protection, lookup field limits).
- `e2e.js` — 24 browser scenarios (A–Y): normal visit; 6 offline visits × 11 photos (19.8MB) surviving the app being closed; terrible wifi; two app copies + retry spam; refused items; old-queue migration; app newer than script; app killed mid-upload; revisits (same phone, other phone, offline); follow-up tap/undo sync; unreadable photos; Send while compressing; retake race; thumbnail/upload sizes; double-tap; busy Sheet; due-date rule; passcode (new phone, changed passcode, old-version phones, weak passcode).
- `sw-test.js` — 7 update scenarios (no-bump updates, offline after update, dropped download, rapid reloads, upgrade from the first build).
- `rollout-test.js` — both deploy orders from the live versions.
- `perf.js` — Follow-ups/startup timing at 50–3,000 leads, 6× CPU throttle.

Each new test was also run against the previous commit to confirm it catches the bug it targets.
