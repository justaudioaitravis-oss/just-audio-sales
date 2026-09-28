/**
 * apps-script.gs — Google Apps Script backend for the Just Audio field
 * sales app. Paste this into the Apps Script editor attached to your
 * Google Sheet (Extensions > Apps Script), then deploy as a Web App.
 *
 * Sheet columns, in this exact order (create this header row once):
 * lead_id | created_at | rep | phone | contact_name | venue | enquiry |
 * visit_date | note | photo_folder | nudge_interval | next_action_date |
 * last_contacted | status | source
 *
 * doPost  — appends a new row, or updates the existing row if lead_id
 *           already exists in the sheet.
 * doGet   — looks up a lead by phone number, returns it as JSON, or
 *           { found: false } if there is no match.
 */

const SHEET_NAME = "Leads";
const DRIVE_ROOT_FOLDER_NAME = "Just Audio - Lead Photos";

const COLUMNS = [
  "lead_id", "created_at", "rep", "phone", "contact_name", "venue",
  "enquiry", "visit_date", "note", "photo_folder", "nudge_interval",
  "next_action_date", "last_contacted", "status", "source"
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

// ---------------------------------------------------------------------
// doGet — duplicate check by phone number: ?phone=+91XXXXXXXXXX
// ---------------------------------------------------------------------

function doGet(e) {
  try {
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
// doPost — create or update a lead row
// ---------------------------------------------------------------------

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const sheet = getSheet_();

    let photoFolderUrl = "";
    if (payload.photos && payload.photos.length > 0) {
      photoFolderUrl = savePhotos_(payload.venue || "Unknown venue", payload.photos);
    }

    const row = COLUMNS.map((col) => {
      if (col === "photo_folder") return photoFolderUrl;
      return payload[col] !== undefined ? payload[col] : "";
    });

    const data = sheet.getDataRange().getValues();
    const lead_idCol = COLUMNS.indexOf("lead_id");
    let updated = false;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][lead_idCol]) === String(payload.lead_id)) {
        // Keep the existing photo folder if this update has no new photos.
        if (!photoFolderUrl) row[COLUMNS.indexOf("photo_folder")] = data[i][COLUMNS.indexOf("photo_folder")];
        sheet.getRange(i + 1, 1, 1, COLUMNS.length).setValues([row]);
        updated = true;
        break;
      }
    }

    if (!updated) {
      sheet.appendRow(row);
    }

    return jsonResponse_({ ok: true, updated: updated, photo_folder: photoFolderUrl });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------
// Photo handling — decode base64 JPEGs, save into a Drive folder named
// after the venue (inside one root folder), return the folder URL.
// ---------------------------------------------------------------------

function savePhotos_(venueName, base64Photos) {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER_NAME);
  const venueFolder = getOrCreateFolder_(root, venueName);

  base64Photos.forEach((dataUrl, idx) => {
    const commaIdx = dataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl;
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, "image/jpeg", `photo-${Date.now()}-${idx}.jpg`);
    venueFolder.createFile(blob);
  });

  return venueFolder.getUrl();
}

function getOrCreateFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}
