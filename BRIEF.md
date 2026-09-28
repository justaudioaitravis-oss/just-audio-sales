**BRIEF — Just Audio field sales PWA**

Build a lightweight Progressive Web App for field sales lead capture. I am not a developer — explain what you're doing in plain language and don't assume I can debug.

> **STATUS (updated 28 Sep 2026): Built and deployed.** This file now describes the app as it actually is, not just as originally requested — read this before making further changes so nothing gets rebuilt or redeployed unnecessarily.
>
> - **Live app:** `https://justaudioaitravis-oss.github.io/just-audio-sales/`
> - **GitHub repo:** `https://github.com/justaudioaitravis-oss/just-audio-sales` (public repo — GitHub Pages on the free tier requires this; see PASSCODE LOCK below for how confidentiality is handled instead)
> - **Google Sheet:** tab named `Leads`, columns match the APPS SCRIPT section below
> - **Apps Script:** deployed as a Web App, URL pasted into `config.js` → `APPS_SCRIPT_URL`. To ship a script change, edit `apps-script.gs`, paste into the Apps Script editor, then Deploy → Manage deployments → edit → **New version** → Deploy (the live URL does not change, so `config.js` never needs re-editing for a script-only change)
> - Installed to home screen on the owner's phone, behind a passcode screen (see below)
> - **Shipping any app change:** deploy Apps Script first (if changed), then upload files. No version bump needed — phones pick up changed files automatically (see OFFLINE)

**Stack constraints (strict):** Plain HTML, CSS and vanilla JavaScript. No React, no Vue, no Tailwind, no npm packages, no build step, no bundler. Total payload under 50KB excluding photos. It must open in under one second on a mid-range Android phone on weak wifi.

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

Because GitHub Pages on the free tier can only serve public sites (there is no way to keep the repo private and still use Pages), a single full-screen passcode prompt is shown once per phone before anything else — including before the rep name prompt. Correct code unlocks the app permanently on that phone (stored in localStorage); wrong code shows an inline error, no `alert()`. The code lives in `config.js` → `PASSCODE` (default `1234` — change it).

This is a soft deterrent, not real security — anyone who reads the app's public source code could find the passcode. It's meant to stop the link being casually stumbled on, not to protect sensitive data. If genuine access control is ever needed, the real fix is moving hosting to something like Cloudflare Pages + Cloudflare Access (free, email-verified login) — noted here for later, not currently built.

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

If a lead's `status` has been manually set to `"quoted"` (there's no UI control for this yet — it would need to be edited directly in the Sheet, or a future UI added), the `quote_chase` template is used instead of the staged nudge, regardless of stage.

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
4. POST to Apps Script.
5. On success, or on queueing if offline, open WhatsApp with the pre-filled first-contact message (`first_sales` / `first_service` / `first_acoustics`, matching the Enquiry chip).
6. Reset the form and switch to the Follow-ups tab.

Never block submission on photos.

---

**PHOTO COMPRESSION**

Before upload, in a canvas: resize so the longest edge is max 1600px, export JPEG at quality 0.7. Convert to base64 for the POST. This is not optional — raw phone photos will fail on venue wifi.

Implementation details (as built): the file is read via an object URL (not FileReader), and each photo produces two JPEGs — the 1600px upload and a 192px thumbnail used for the on-screen slot (showing the 1600px image in a 58px slot would hold ~8MB of decoded memory per photo). Canvases are zeroed after use (iPhone memory), and an out-of-memory `"data:,"` result counts as a failure. While any photo is compressing, Send is disabled and reads "Preparing photos…", so a photo can't be dropped or leak into the next visit's form. A photo that can't be decoded leaves the slot as it was with a red "Try again" caption, never blocking submission. Each slot tracks its newest attempt, so a slow earlier shot can't overwrite a quick retake.

---

**DUPLICATE CHECK**

When the phone field loses focus **and** contains 10 valid digits, GET the Apps Script with that number.

If a match exists, show one muted line directly below the field:
`Priya · Anjuna Social · last contacted 12 Mar`

Pre-fill name and venue from the record. On submit, update that lead's row rather than appending a new one — this also means visiting an existing venue again resets its reminder schedule to start from today's new visit (see REMINDER SCHEDULE above), which is intentional: a fresh in-person conversation restarts the follow-up clock. Silent failure if the lookup errors — never block the form on it.

If the number is in the Sheet but not on this phone (logged by another rep/phone), the phone adopts that row's `lead_id`, `created_at`, `status` and `source`, so the visit updates the existing row. A `status` found in the Sheet (e.g. `quoted`, set by hand) is always kept, never reset to `new`. If the lookup couldn't run (no signal), the phone falls back to its own lead with the same number, so an offline revisit still doesn't create a duplicate.

