# Just Audio — Field Sales App

A small app for your phone's home screen. No accounts, no menus — just a
Follow-ups list and a New Entry form.

This file explains the things you're most likely to need later.

---

## 1. Changing the brochure link

There is one brochure for all services. Open `config.js` in any text editor
(even Notes or a basic code editor works). Near the top you'll see:

```js
BROCHURE_URL: "BROCHURE_URL_PLACEHOLDER",
```

Replace the placeholder with the real web link, keeping the quote marks, e.g.:

```js
BROCHURE_URL: "https://justaudio.example.com/brochure",
```

Save the file. If it only lives on GitHub Pages, you'll need to re-upload the
changed file (see the GitHub Pages steps you were walked through during setup).

---

## 2. Editing the message templates

Still in `config.js`, further down, under `TEMPLATES`. Each one is the text
that gets pre-filled into WhatsApp. A few rules:

- Keep the curly-brace words like `{name}`, `{venue}`, `{brochure}`, `{rep}`,
  `{company}` exactly as they are — the app swaps in the real values
  automatically. Don't rename or remove them unless you mean to.
- Use `\n` for a line break (not a real Enter key press) — this is what keeps
  the WhatsApp message properly split into paragraphs.
- Keep the `+` signs joining the lines together, and the quote marks around
  the text.

There are four kinds of template:

- **First message**, sent the moment a New entry is saved — one per type of
  contact: `first_visit`, `first_walkin`, `first_inbound`, `first_site_visit`.
  `{services}` becomes the enquiries you picked, e.g. "a new sound system
  and acoustic treatment" (the words for each are under `ENQUIRIES`).
- **Reminders**: `nudge_2day`, `nudge_1week`, `nudge_2week`, `nudge_monthly`.
- **Quote chases**, used once a lead is marked Quoted: `quote_2day`,
  `quote_1week`, `quote_2week`, `quote_monthly`.
- `survey_offer`, not sent automatically.

Edit any of them the same way, e.g.:

```js
nudge_2day: "Hi {name}, this is {rep} from {company}, checking in on {venue}.",
```

Save the file and re-upload it the same way as above.

---

## 3. Follow-ups: reminders, Quoted, Won and Lost

Tap a lead in Follow-ups to open its buttons:

- **Send …** — opens WhatsApp with the reminder that's due. Greyed out until
  its day arrives. **A sent reminder can't be undone.**
- **Call** — phones the contact.
- **Quoted** — tap once you've sent a quote. The lead switches to quote
  chases, counting from today. If you send a revised quote, tap it again
  (it now says "Requoted") to restart them.
- **Won** / **Lost** — closes the lead: its reminders stop and it leaves the
  list (it shows under "Done today" until midnight).

Quoted, Won and Lost can't be undone either, so each needs **two taps**: the
first turns the button into "Confirm", the second does it.

Logging a New entry for a site again restarts its reminders from that day —
and reopens it if it was won or lost.

### Changing the schedule

In `config.js`:

```js
REMINDER_SCHEDULE_DAYS: [2, 7, 14],
QUOTE_SCHEDULE_DAYS: [2, 7, 14],
MONTHLY_INTERVAL_DAYS: 30,
```

Each number is the gap in days **since the previous message was sent**. So
by default: the first reminder 2 days after the first message, the next a
week after that reminder was sent, the next two weeks after that, then every
30 days. Quote chases work the same way, counting from the day you tap
Quoted. If one goes out late, the next one still waits its full gap.

---

## 4. New entry: type of contact, sites, venue details

- **Type of contact** — Field visit, Walk-in, Inbound (a call or message)
  or Site visit. It picks which first message is sent, and is saved in the
  Sheet (`source` = how the lead first came in, `visit_type` = this contact).
- **Owners with several sites** — each venue is its own lead with its own
  Sheet row and reminders; they share the owner's phone number. Once you
  type a number that's already known, its sites appear as buttons under the
  phone field, with the newest picked. Tap a different site if this is
  about that one, or **+ New site** for a venue not logged yet (the contact
  name stays, the venue details clear).
- **Venue type** — a dropdown; edit the list under `VENUE_TYPES` in `config.js`.
- **Venue size** — length, breadth and height in feet. Area fills itself
  in as length × breadth; type over it if the room isn't a rectangle.
- **Enquiry** — tap as many as apply; at least one is needed. Edit the list
  under `ENQUIRIES` in `config.js`.

---

## 5. Changing the passcode

The passcode is **not** in the app's files — those are public on GitHub, so
anything in them can be read by anyone. It's kept in the Apps Script's
private settings instead, and the script refuses to read or write anything
unless the request carries it.

To set or change it:

1. Open the Apps Script editor (from the Google Sheet: **Extensions → Apps
   Script**).
2. Click the **gear icon** (Project Settings) in the left sidebar.
3. Scroll to **Script Properties** → **Edit script properties**.
4. Add (or edit) a property called `PASSCODE` with your passcode as the
   value, then **Save script properties**.

Rules and what to expect:

