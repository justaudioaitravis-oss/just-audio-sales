

**BRIEF — Just Audio field sales PWA**

Build a lightweight Progressive Web App for field sales lead capture. I am not a developer — explain what you're doing in plain language and don't assume I can debug.

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

**Context:** Single-page app used on a phone from the home screen, in restaurants and bars in Goa. Often poor signal. Used one-handed while standing and talking to someone. Hosted on GitHub Pages. Data goes to a Google Sheet via Apps Script.

---

**LAYOUT**

Fixed bottom nav with exactly two tabs: "Follow-ups" and "New". No other navigation, no back buttons, no menus, no search. Tabs switch by showing/hiding sections — no routing, no page reloads. Active tab label is dark and semibold; inactive is muted grey.

All touch targets minimum 44px tall. Respect `env(safe-area-inset-bottom)` so the nav clears the home indicator on iPhone.

---

**TAB 1 — FOLLOW-UPS**

Heading: "Follow-ups".

Lists every lead where `next_action_date` is today or earlier, sorted most overdue first.

Each row shows two lines:
- Line 1: venue name, 18px, semibold
- Line 2: which draft will be sent, 13px, muted — e.g. "3-day nudge", "Quote chase · 4 days late"

Rows are separated by 1px hairlines, not cards.

**Tapping a row does three things in this order:**
1. Opens `https://wa.me/{phone}?text={encoded draft message}` in a new tab
2. Sets that lead's `next_action_date` to today + its `nudge_interval`, and `last_contacted` to today
3. Moves the row to a "done" group at the bottom: faded grey, tick icon, still visible

Done rows persist until local midnight. Tapping a done row **undoes** the push — restores the previous `next_action_date` and returns it to the active list. This undo is important; don't skip it.

Empty state: centred, muted — "Nothing due today."

---

**TAB 2 — NEW ENTRY**

Heading: "New entry". Fields top to bottom:

1. **Phone.** Static "+91" prefix, then input. `type="tel"`, `inputmode="numeric"`. Accept exactly 10 digits, allow spaces while typing, strip them on save. Store as `+91XXXXXXXXXX`. Largest text on the screen, ~24px. Reject on submit if not 10 digits, with an inline message — no alert() dialogs anywhere in this app.

2. **Contact name** and **Venue name**, side by side on one row, underline-style inputs.

3. **Enquiry** — three chips, single select, default "Sales": Sales / Service / Acoustics. Selected chip is dark fill with light text.

4. **Nudge again in** — small muted label above four chips, single select, default "3 days": Tomorrow / 3 days / 1 week / 1 month. Selected chip uses the accent colour. Labels must not wrap or truncate at 390px width — shrink font before you let them clip.

5. **Photos** — a single row of five equal-width slots, 58px tall. All optional. Each opens the camera via `<input type="file" accept="image/*" capture="environment">`. Captured slots show the thumbnail; empty slots show a dashed border. Tapping a filled slot offers retake.

6. **Note** — one full-width text input, placeholder "Note — zones, music, deadline". Plain text field so the phone keyboard's own dictation works. Do not build a recorder.

7. **Submit button** — full width, green, pill-shaped, label reads `Send to +91 98765 43210` using the live value of the phone field.

**On submit, in this order:**
1. Validate phone. Stop if invalid.
2. Compress photos (below).
3. POST to Apps Script.
4. On success, or on queueing if offline, open WhatsApp with the pre-filled message.
5. Reset the form and switch to the Follow-ups tab.

Never block submission on photos.

---

**PHOTO COMPRESSION**

Before upload, in a canvas: resize so the longest edge is max 1600px, export JPEG at quality 0.7. Convert to base64 for the POST. This is not optional — raw phone photos will fail on venue wifi.

---

**DUPLICATE CHECK**

When the phone field loses focus **and** contains 10 valid digits, GET the Apps Script with that number.

If a match exists, show one muted line directly below the field:
`Priya · Anjuna Social · last contacted 12 Mar`

Pre-fill name and venue from the record. On submit, update that lead's row rather than appending a new one. Silent failure if the lookup errors — never block the form on it.