---

**OFFLINE**

Register a service worker that caches the app shell with a cache-first strategy, so the app opens instantly and works with no signal.

Updates are automatic — there is no cache version to bump. On every app open (navigation), the service worker serves the saved copy immediately, then in the background re-downloads all shell files (`cache: "no-cache"`, so unchanged files are cheap 304s) and compares them byte-for-byte with the saved copy. If anything differs, the complete set is saved as a new cache (`just-audio-shell-<timestamp>`) and only then are older caches deleted — never a half-updated mix; any failed download keeps the old copy. The new version runs from the next open. `app.js` also calls `registration.update()` on load so changes to `sw.js` itself are picked up promptly.

Every submit is saved to an offline queue on the phone **first**, then sent — never sent-then-saved-on-failure. The queue lives in **IndexedDB**, not localStorage: localStorage caps at ~5MB, which two photo-heavy visits fill, silently losing leads (this was a real bug in the first build, caught by stress testing).

Each visit is queued as small separate uploads: one `kind: "lead"` item (the Sheet row), then one `kind: "photo"` item per photo, each with a fixed `photo_id`. Items go one at a time, oldest first, and are deleted only after the Apps Script replies `{ok: true}`. No signal / timeout / Google error page → stop and retry later. `{ok: false}` → keep it, carry on with the rest, retry that item after 10 minutes or on next app open. Only one retry runs at a time (plus `navigator.locks` across tabs). Before any photo is sent, the app checks the Apps Script reports `v >= 2` (`GET ?v=1`), so an out-of-date deployment can never receive a photo it would misread as a lead.

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

  // Passcode lock screen — see PASSCODE LOCK section above.
  PASSCODE: "1234",

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

- `doPost` — append a new row, or update the existing row when `lead_id` is supplied. Accepts `kind: "lead"` (row only), `kind: "photo"` (one photo; skipped if its `photo_id` was already saved; links the venue folder into the row), and the first build's single all-in-one payload (row + `photos` list). Runs under a script lock (`tryLock(30000)`); if the lock can't be had, returns `{ok: false, busy: true}`, which the app treats like a network failure (retry shortly) rather than a refusal. Row lookups (`lead_id`, and `phone` in `doGet`) read only that one column, not the whole sheet. Always returns `{ok: true, v: 3}` or `{ok: false, error}`
- `doPost` `kind: "update"` — Follow-ups tap/undo: writes only `reminder_stage`, `next_action_date`, `last_contacted`; `{ok: false}` if the row doesn't exist yet (app retries). Unknown `kind` values are refused
- `doGet ?v=1` — returns `{ok: true, v: 3}` (API version check; the app needs v2+ before sending photos, v3+ before sending updates)
- `doGet` — look up by phone, return the matching row as JSON, or `{found: false}`
- Photo handling — decode base64, save into a Drive folder named after the venue (inside one root folder, `Just Audio - Lead Photos`), with a subfolder per room (`Room 1`, `Room 2`, ...), each photo filed under its label as the filename (e.g. `Front wall.jpg`); write the venue folder's URL into the row
- CORS handled correctly for GitHub Pages
- Return JSON always, never HTML

**Sheet columns, in this exact order:**
`lead_id` · `created_at` · `rep` · `phone` · `contact_name` · `venue` · `enquiry` · `visit_date` · `note` · `photo_folder` · `reminder_stage` · `schedule_anchor` · `next_action_date` · `last_contacted` · `status` · `source`

`lead_id` is a timestamp-based string. `phone` is always `+91XXXXXXXXXX`. Dates are `YYYY-MM-DD`. `reminder_stage` is an integer (0 = no reminders sent since the last visit yet). `schedule_anchor` is the visit date the reminder countdown resets from. `status` starts as `new` (manually settable to `quoted` to switch that lead's Follow-ups draft to the quote-chase template). `source` is `visit` or `qr`.

Every cell is written as **plain text** (number format `@`) except `reminder_stage` — otherwise Google Sheets converts values on write (`+91…` → a number, dates → date objects, notes starting `=`/`+` → formulas), which broke the duplicate check. `doGet` also normalises rows written before this fix (numeric phones/lead_ids, Date cells) back to the formats above, matches phones on their last 10 digits, and returns the newest matching row.

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
5. Walk through deployment one step at a time — Google Sheet, Apps Script, GitHub Pages, adding to home screen — waiting for confirmation at each step. ✅ Done via GitHub Desktop (no CLI git credentials available in this environment).

`README.md` covers: how to change the brochure URLs, how to edit the message templates, how to change the reminder schedule, how to change the passcode, how the photo rooms work, how to export the sheet to Excel, and what to do if a submission doesn't appear.
