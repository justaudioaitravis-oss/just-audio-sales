/**
 * apps-script.gs — Google Apps Script backend for the Just Audio field
 * sales app. Paste this into the Apps Script editor attached to your
 * Google Sheet (Extensions > Apps Script), then deploy as a Web App.
 *
 * Sheet columns, in this exact order (the header row is written, and
 * extended with any new columns, automatically):
 * lead_id | created_at | rep | phone | contact_name | venue | enquiry |
 * visit_date | note | photo_folder | reminder_stage | schedule_anchor |
 * next_action_date | last_contacted | status | source | venue_type |
 * length_ft | breadth_ft | height_ft | area_sqft | visit_type | quoted_on |
 * closed_on | updated_at | music | location | location_accuracy_m | map_link
 *
 * One row per site: an owner with several venues has one row per venue,
 * all with the same phone number.
 *
 * enquiry         — one or more of sales, service, acoustics, automation,
 *                    rental, e.g. "sales, acoustics".
 * reminder_stage  — how many automatic messages have gone out since the
 *                    last contact, or since it was quoted (0 = none yet).
 * schedule_anchor — the date that countdown started from.
 * status          — new, quoted, won or lost. Won/lost stop the reminders.
 * source          — how the lead first came in: visit, walkin, inbound or
 *                    site_visit. visit_type is the same for the latest contact.
 * updated_at      — when the script last changed the row.
 * music           — e.g. "Background, DJ".
 * location        — "latitude, longitude" from the phone's GPS (or read
 *                    from a pasted Maps link); location_accuracy_m is how
 *                    precise the GPS fix was; map_link opens it in Google Maps.
 *
 * doPost  — everything the app does: checking the passcode, the
 *           duplicate-number lookup, saving leads, photos and Follow-ups
 *           updates (see doPost below).
 * doGet   — only answers the version check (?v=1). It never returns data.
 *
 * PASSCODE — IMPORTANT
 * The passcode is kept here, in the script's private settings, NOT in the
 * app's code (which is public on GitHub). Every request from the app must
 * carry it, or the script refuses to read or write anything.
 * To set or change it: in the Apps Script editor, click the gear icon
 * (Project Settings) → Script Properties → Add script property (or edit the
 * existing one): Property = PASSCODE, Value = your passcode.
 * It must be at least 8 characters — shorter ones are refused, because a
 * short code can be guessed. Changing it takes effect immediately (no
 * redeploy needed); each phone will ask for the new one once.
 */

const SHEET_NAME = "Leads";
const DRIVE_ROOT_FOLDER_NAME = "Just Audio - Lead Photos";

const COLUMNS = [
  "lead_id", "created_at", "rep", "phone", "contact_name", "venue",
  "enquiry", "visit_date", "note", "photo_folder", "reminder_stage",
  "schedule_anchor", "next_action_date", "last_contacted", "status", "source",
  // Added in version 5 — always at the end, so existing columns keep their places.
  "venue_type", "length_ft", "breadth_ft", "height_ft", "area_sqft",
  "visit_type", "quoted_on", "closed_on", "updated_at",
  // Added in version 6.
  "music", "location", "location_accuracy_m", "map_link"
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  // A new Sheet has 26 columns (A to Z); the app needs more.
  if (sheet.getMaxColumns() < COLUMNS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), COLUMNS.length - sheet.getMaxColumns());
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  } else if (sheet.getLastColumn() < COLUMNS.length) {
    // A Sheet made by an older version: add the new column headings.
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const MIN_PASSCODE_LENGTH = 8;
const WRONG_PASSCODE_DELAY_MS = 1500; // slows down anyone trying to guess it

// Returns null if the request carries the right passcode, otherwise the
// refusal to send back. A wrong passcode waits before answering, so the
// passcode can't be guessed quickly.
function checkPasscode_(key) {
  const passcode = PropertiesService.getScriptProperties().getProperty("PASSCODE") || "";
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    return { ok: false, auth: true, setup: true, error: "PASSCODE script property missing or under 8 characters" };
  }
  if (key === passcode) return null;
  Utilities.sleep(WRONG_PASSCODE_DELAY_MS);
  return { ok: false, auth: true, error: "Wrong passcode" };
}

