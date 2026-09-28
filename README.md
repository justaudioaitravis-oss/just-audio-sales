# Just Audio — Field Sales App

A small app for your phone's home screen. No accounts, no menus — just a
Follow-ups list and a New Entry form.

This file explains the things you're most likely to need later.

---

## 1. Changing the brochure links

Open `config.js` in any text editor (even Notes or a basic code editor works —
you don't need anything special). Near the top you'll see:

```js
BROCHURE: {
  sales:     "BROCHURE_URL_SALES_PLACEHOLDER",
  service:   "BROCHURE_URL_SERVICE_PLACEHOLDER",
  acoustics: "BROCHURE_URL_ACOUSTICS_PLACEHOLDER"
},
```

Replace each placeholder with the real web link, keeping the quote marks, e.g.:

```js
sales: "https://justaudio.example.com/brochure",
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

There are now separate templates for each stage of the automatic follow-up
schedule (see section 3 below) — `nudge_2day`, `nudge_1week`, `nudge_2week`,
and `nudge_monthly` — plus the three first-contact ones (`first_sales`,
`first_service`, `first_acoustics`). Edit any of them the same way, e.g.:

```js
nudge_2day: "Hi {name}, this is {rep} from {company}, checking in on {venue}.",
```

Save the file and re-upload it the same way as above.

---

## 3. Changing the follow-up schedule

Also in `config.js`, this section controls how many days after a visit each
automatic reminder is due:

```js
REMINDER_SCHEDULE_DAYS: [2, 7, 14],
MONTHLY_INTERVAL_DAYS: 30,
```

By default: the first reminder is due 2 days after a visit, the second a
week after, the third two weeks after, and then it repeats every 30 days
after that for as long as the lead stays open. To change the cadence,
edit the numbers in the list (and the monthly number if you want a
different repeat gap), save, and re-upload.

Each visit resets this countdown — so if you visit the same venue again,
the schedule starts over from that new visit date.

---

## 4. Changing the passcode

The app is locked behind a simple passcode screen so the link isn't wide
open to the public. In `config.js`:

```js
PASSCODE: "1234",
```

Change the value, save, and re-upload. Anyone who already unlocked the app
on their phone won't be asked again (it only asks once per phone) — if you
change the passcode, only new phones (or phones where someone clears their
browser data) will be asked for the new one. This is a basic lock, not
strong security — good enough to keep a private tool private, not something
to rely on for sensitive information.

---

## 5. The photo rooms

Each lead gets one "Room 1" of 5 labelled photo slots (Front wall, Left
wall, Right wall, Back wall, Ceiling) built in automatically. Tapping
"+ Add another room" adds a further set of 6 labelled slots (the same 5,
plus an Overview shot) for a second room, and so on for as many rooms as
needed. All photos are optional and never block submission. To change the
labels themselves, edit `ROOM_ONE_LABELS` and `EXTRA_ROOM_LABELS` in
`config.js`.

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

## 6. Exporting the sheet to Excel

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

## 7. If a submission doesn't appear in the sheet

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

5. **Check the Apps Script is the latest version.** Photos, and the
   updates sent when you tap a Follow-ups row, are only sent once the Apps
   Script deployment is new enough to understand them. If Sheet rows are
   arriving but photos or follow-up dates never change, and the badge stays
   on, the newest `apps-script.gs` probably hasn't been deployed yet. See
   "Shipping an update" below.

If none of that explains it, the safest next step is to ask whoever set this
up to open the Apps Script editor and check **Executions** (in the left
sidebar) for any red/failed runs — that log will usually say exactly what
went wrong.

---

## 8. Shipping an update

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