- **At least 8 characters.** Shorter ones are refused (the app says the
  passcode isn't set up), because a short code can be guessed. A few words
  are easiest to type on a phone, e.g. `goa sound 2026`.
- **No redeploy needed** — a change takes effect immediately.
- **Every phone asks for the new one once**, the next time it talks to the
  Sheet. Anything waiting to send is kept on the phone and goes as soon as
  the new passcode is entered.
- **The first unlock on a phone needs signal**, because the Sheet checks
  the passcode. After that the app opens offline as usual.

To lock someone out (e.g. a rep who has left), change the passcode and give
the new one only to the people who should still have access.

---

## 6. The photo rooms

Every room has 6 labelled photo slots: FRONT WALL, LEFT WALL, RIGHT WALL,
BACK WALL, CEILING, OVERVIEW. Tapping "+ Add another room" adds another set
for a second room, and so on for as many rooms as needed. All photos are
optional and never block submission. To change the labels, edit
`ROOM_LABELS` in `config.js` — they're always shown and saved in capitals.

In the Google Drive folder, photos are organised as: **Just Audio - Lead
Photos** → venue name → Room 1 / Room 2 / etc. → one file per label.

After you take a photo, the Send button briefly says **"Preparing photos…"**
while the photo is shrunk for upload (usually under a second). Send works
again as soon as it's done — this just makes sure a photo you've taken is
never left out.

If a slot says **"Try again"** in red, the phone couldn't read that photo
(rare — usually an unusual file format). Tap the slot and retake it, or
just leave it; it never blocks sending.

---

## 7. Exporting the sheet to Excel

(Note: the app saves every cell as plain text, except `reminder_stage`, so
phone numbers keep their `+91` and dates stay as `2026-09-28`. Rows saved
before this was added may show phone numbers without the `+` — that's
harmless, the app still recognises them.)

1. Open the Google Sheet in your browser.
2. Go to **File > Download**.
3. Choose **Microsoft Excel (.xlsx)**.
4. It downloads straight to your computer — open it in Excel as normal.

You can do this any time, as often as you like — it never affects the live data.

---

## 8. If a submission doesn't appear in the sheet

The app is built to never lose a submission, even with no signal — but here's
how to check:

1. **Check the phone first.** Open the app. If the Follow-ups tab shows a
   small badge like "2 waiting", that means 2 visits still have something
   (the row, or some of their photos) saved on the phone, waiting to send.
   They send automatically: when the app opens, when you come back to it
   from WhatsApp, when signal returns, and every minute while it's open.
   Nothing is lost — just be patient, or move somewhere with better signal
   and reopen the app.

   Each visit is sent in small pieces — the Sheet row first, then one photo
   at a time — so on bad signal the row usually appears within seconds and
   the photos follow.

   If the badge **never** clears even with good signal, the Apps Script
   probably refused something (see point 5 below). The app keeps it safe
   and tries again every 10 minutes, and every time the app is reopened.

2. **Check the Apps Script URL is correct.** In `config.js`, the
   `APPS_SCRIPT_URL` value must be the exact link you got when you deployed
   the Apps Script (ending in `/exec`). If it was ever redeployed, that link
   changes and needs updating here.

3. **Check the Apps Script deployment is still "Anyone" access.** In the
   Apps Script editor: Deploy > Manage deployments > check the access level
   is still set to "Anyone". If someone changed it, the app can no longer
   reach it.

4. **Check the Google Drive folder for photos separately.** Photos are saved
   into a Drive folder named "Just Audio - Lead Photos", inside a
   subfolder named after the venue. If a row appears in the Sheet but
   photos are missing, check there — very large photos on a slow connection
   can occasionally take a little longer to finish uploading.

5. **Check the passcode.** If a phone keeps showing the passcode screen, the
   passcode was probably changed — enter the new one (see section 5).
   Nothing waiting to send is lost meanwhile.

6. **Check the Apps Script is the latest version.** The app only sends
   things once the Apps Script deployment is new enough to understand them
   (this version of the app needs Apps Script version 5). If the badge stays
   on with good signal and nothing new reaches the Sheet, the newest
   `apps-script.gs` probably hasn't been deployed yet. See
   "Shipping an update" below.

If none of that explains it, the safest next step is to ask whoever set this
up to open the Apps Script editor and check **Executions** (in the left
sidebar) for any red/failed runs — that log will usually say exactly what
went wrong.

---

## 9. Shipping an update

When anything in the app changes, do these in this order:

1. **Apps Script first** (only if `apps-script.gs` changed). Paste the new
   code into the Apps Script editor, then Deploy → Manage deployments →
   edit (pencil) → Version: **New version** → Deploy. The URL doesn't
   change, so `config.js` doesn't need touching.
2. **Then the app files** — upload the changed files to GitHub as usual.
3. **That's it.** Phones pick up changes by themselves — there's no version
   number to change. Each time the app is opened, it quietly checks GitHub
   for changed files and downloads them in the background; the **next** time
   it's opened, it's running the new version. (It only switches once every
   file has fully downloaded, so a bad connection can't leave a phone
   half-updated.) GitHub can take a few minutes to publish an upload, so if
   you're checking a change, give it five minutes, then open the app twice.