// Bumped when the app and this script change how they talk to each other.
// The app asks for this (?v=1) before sending photos (needs 2+) or
// Follow-ups updates (needs 3+), so an out-of-date deployment can never
// receive a kind of upload it doesn't understand. Version 4 added the
// passcode check. Version 5 added venue details, several sites per phone
// number, multiple enquiries, quoted / won / lost, and flexible updates —
// the app sends leads, updates and lookups only to version 5+. Version 6
// added music and location — the app sends leads and lookups only to 6+.
const API_VERSION = 6;

// Every cell is written as plain text except reminder_stage (a number).
// Without this, Google Sheets "helpfully" converts values as they're
// written: +919876543210 becomes the number 919876543210, 2026-09-28
// becomes a date, and a note starting with = or + becomes a formula —
// which breaks the duplicate check and garbles what the app reads back.
const NUMBER_FORMATS = COLUMNS.map((col) => (col === "reminder_stage" ? "0" : "@"));

// ---------------------------------------------------------------------
// doGet — version check only: ?v=1. Needs no passcode and reveals nothing
// about any lead. (The phone-number lookup used to be here, open to anyone
// with the script's address — it is now a passcode-protected doPost.)
// ---------------------------------------------------------------------

function doGet(e) {
  if (e.parameter.v) return jsonResponse_({ ok: true, v: API_VERSION });
  return jsonResponse_({ ok: false, error: "Not available" });
}

// ---------------------------------------------------------------------
// doPost — every request carries { key: <passcode>, kind: ... }:
//   { kind: "verify" }                passcode check (the lock screen)
//   { kind: "lookup", phone }         duplicate-number check (New entry)
// and the app sends each visit as small separate uploads:
//   { kind: "lead", ...row fields }   create or update the lead's row
//   { kind: "photo", lead_id, venue, photo_id, room, label, dataUrl }
//                                     save one photo, link its folder
//   { kind: "update", lead_id, ...some fields }
//                                     a Follow-ups action (Send, Quoted,
//                                     Won, Lost): changes only those cells
// Older versions of the app sent everything in one go (row fields plus a
// "photos" list, no "kind") — that is still accepted.
//
// Always answers { ok: true } or { ok: false, error }. The app only removes
// an upload from the phone's queue after it sees ok: true. A missing or
// wrong passcode answers { ok: false, auth: true } and nothing is read or
// written.
//
// A script lock makes simultaneous uploads (two reps at once) take turns,
// so two uploads for the same lead can't both append a new row. If the
// Sheet stays busy for 30 seconds, the answer is { ok: false, busy: true }
// and the app retries within a minute rather than treating it as refused.
// ---------------------------------------------------------------------

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: "Bad request" });
  }
  const refusal = checkPasscode_(payload.key);
  if (refusal) return jsonResponse_(refusal);

  if (payload.kind === "verify") return jsonResponse_({ ok: true, v: API_VERSION });
  if (payload.kind === "lookup") return jsonResponse_(lookupPhone_(payload.phone));

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonResponse_({ ok: false, busy: true, error: "Sheet busy" });
  try {
    let result;
    if (payload.kind === "photo") {
      result = savePhotoItem_(payload);
    } else if (payload.kind === "update") {
      result = updateFollowup_(payload);
    } else if (payload.kind && payload.kind !== "lead") {
      throw new Error("Unknown upload kind: " + payload.kind);
    } else {
      let photoFolderUrl = "";
      if (payload.photos && payload.photos.length > 0) {
        photoFolderUrl = savePhotos_(payload.venue || "Unknown venue", payload.photos);
      }
      result = upsertLead_(payload, photoFolderUrl);
    }
    result.ok = true;
    result.v = API_VERSION;
    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Duplicate-number check: every site (row) with this phone number, newest
// first. Returns only what the New entry form needs — never the notes,
// photo folder, or anything else about the lead.
const LOOKUP_FIELDS = [
  "lead_id", "created_at", "contact_name", "venue", "last_contacted", "status", "source",
  "venue_type", "length_ft", "breadth_ft", "height_ft", "area_sqft", "quoted_on",
  "music", "location", "location_accuracy_m", "map_link"
];
const MAX_SITES = 20;

function lookupPhone_(phone) {
  try {
    if (!phone) return { ok: true, found: false };
    const sheet = getSheet_();
    const wanted = last10Digits_(phone);
    const rowNums = findRows_(sheet, "phone", (v) => last10Digits_(v) === wanted, MAX_SITES);
    if (rowNums.length === 0) return { ok: true, found: false };
    const records = rowNums.map((rowNum) => {
      const full = readRecord_(sheet.getRange(rowNum, 1, 1, COLUMNS.length).getValues()[0]);
      const record = {};
      LOOKUP_FIELDS.forEach((col) => { record[col] = full[col]; });
      return record;
    });
    // "record" (the newest) is for phones still running the older app.
    return { ok: true, found: true, records: records, record: records[0] };
  } catch (err) {
    return { ok: false, found: false, error: String(err) };
  }
}

// Compares phone numbers however the cell stored them: "+919876543210",
// the number 919876543210 (older rows written before plain-text cells),
// or with spaces.
function last10Digits_(value) {
  return String(value).replace(/\D/g, "").slice(-10);
}

// Turns a sheet row into the record the app expects: dates as
// YYYY-MM-DD, phone as +91XXXXXXXXXX, lead_id as text — including rows
// written before cells were plain text, where Sheets converted them.
function readRecord_(values) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const record = {};
  COLUMNS.forEach((col, idx) => {
    let v = values[idx];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, "yyyy-MM-dd");
    else if (col === "phone" && v !== "") v = "+91" + last10Digits_(v);
    else if (col === "reminder_stage") v = Number(v) || 0;
    else v = String(v);
    record[col] = v;
  });
  return record;
}