---

**OFFLINE**

Register a service worker that caches the app shell with a cache-first strategy, so the app opens instantly and works with no signal.

If a submit POST fails, queue the full payload in localStorage. Retry automatically on next app load and on `window.online`. While anything is queued, show a small badge on the Follow-ups tab: "2 waiting". Clear it when the queue drains.

The queue must survive the app being closed. Test this path carefully — it is the most likely thing to be silently broken.

---

**REP IDENTITY**

On first open, show a single full-screen prompt: "Your name?" with one input and a Save button. Store in localStorage, write to the `rep` column on every row. No login, no accounts, no password. Build it so a future version can filter the Follow-ups list by rep.

---

**config.js**

Every value I might change lives here and nowhere else. Comment each one in plain English.

```js
const CONFIG = {
  APPS_SCRIPT_URL: "PASTE_APPS_SCRIPT_URL_HERE",

  // Brochure links — one per enquiry type.
  // Set all three to the same URL if there is only one page.
  BROCHURE: {
    sales:     "BROCHURE_URL_SALES_PLACEHOLDER",
    service:   "BROCHURE_URL_SERVICE_PLACEHOLDER",
    acoustics: "BROCHURE_URL_ACOUSTICS_PLACEHOLDER"
  },

  COMPANY_NAME: "Just Audio",

  NUDGE_DAYS: { tomorrow: 1, "3 days": 3, "1 week": 7, "1 month": 30 },

  // {name} {venue} {brochure} {rep} {company} are replaced at send time
  TEMPLATES: {
    first_sales: "...",
    first_service: "...",
    first_acoustics: "...",
    nudge: "...",
    quote_chase: "...",
    survey_offer: "..."
  }
};
```

Write sensible first drafts of all six templates — warm, plain Indian English, no exclamation marks, no emoji, under 60 words. The sales one should promise a quote and offer a free site survey.

**Critical:** when building the `wa.me` URL, encode the whole message with `encodeURIComponent`. Line breaks must be real `\n` in the template and must survive encoding as `%0A`. A message arriving as one unbroken paragraph is a bug.

---

**APPS SCRIPT**

Write the complete Google Apps Script too, in a separate file `apps-script.gs`:

- `doPost` — append a new row, or update the existing row when `lead_id` is supplied
- `doGet` — look up by phone, return the matching row as JSON, or `{found: false}`
- Photo handling — decode base64, save into a Drive folder named after the venue, create the folder if absent, write the folder URL into the row
- CORS handled correctly for GitHub Pages
- Return JSON always, never HTML

**Sheet columns, in this exact order:**
`lead_id` · `created_at` · `rep` · `phone` · `contact_name` · `venue` · `enquiry` · `visit_date` · `note` · `photo_folder` · `nudge_interval` · `next_action_date` · `last_contacted` · `status` · `source`

`lead_id` is a timestamp-based string. `phone` is always `+91XXXXXXXXXX`. Dates are `YYYY-MM-DD`. `status` starts as `new`. `source` is `visit` or `qr`.

---

**VISUAL DESIGN**

Restrained and typographic. Background `#FAF8F4`, text `#16150F`, muted `#6A6455`, hairlines `#DFD9CD`, accent `#B84A28`, send button green `#2F6B4F`.

Hairline dividers, not cards. No shadows, no gradients, no icons except the tick on done rows and the camera affordance. Generous whitespace. Headings in a serif; everything else in the system font stack for speed. If you use a web font, one weight only, `font-display: swap`, with a real fallback.

---

**DELIVERY**

1. Build all files.
2. Start a local server and tell me the URL to open.
3. Tell me how to switch my browser to phone view.
4. `git init` and commit once it runs.
5. **Then stop.** Walk me through deployment one step at a time — Google Sheet, Apps Script, GitHub Pages, adding to my home screen. Wait for me to confirm each step. Tell me exactly what to click. Assume I have never used any of these.

Also write `README.md` covering: how to change the brochure URLs, how to edit the message templates, how to export the sheet to Excel, and what to do if a submission doesn't appear.

