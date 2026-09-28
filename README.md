# Just Audio — Field Sales App

A small app for your phone's home screen. No accounts, no menus — just a
Follow-ups list and a New Entry form.

This file explains the four things you're most likely to need later.

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

Example — to change the nudge message:

```js
nudge: "Hi {name}, this is {rep} from {company}, checking in on {venue}.",
```

Save the file and re-upload it the same way as above.

---

## 3. Exporting the sheet to Excel

1. Open the Google Sheet in your browser.
2. Go to **File > Download**.
3. Choose **Microsoft Excel (.xlsx)**.
4. It downloads straight to your computer — open it in Excel as normal.

You can do this any time, as often as you like — it never affects the live data.

---

## 4. If a submission doesn't appear in the sheet

The app is built to never lose a submission, even with no signal — but here's
how to check:

1. **Check the phone first.** Open the app. If the Follow-ups tab shows a
   small badge like "2 waiting", that means submissions are saved on the
   phone and are waiting for a signal to send. They will send automatically
   next time the app is opened with internet, or as soon as the phone
   reconnects. Nothing is lost — just be patient, or move somewhere with
   better signal and reopen the app.

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

If none of that explains it, the safest next step is to ask whoever set this
up to open the Apps Script editor and check **Executions** (in the left
sidebar) for any red/failed runs — that log will usually say exactly what
went wrong.