// Writes a whole lead row as plain text (see NUMBER_FORMATS above).
function writeRow_(sheet, rowNum, row) {
  const range = sheet.getRange(rowNum, 1, 1, COLUMNS.length);
  range.setNumberFormats([NUMBER_FORMATS]);
  range.setValues([row]);
}

// Writes one cell of a lead's row, in that column's format.
function writeCell_(sheet, rowNum, col, value) {
  const range = sheet.getRange(rowNum, COLUMNS.indexOf(col) + 1);
  range.setNumberFormat(NUMBER_FORMATS[COLUMNS.indexOf(col)]);
  range.setValue(value);
}

// Returns the row number (1-based) of the newest row whose value in
// column `col` passes `matches`, or 0 if none does. Reads only that one
// column rather than the whole sheet, so lookups stay quick as the sheet
// grows into thousands of rows.
function findRow_(sheet, col, matches) {
  return findRows_(sheet, col, matches, 1)[0] || 0;
}

// The same, but up to `limit` matching rows, newest first.
function findRows_(sheet, col, matches, limit) {
  const found = [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return found;
  const values = sheet.getRange(2, COLUMNS.indexOf(col) + 1, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0 && found.length < limit; i--) {
    if (matches(values[i][0])) found.push(i + 2);
  }
  return found;
}

function nowStamp_() {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
}

// Returns the row number (1-based) holding this lead_id, or 0.
function findLeadRow_(sheet, leadId) {
  const wanted = String(leadId);
  return findRow_(sheet, "lead_id", (v) => String(v) === wanted);
}

// Writes the lead's row — updating it if the lead_id already exists,
// otherwise appending a new one. On an update, any column the upload
// didn't include (e.g. from a phone still on an older app) keeps what the
// Sheet already had; the photo folder link is only replaced when this
// upload brought a new one, never blanked.
function upsertLead_(payload, photoFolderUrl) {
  const sheet = getSheet_();
  const rowNum = findLeadRow_(sheet, payload.lead_id);
  const existing = rowNum ? sheet.getRange(rowNum, 1, 1, COLUMNS.length).getValues()[0] : null;
  const row = COLUMNS.map((col, idx) => {
    if (col === "updated_at") return nowStamp_();
    if (col === "photo_folder" && photoFolderUrl) return photoFolderUrl;
    if (col !== "photo_folder" && payload[col] !== undefined) return payload[col];
    return existing ? existing[idx] : "";
  });
  writeRow_(sheet, rowNum || sheet.getLastRow() + 1, row);
  return { updated: !!rowNum, photo_folder: row[COLUMNS.indexOf("photo_folder")] };
}

// A Follow-ups action: Send (reminder_stage, next_action_date,
// last_contacted), Quoted (status, quoted_on, schedule_anchor, ...), Won
// or Lost (status, closed_on). Only the cells in this list that the
// upload includes are changed, so nothing newer — like a later visit from
// another phone — is overwritten.
const UPDATE_FIELDS = [
  "reminder_stage", "next_action_date", "last_contacted", "schedule_anchor",
  "status", "quoted_on", "closed_on"
];

function updateFollowup_(payload) {
  const sheet = getSheet_();
  const rowNum = findLeadRow_(sheet, payload.lead_id);
  // No row: it was deleted from the Sheet by hand. Nothing to update, so
  // say ok — otherwise the phone would retry forever ("1 waiting"). The
  // app always sends a lead's row before its updates.
  if (!rowNum) return { missing: true };
  UPDATE_FIELDS.forEach((col) => {
    if (payload[col] !== undefined) writeCell_(sheet, rowNum, col, payload[col]);
  });
  writeCell_(sheet, rowNum, "updated_at", nowStamp_());
  return { updated: true };
}

// Saves one photo and writes its venue folder link into the lead's row.
// If this exact photo (same photo_id) was already saved — because the
// app's first attempt got through but the reply was lost on bad signal —
// it is not saved a second time.
function savePhotoItem_(photo) {
  const venueFolder = getVenueFolder_(photo.venue || "Unknown venue");
  const roomFolder = getOrCreateFolder_(venueFolder, `Room ${photo.room || 1}`);
  const fileName = `${safeLabel_(photo.label)}.jpg`;

  let duplicate = false;
  const sameName = roomFolder.getFilesByName(fileName);
  while (sameName.hasNext()) {
    if (sameName.next().getDescription() === photo.photo_id) { duplicate = true; break; }
  }
  if (!duplicate) {
    roomFolder.createFile(photoBlob_(photo.dataUrl, fileName)).setDescription(photo.photo_id);
  }

  const folderUrl = venueFolder.getUrl();
  const sheet = getSheet_();
  const rowNum = findLeadRow_(sheet, photo.lead_id);
  if (rowNum) writeCell_(sheet, rowNum, "photo_folder", folderUrl);

  return { duplicate: duplicate, photo_folder: folderUrl };
}

// ---------------------------------------------------------------------
// Photo handling — decode base64 JPEGs, save into a Drive folder named
// after the venue (inside one root folder), with one subfolder per room,
// and each photo file named after its wall/ceiling label. Returns the
// venue folder's URL.
// ---------------------------------------------------------------------

// Older app versions: every photo for a visit arrives in one upload.
function savePhotos_(venueName, photos) {
  const venueFolder = getVenueFolder_(venueName);

  photos.forEach((photo) => {
    const roomFolder = getOrCreateFolder_(venueFolder, `Room ${photo.room || 1}`);
    const fileName = `${safeLabel_(photo.label)}.jpg`;
    roomFolder.createFile(photoBlob_(photo.dataUrl, fileName));
  });

  return venueFolder.getUrl();
}

function getVenueFolder_(venueName) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER_NAME);
  return getOrCreateFolder_(root, venueName);
}

function safeLabel_(label) {
  return String(label || "photo").replace(/[^a-zA-Z0-9 _-]/g, "");
}

function photoBlob_(dataUrl, fileName) {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl;
  return Utilities.newBlob(Utilities.base64Decode(base64), "image/jpeg", fileName);
}

function getOrCreateFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}
