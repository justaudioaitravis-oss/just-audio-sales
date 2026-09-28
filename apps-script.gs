/**
 * apps-script.gs — Google Apps Script backend for the Just Audio field
 * sales app. Paste this into the Apps Script editor attached to your
 * Google Sheet (Extensions > Apps Script), then deploy as a Web App.
 *
 * Sheet columns, in this exact order (create this header row once):
 * lead_id | created_at | rep | phone | contact_name | venue | enquiry |
 * visit_date | note | photo_folder | reminder_stage | schedule_anchor |
 * next_action_date | last_contacted | status | source
 *
 * reminder_stage  — how many automatic reminders have gone out since the
 *                    last visit (0 = none yet). Used with schedule_anchor
 *                    to work out when the next one is due.
 * schedule_anchor — the date of the visit the reminder countdown resets
 *                    from (set fresh every time a visit is logged).
 *
 * doPost  — appends a new row, or updates the existing row if lead_id
 *           already exists in the sheet; also receives photos one at a
 *           time (see doPost below).
 * doGet   — looks up a lead by phone number, returns it as JSON, or
 *           { found: false } if there is no match.
 */

const SHEET_NAME = "Leads";
const DRIVE_ROOT_FOLDER_NAME = "Just Audio - Lead Photos";

const COLUMNS = [
  "lead_id", "created_at", "rep", "phone", "contact_name", "venue",
  "enquiry", "visit_date", "note", "photo_folder", "reminder_stage",
  "schedule_anchor", "next_action_date", "last_contacted", "status", "source"
];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Bumped when the app and this script change how they talk to each other.
// The app asks for this (?v=1) before sending photos one at a time, so an
// out-of-date deployment can never receive a kind of upload it doesn't
// understand.
const API_VERSION = 2;

// ---------------------------------------------------------------------
// doGet — duplicate check by phone number: ?phone=+91XXXXXXXXXX
//         version check: ?v=1
// ---------------------------------------------------------------------

function doGet(e) {
  try {
    if (e.parameter.v) return jsonResponse_({ ok: true, v: API_VERSION });

    const phone = e.parameter.phone;
    if (!phone) return jsonResponse_({ found: false });

    const sheet = getSheet_();
    const data = sheet.getDataRange().getValues();
    const phoneCol = COLUMNS.indexOf("phone");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][phoneCol]) === phone) {
        const record = {};
        COLUMNS.forEach((col, idx) => { record[col] = data[i][idx]; });
        return jsonResponse_({ found: true, record: record });
      }
    }
    return jsonResponse_({ found: false });
  } catch (err) {
    return jsonResponse_({ found: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------
// doPost — the app sends each visit as small separate uploads:
//   { kind: "lead", ...row fields }   create or update the lead's row
//   { kind: "photo", lead_id, venue, photo_id, room, label, dataUrl }
//                                     save one photo, link its folder
// Older versions of the app sent everything in one go (row fields plus a
// "photos" list, no "kind") — that is still accepted.
//
// Always answers { ok: true } or { ok: false, error }. The app only removes
// an upload from the phone's queue after it sees ok: true.
//
// A script lock makes simultaneous uploads (two reps at once) take turns,
// so two uploads for the same lead can't both append a new row.
// ---------------------------------------------------------------------

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const payload = JSON.parse(e.postData.contents);
    let result;
    if (payload.kind === "photo") {
      result = savePhotoItem_(payload);
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

// Returns the sheet row number (1-based) holding this lead_id, or 0.
function findLeadRow_(sheet, leadId) {
  const data = sheet.getDataRange().getValues();
  const col = COLUMNS.indexOf("lead_id");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col]) === String(leadId)) return i + 1;
  }
  return 0;
}

// Writes the lead's row — updating it if the lead_id already exists,
// otherwise appending a new one. The photo folder link is only replaced
// when this upload brought a new one, never blanked.
function upsertLead_(payload, photoFolderUrl) {
  const sheet = getSheet_();
  const folderCol = COLUMNS.indexOf("photo_folder");
  const row = COLUMNS.map((col) => {
    if (col === "photo_folder") return photoFolderUrl || "";
    return payload[col] !== undefined ? payload[col] : "";
  });

  const rowNum = findLeadRow_(sheet, payload.lead_id);
  if (rowNum) {
    if (!photoFolderUrl) row[folderCol] = sheet.getRange(rowNum, folderCol + 1).getValue();
    sheet.getRange(rowNum, 1, 1, COLUMNS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return { updated: !!rowNum, photo_folder: row[folderCol] };
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
  if (rowNum) sheet.getRange(rowNum, COLUMNS.indexOf("photo_folder") + 1).setValue(folderUrl);

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
