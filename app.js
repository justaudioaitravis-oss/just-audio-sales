// ============================================================================
// APP.JS — all the app's behaviour lives here. Plain vanilla JS, no build step.
//
// Plain-language map of what this file does, top to bottom:
//   1. Small date/string helpers
//   2. localStorage "database" for the passcode lock, rep's name and leads
//      (the offline queue lives in IndexedDB — see section 8)
//   3. Passcode lock screen (first open only, per phone)
//   4. Rep name prompt (first open only, per phone)
//   5. Bottom nav tab switching
//   6. Follow-ups tab: render list (every lead, with its next contact date),
//      handle tap-to-send, handle undo
//   7. New Entry tab: chips, room-based labeled photo capture + compression,
//      duplicate check, submit
//   8. Offline queue: every submission is saved on the phone first, then
//      sent in small pieces, retrying automatically until it gets through
//   9. Service worker registration
// ============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 1. Helpers
  // ---------------------------------------------------------------------

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    const y2 = dt.getFullYear();
    const m2 = String(dt.getMonth() + 1).padStart(2, "0");
    const d2 = String(dt.getDate()).padStart(2, "0");
    return `${y2}-${m2}-${d2}`;
  }

  function daysBetween(fromDateStr, toDateStr) {
    const [y1, m1, d1] = fromDateStr.split("-").map(Number);
    const [y2, m2, d2] = toDateStr.split("-").map(Number);
    const a = new Date(y1, m1 - 1, d1);
    const b = new Date(y2, m2 - 1, d2);
    return Math.round((b - a) / 86400000);
  }

  function fillTemplate(str, vars) {
    return str.replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? vars[key] : ""));
  }

  // Made once and reused: toLocaleDateString builds a new formatter on
  // every call, which adds up across a long Follow-ups list.
  const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

  function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return DAY_MONTH.format(new Date(y, m - 1, d));
  }

  // The automatic reminder cadence. Stage 0 is the first reminder after a
  // visit, stage 1 the second, and so on. Every offset counts days from the
  // visit date itself (CONFIG.REMINDER_SCHEDULE_DAYS), and once that list
  // runs out, reminders keep repeating every CONFIG.MONTHLY_INTERVAL_DAYS.
  function offsetForStage(stage) {
    const schedule = CONFIG.REMINDER_SCHEDULE_DAYS;
    if (stage < schedule.length) return schedule[stage];
    const extra = stage - schedule.length + 1;
    return schedule[schedule.length - 1] + CONFIG.MONTHLY_INTERVAL_DAYS * extra;
  }

  function stageInfo(stage) {
    switch (stage) {
      case 0: return { label: "2-day nudge", template: "nudge_2day" };
      case 1: return { label: "1-week nudge", template: "nudge_1week" };
      case 2: return { label: "2-week nudge", template: "nudge_2week" };
      default: return { label: "Monthly nudge", template: "nudge_monthly" };
    }
  }

  // ---------------------------------------------------------------------
  // 2. localStorage "database"
  // ---------------------------------------------------------------------

  const STORE_KEYS = {
    unlocked: "ja_unlocked",
    rep: "ja_rep",
    leads: "ja_leads",
    queue: "ja_queue"
  };

  function isUnlocked() {
    return localStorage.getItem(STORE_KEYS.unlocked) === "yes";
  }
  function setUnlocked() {
    localStorage.setItem(STORE_KEYS.unlocked, "yes");
  }

  function getRep() {
    return localStorage.getItem(STORE_KEYS.rep) || "";
  }
  function setRep(name) {
    localStorage.setItem(STORE_KEYS.rep, name);
  }

  function getLeads() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEYS.leads)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveLeads(leads) {
    localStorage.setItem(STORE_KEYS.leads, JSON.stringify(leads));
  }

  // The offline queue used to live in localStorage under STORE_KEYS.queue.
  // It now lives in IndexedDB (section 8) — this is only read once, to move
  // anything left over from the old version across.
  function getLegacyQueue() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEYS.queue)) || [];
    } catch (e) {
      return [];
    }
  }

  // ---------------------------------------------------------------------
  // 3. Passcode lock screen
  // ---------------------------------------------------------------------

  const passcodePromptEl = document.getElementById("passcode-prompt");
  const passcodeInput = document.getElementById("passcode-input");
  const passcodeError = document.getElementById("passcode-error");
  const passcodeSaveBtn = document.getElementById("passcode-save-btn");

  function initPasscode() {
    if (isUnlocked()) {
      initRepPrompt();
      return;
    }
    passcodePromptEl.classList.remove("hidden");
    passcodeSaveBtn.addEventListener("click", () => {
      if (passcodeInput.value === CONFIG.PASSCODE) {
        setUnlocked();
        passcodePromptEl.classList.add("hidden");
        initRepPrompt();
      } else {
        passcodeError.textContent = "Incorrect passcode.";
        passcodeInput.value = "";
        passcodeInput.focus();
      }
    });
  }

  // ---------------------------------------------------------------------
  // 4. Rep name prompt
  // ---------------------------------------------------------------------

  const repPromptEl = document.getElementById("rep-prompt");
  const repNameInput = document.getElementById("rep-name-input");
  const repSaveBtn = document.getElementById("rep-save-btn");
  const appEl = document.getElementById("app");
  const bottomNavEl = document.getElementById("bottom-nav");

  function initRepPrompt() {
    if (getRep()) {
      showApp();
      return;
    }
    repPromptEl.classList.remove("hidden");
    repSaveBtn.addEventListener("click", () => {
      const name = repNameInput.value.trim();
      if (!name) {
        repNameInput.focus();
        return;
      }
      setRep(name);
      repPromptEl.classList.add("hidden");
      showApp();
    });
  }

  function showApp() {
    appEl.classList.remove("hidden");
    bottomNavEl.classList.remove("hidden");
    renderFollowups();
    renderQueueBadge();
  }

  // ---------------------------------------------------------------------
  // 5. Bottom nav
  // ---------------------------------------------------------------------

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  function switchTab(tabId) {
    document.querySelectorAll("section.tab").forEach((s) => s.classList.toggle("active", s.id === tabId));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
    if (tabId === "tab-followups") renderFollowups();
  }

  // ---------------------------------------------------------------------
  // 6. Follow-ups tab
  // ---------------------------------------------------------------------

  const followupsListEl = document.getElementById("followups-list");
  const followupsEmptyEl = document.getElementById("followups-empty");
  const doneSectionEl = document.getElementById("done-section");
  const followupsDoneEl = document.getElementById("followups-done");

  function clearStaleDone(leads) {
    const today = todayStr();
    let changed = false;
    leads.forEach((lead) => {
      if (lead._doneAt && lead._doneAt !== today) {
        delete lead._doneAt;
        delete lead._prevState;
        changed = true;
      }
    });
    if (changed) saveLeads(leads);
    return leads;
  }

  // Which draft a lead's next follow-up uses: its label and template.
  function draftKind(lead) {
    if (lead.status === "quoted") return { kind: "Quote chase", template: CONFIG.TEMPLATES.quote_chase };
    const info = stageInfo(lead.reminder_stage || 0);
    return { kind: info.label, template: CONFIG.TEMPLATES[info.template] };
  }

  // Line 2 of a Follow-ups row, e.g. "2-day nudge · 3 days late".
  function draftLabel(lead, today) {
    const { kind } = draftKind(lead);
    const diff = daysBetween(lead.next_action_date, today); // >0 = overdue, <0 = upcoming
    if (diff > 0) return `${kind} · ${diff} day${diff === 1 ? "" : "s"} late`;
    if (diff < 0) return `${kind} · due ${formatDateHuman(lead.next_action_date)}`;
    return kind;
  }

  // The full WhatsApp message — only built when a row is actually tapped.
  function draftMessage(lead) {
    return fillTemplate(draftKind(lead).template, {
      name: lead.contact_name,
      venue: lead.venue,
      brochure: (CONFIG.BROCHURE && CONFIG.BROCHURE[lead.enquiry]) || "",
      rep: lead.rep,
      company: CONFIG.COMPANY_NAME
    });
  }

  function leadRowEl(lead, label, done) {
    const li = document.createElement("li");
    li.className = done ? "lead-row done" : "lead-row";
    li.dataset.id = lead.lead_id;
    const venue = document.createElement("div");
    venue.className = "venue";
    venue.textContent = lead.venue;
    const line = document.createElement("div");
    line.className = "draft-line";
    line.textContent = label;
    li.append(venue, line);
    return li;
  }

  function renderFollowups() {
    let leads = getLeads();
    leads = clearStaleDone(leads);
    const today = todayStr();

    // Every lead shows up immediately, the moment a visit is logged — not
    // only once its next reminder is due — sorted soonest-due first.
    const active = leads
      .filter((l) => !l._doneAt)
      .sort((a, b) => (a.next_action_date < b.next_action_date ? -1 : a.next_action_date > b.next_action_date ? 1 : 0));

    const done = leads.filter((l) => l._doneAt === today);

    // Rows are built off-screen and swapped in at once, so the page only
    // has to lay out the list one time however long it is.
    const activeRows = document.createDocumentFragment();
    active.forEach((lead) => activeRows.appendChild(leadRowEl(lead, draftLabel(lead, today), false)));
    followupsListEl.textContent = "";
    followupsListEl.appendChild(activeRows);

    followupsEmptyEl.classList.toggle("hidden", leads.length > 0);

    const doneRows = document.createDocumentFragment();
    done.forEach((lead) => doneRows.appendChild(leadRowEl(lead, draftLabel(lead, today), true)));
    followupsDoneEl.textContent = "";
    followupsDoneEl.appendChild(doneRows);
    doneSectionEl.classList.toggle("hidden", done.length === 0);
  }

  // One tap listener per list (rather than one per row) — rows say which
  // lead they are via data-id.
  followupsListEl.addEventListener("click", (e) => {
    const row = e.target.closest(".lead-row");
    if (row) handleFollowupTap(row.dataset.id);
  });
  followupsDoneEl.addEventListener("click", (e) => {
    const row = e.target.closest(".lead-row");
    if (row) handleUndoTap(row.dataset.id);
  });

  function handleFollowupTap(leadId) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead) return;

    const message = draftMessage(lead);
    const url = `https://wa.me/${lead.phone.replace("+", "")}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");

    const today = todayStr();
    lead._prevState = {
      reminder_stage: lead.reminder_stage,
      next_action_date: lead.next_action_date,
      last_contacted: lead.last_contacted,
      status: lead.status
    };
    lead.reminder_stage = (lead.reminder_stage || 0) + 1;
    lead.next_action_date = addDays(lead.schedule_anchor, offsetForStage(lead.reminder_stage));
    lead.last_contacted = today;
    lead._doneAt = today;

    saveLeads(leads);
    queueFollowupUpdate(lead);
    renderFollowups();
  }

  function handleUndoTap(leadId) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead || !lead._prevState) return;

    lead.reminder_stage = lead._prevState.reminder_stage;
    lead.next_action_date = lead._prevState.next_action_date;
    lead.last_contacted = lead._prevState.last_contacted;
    lead.status = lead._prevState.status;
    delete lead._doneAt;
    delete lead._prevState;

    saveLeads(leads);
    queueFollowupUpdate(lead);
    renderFollowups();
  }

  // ---------------------------------------------------------------------
  // 7. New Entry tab
  // ---------------------------------------------------------------------

  const phoneInput = document.getElementById("phone-input");
  const phoneRow = document.getElementById("phone-row");
  const phoneError = document.getElementById("phone-error");
  const dupeLine = document.getElementById("dupe-line");
  const contactNameInput = document.getElementById("contact-name-input");
  const venueInput = document.getElementById("venue-input");
  const noteInput = document.getElementById("note-input");
  const submitBtn = document.getElementById("submit-btn");
  const newForm = document.getElementById("new-form");
  const roomsContainerEl = document.getElementById("rooms-container");
  const addRoomBtn = document.getElementById("add-room-btn");

  let selectedEnquiry = "sales";
  let photosProcessing = 0; // photos still being compressed; while above 0, Send waits ("Preparing photos…")
  let foundDupeRecord = null; // the Sheet's copy of this number's lead, if the duplicate check found one

  // Phone: allow spaces while typing, keep it visually grouped
  phoneInput.addEventListener("input", () => {
    const digits = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    phoneInput.value = digits.replace(/(\d{5})(\d{1,5})/, "$1 $2");
    updateSubmitLabel();
    phoneError.textContent = "";
    phoneRow.classList.remove("error");
  });

  function currentPhoneDigits() {
    return phoneInput.value.replace(/\D/g, "");
  }

  function updateSubmitLabel() {
    submitBtn.disabled = photosProcessing > 0;
    if (photosProcessing > 0) {
      submitBtn.textContent = "Preparing photos…";
      return;
    }
    const digits = currentPhoneDigits();
    const shown = digits.length === 10 ? digits.replace(/(\d{5})(\d{5})/, "$1 $2") : "98765 43210";
    submitBtn.textContent = `Send to +91 ${shown}`;
  }
  updateSubmitLabel();

  phoneInput.addEventListener("blur", () => {
    const digits = currentPhoneDigits();
    dupeLine.classList.add("hidden");
    foundDupeRecord = null;
    if (digits.length !== 10) return;
    if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.indexOf("PASTE_") === 0) return;

    const fullPhone = "+91" + digits;
    fetch(`${CONFIG.APPS_SCRIPT_URL}?phone=${encodeURIComponent(fullPhone)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.found && data.record) {
          const rec = data.record;
          foundDupeRecord = rec.lead_id ? Object.assign({}, rec, { lead_id: String(rec.lead_id) }) : null;
          contactNameInput.value = rec.contact_name || "";
          venueInput.value = rec.venue || "";
          const lastContacted = /^\d{4}-\d{2}-\d{2}$/.test(rec.last_contacted) ? formatDateHuman(rec.last_contacted) : "—";
          dupeLine.textContent = `${rec.contact_name || ""} · ${rec.venue || ""} · last contacted ${lastContacted}`;
          dupeLine.classList.remove("hidden");
        }
      })
      .catch(() => {
        // Silent failure — never block the form on a lookup problem.
      });
  });

  // Chips: enquiry (dark fill)
  function setupChipGroup(containerId, styleClass, defaultValue, onSelect) {
    const container = document.getElementById(containerId);
    const chips = Array.from(container.querySelectorAll(".chip"));
    function select(value) {
      chips.forEach((c) => c.classList.toggle(styleClass, c.dataset.value === value));
      onSelect(value);
    }
    chips.forEach((c) => c.addEventListener("click", () => select(c.dataset.value)));
    select(defaultValue);
  }
  setupChipGroup("enquiry-chips", "selected-dark", "sales", (v) => { selectedEnquiry = v; });

  // Photos: room-based, each room has its own set of labeled slots.
  // rooms[0] uses CONFIG.ROOM_ONE_LABELS; every room added after that uses
  // CONFIG.EXTRA_ROOM_LABELS. Per label, each room keeps:
  //   photos  — the compressed photo that gets uploaded (up to 1600px)
  //   thumbs  — a small copy for the on-screen thumbnail. Showing the full
  //             photo in a 58px square would hold ~8MB of memory per photo,
  //             enough to crash the page on a mid-range phone with 11 photos
  //   failed  — true if the photo couldn't be read, so the slot says "Try again"
  //   latest  — which attempt is newest, so a slow earlier shot can't
  //             overwrite a quick retake
  const THUMB_EDGE = 192;
  let rooms = [];

  function newRoom(labels) {
    return { labels, photos: {}, thumbs: {}, failed: {}, latest: {} };
  }

  function resetRooms() {
    rooms = [newRoom(CONFIG.ROOM_ONE_LABELS)];
    renderRooms();
  }

  function renderRooms() {
    roomsContainerEl.innerHTML = "";
    rooms.forEach((room, roomIndex) => {
      const block = document.createElement("div");
      block.className = "room-block";

      if (rooms.length > 1) {
        const heading = document.createElement("div");
        heading.className = "room-heading";
        heading.textContent = `Room ${roomIndex + 1}`;
        block.appendChild(heading);
      }

      const row = document.createElement("div");
      row.className = "photo-row";

      room.labels.forEach((label) => {
        const cell = document.createElement("div");
        cell.className = "photo-cell";

        const slot = document.createElement("div");
        slot.className = "photo-slot";
        const thumb = room.thumbs[label];
        if (thumb) {
          const img = document.createElement("img");
          img.src = thumb;
          slot.appendChild(img);
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "environment";
        input.addEventListener("change", () => handlePhotoChosen(room, label, input));
        slot.appendChild(input);

        const caption = document.createElement("div");
        caption.className = room.failed[label] ? "photo-cell-label error" : "photo-cell-label";
        caption.textContent = room.failed[label] ? "Try again" : label;

        cell.appendChild(slot);
        cell.appendChild(caption);
        row.appendChild(cell);
      });

      block.appendChild(row);
      roomsContainerEl.appendChild(block);
    });
  }

  addRoomBtn.addEventListener("click", () => {
    rooms.push(newRoom(CONFIG.EXTRA_ROOM_LABELS));
    renderRooms();
  });

  function handlePhotoChosen(room, label, input) {
    const file = input.files && input.files[0];
    input.value = ""; // so choosing the same photo again still registers
    if (!file) return;

    const attempt = (room.latest[label] || 0) + 1;
    room.latest[label] = attempt;
    photosProcessing += 1;
    updateSubmitLabel();

    compressImage(file, 1600, 0.7)
      .then((result) => {
        if (room.latest[label] !== attempt) return; // a newer retake replaced this one
        room.photos[label] = result.full;
        room.thumbs[label] = result.thumb;
        delete room.failed[label];
      }, () => {
        // Couldn't read it (e.g. a format this phone can't open). The slot
        // keeps any earlier photo and says "Try again"; never blocks Send.
        if (room.latest[label] === attempt) room.failed[label] = true;
      })
      .then(() => {
        photosProcessing -= 1;
        updateSubmitLabel();
        renderRooms();
      });
  }

  // Resolves with { full, thumb } as JPEG data URLs, or rejects if the
  // photo can't be read. Reads the file straight from disk (object URL)
  // rather than copying it into a giant text string first.
  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          resolve({ full: drawScaled(img, maxEdge, quality), thumb: drawScaled(img, THUMB_EDGE, 0.6) });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Photo could not be read"));
      };
      img.src = url;
    });
  }

  function drawScaled(img, maxEdge, quality) {
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    canvas.width = canvas.height = 0; // hand the memory back straight away (matters on iPhone)
    if (dataUrl.length < 100) throw new Error("Photo too large to process"); // Safari returns "data:," when out of memory
    return dataUrl;
  }

  function collectPhotosPayload() {
    const photos = [];
    rooms.forEach((room, roomIndex) => {
      Object.keys(room.photos).forEach((label) => {
        photos.push({ room: roomIndex + 1, label, dataUrl: room.photos[label] });
      });
    });
    return photos;
  }

  resetRooms();

  // Submit
  newForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (photosProcessing > 0) return; // a photo is still being prepared — Send is disabled until it's done

    const digits = currentPhoneDigits();
    if (digits.length !== 10) {
      phoneError.textContent = "Enter a 10-digit phone number.";
      phoneRow.classList.add("error");
      phoneInput.focus();
      return;
    }

    const fullPhone = "+91" + digits;
    const today = todayStr();
    const rep = getRep();

    const leads = getLeads();
    const rec = foundDupeRecord;
    // Revisit? Match the Sheet's lead if the duplicate check found one,
    // otherwise (e.g. no signal for the check) this phone's own lead for
    // the same number.
    let lead = rec
      ? leads.find((l) => l.lead_id === rec.lead_id)
      : leads.find((l) => l.phone === fullPhone);

    if (!lead && rec) {
      // This number is already in the Sheet but not on this phone (first
      // logged by another rep, or on another phone). Take over its lead_id
      // so this visit updates that row instead of adding a duplicate.
      lead = {
        lead_id: rec.lead_id,
        created_at: rec.created_at || today,
        status: rec.status || "new",
        source: rec.source || "visit"
      };
      leads.push(lead);
    } else if (lead && rec && rec.status) {
      // Pick up a status set by hand in the Sheet (e.g. "quoted"), so this
      // visit doesn't overwrite it.
      lead.status = rec.status;
    }

    if (!lead) {
      lead = {
        lead_id: String(Date.now()),
        created_at: today,
        status: "new",
        source: "visit"
      };
      leads.push(lead);
    }

    lead.rep = rep;
    lead.phone = fullPhone;
    lead.contact_name = contactNameInput.value.trim();
    lead.venue = venueInput.value.trim();
    lead.enquiry = selectedEnquiry;
    lead.visit_date = today;
    lead.note = noteInput.value.trim();

    // Every visit is treated as a fresh "initial contact" — the reminder
    // schedule resets and counts forward from today.
    lead.schedule_anchor = today;
    lead.reminder_stage = 0;
    lead.last_contacted = today;
    lead.next_action_date = addDays(today, offsetForStage(0));

    const payload = {
      lead_id: lead.lead_id,
      created_at: lead.created_at,
      rep: lead.rep,
      phone: lead.phone,
      contact_name: lead.contact_name,
      venue: lead.venue,
      enquiry: lead.enquiry,
      visit_date: lead.visit_date,
      note: lead.note,
      reminder_stage: lead.reminder_stage,
      schedule_anchor: lead.schedule_anchor,
      next_action_date: lead.next_action_date,
      last_contacted: lead.last_contacted,
      status: lead.status,
      source: lead.source,
      photos: collectPhotosPayload()
    };

    saveLeads(leads);
    queueLead(payload);

    const template = CONFIG.TEMPLATES["first_" + lead.enquiry] || CONFIG.TEMPLATES.first_sales;
    const message = fillTemplate(template, {
      name: lead.contact_name,
      venue: lead.venue,
      brochure: (CONFIG.BROCHURE && CONFIG.BROCHURE[lead.enquiry]) || "",
      rep: lead.rep,
      company: CONFIG.COMPANY_NAME
    });
    const url = `https://wa.me/${fullPhone.replace("+", "")}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");

    resetNewForm();
    switchTab("tab-followups");
  });

  function resetNewForm() {
    phoneInput.value = "";
    contactNameInput.value = "";
    venueInput.value = "";
    noteInput.value = "";
    phoneError.textContent = "";
    phoneRow.classList.remove("error");
    dupeLine.classList.add("hidden");
    foundDupeRecord = null;
    resetRooms();
    updateSubmitLabel();
    document.querySelectorAll("#enquiry-chips .chip").forEach((c) => c.classList.toggle("selected-dark", c.dataset.value === "sales"));
    selectedEnquiry = "sales";
  }

  // ---------------------------------------------------------------------
  // 8. Offline queue
  //
  // Every submission goes through this queue: it is saved on the phone
  // FIRST, then sent. So nothing is lost if the signal drops, the app is
  // closed, or the phone switches to WhatsApp halfway through an upload.
  //
  // Each visit is split into small pieces: one tiny "lead" item (the row in
  // the Sheet), then one item per photo. The row reaches the Sheet within a
  // second or two even on bad wifi, and a failed photo only re-sends that
  // one photo, not all of them.
  //
  // Items are sent one at a time, oldest first, and are only deleted from
  // the phone once the Apps Script replies { ok: true }.
  //
  // The queue lives in IndexedDB (the browser's built-in database), which
  // can hold hundreds of MB. localStorage, where it used to live, tops out
  // around 5MB — two photo-heavy visits could fill it and silently lose a lead.
  // ---------------------------------------------------------------------

  const queueBadgeEl = document.getElementById("queue-badge");

  const QUEUE_DB_NAME = "ja_queue_db";
  const QUEUE_STORE = "items";
  const LEAD_TIMEOUT_MS = 30000;          // give up on one row upload after 30s
  const PHOTO_TIMEOUT_MS = 90000;         // give up on one photo upload after 90s
  const RETRY_EVERY_MS = 60000;           // while online, check the queue every minute
  const REJECTED_PAUSE_MS = 10 * 60000;   // wait 10 min before re-sending something the script refused

  function hasBackend() {
    return !!CONFIG.APPS_SCRIPT_URL && CONFIG.APPS_SCRIPT_URL.indexOf("PASTE_") !== 0;
  }

  // --- Storage -----------------------------------------------------------

  let dbPromise = null;
  function openQueueDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
        const req = indexedDB.open(QUEUE_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(QUEUE_STORE, { keyPath: "qid", autoIncrement: true });
          store.createIndex("lead_id", "lead_id");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Runs fn(store) in one IndexedDB transaction. Resolves once it has been
  // committed to disk, with the result of the request fn returned (if any).
  function withStore(mode, fn) {
    return openQueueDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, mode);
      const req = fn(tx.objectStore(QUEUE_STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    }));
  }

  const idbStore = {
    name: "idb",
    add: (items) => withStore("readwrite", (s) => { items.forEach((item) => s.add(item)); }),
    keys: () => withStore("readonly", (s) => s.getAllKeys()),
    get: (key) => withStore("readonly", (s) => s.get(key)),
    del: (key) => withStore("readwrite", (s) => s.delete(key)),
    leadIds: () => {
      const ids = [];
      return withStore("readonly", (s) => {
        const cursor = s.index("lead_id").openKeyCursor(null, "nextunique");
        cursor.onsuccess = () => {
          if (cursor.result) { ids.push(cursor.result.key); cursor.result.continue(); }
        };
      }).then(() => ids);
    }
  };

  // Last-resort fallback if IndexedDB can't be used at all (very old
  // browsers, some private-browsing modes, or a completely full phone).
  // Items here are still sent, but are lost if the app is closed first —
  // the badge says "keep app open" while anything is in here.
  const memStore = {
    name: "mem",
    items: [],
    nextId: 1,
    add(items) {
      items.forEach((item) => this.items.push(Object.assign({}, item, { qid: this.nextId++ })));
      return Promise.resolve();
    },
    keys() { return Promise.resolve(this.items.map((i) => i.qid)); },
    get(key) { return Promise.resolve(this.items.find((i) => i.qid === key)); },
    del(key) { this.items = this.items.filter((i) => i.qid !== key); return Promise.resolve(); },
    leadIds() { return Promise.resolve(this.items.map((i) => i.lead_id)); }
  };

  // --- Adding to the queue -------------------------------------------------

  // Splits one submission (row fields + photos array) into queue items: the
  // row first, then one item per photo. Each photo gets a fixed photo_id
  // here, once, so if an upload is retried after the server already saved
  // it, the Apps Script spots the repeat and doesn't save it twice.
  let splitCounter = 0;
  function splitSubmission(payload) {
    const leadItem = Object.assign({}, payload, { kind: "lead" });
    delete leadItem.photos;
    const batch = `${Date.now()}${splitCounter++}`;
    const photoItems = (payload.photos || []).map((p, i) => ({
      kind: "photo",
      lead_id: payload.lead_id,
      venue: payload.venue,
      photo_id: `${payload.lead_id}-${batch}-${i}`,
      room: p.room,
      label: p.label,
      dataUrl: p.dataUrl
    }));
    return [leadItem].concat(photoItems);
  }

  function queueLead(payload) {
    queueItems(splitSubmission(payload));
  }

  // A tap (or undo) on a Follow-ups row changes only the reminder fields;
  // this sends just those, so it can't overwrite anything newer in the
  // Sheet — like a later visit logged on another phone, or a status set
  // there by hand.
  function queueFollowupUpdate(lead) {
    queueItems([{
      kind: "update",
      lead_id: lead.lead_id,
      reminder_stage: lead.reminder_stage,
      next_action_date: lead.next_action_date,
      last_contacted: lead.last_contacted
    }]);
  }

  function queueItems(items) {
    idbStore.add(items)
      .catch(() => memStore.add(items))
      .then(() => { renderQueueBadge(); drainQueue(); });
  }

  // Anything the old version of the app left in localStorage is moved into
  // IndexedDB, then removed from localStorage. If IndexedDB can't take it,
  // it is left where it is and tried again next time the app opens.
  function migrateLegacyQueue() {
    const legacy = getLegacyQueue();
    if (legacy.length === 0) return Promise.resolve();
    const items = [];
    legacy.forEach((payload) => { items.push(...splitSubmission(payload)); });
    return idbStore.add(items)
      .then(() => localStorage.removeItem(STORE_KEYS.queue))
      .catch(() => {});
  }

  // --- Sending -------------------------------------------------------------

  function timedFetch(url, options, ms) {
    if (!window.AbortController) return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .finally(() => clearTimeout(timer));
  }

  // Before sending a photo or a follow-up update, check the Apps Script
  // deployment is new enough to understand it. An older deployment would
  // mistake either one for a whole lead and blank out the rest of that
  // lead's row, so they wait in the queue until the new script is deployed.
  const MIN_SERVER_VERSION = { photo: 2, update: 3 };
  let serverVersion = 0;
  function checkServerVersion(min) {
    if (serverVersion >= min) return Promise.resolve("ok");
    return timedFetch(`${CONFIG.APPS_SCRIPT_URL}?v=1`, {}, LEAD_TIMEOUT_MS)
      .then((r) => r.json())
      .then((data) => {
        serverVersion = (data && data.v) || 1;
        return serverVersion >= min ? "ok" : "rejected";
      }, () => "network");
  }

  // Sends one queue item. Resolves with:
  //   "ok"       — the Apps Script saved it; safe to delete from the phone
  //   "network"  — no signal, timeout, or a Google error page; stop for now
  //   "rejected" — the Apps Script answered but refused it; leave it queued
  //                and carry on with the rest of the queue
  // A "busy" answer (the Sheet was tied up by other uploads) counts as
  // "network": nothing wrong with the item, just try again shortly.
  function sendItem(item) {
    const minVersion = MIN_SERVER_VERSION[item.kind];
    const gate = minVersion ? checkServerVersion(minVersion) : Promise.resolve("ok");
    return gate.then((state) => {
      if (state !== "ok") return state;
      const body = Object.assign({}, item);
      delete body.qid;
      return timedFetch(CONFIG.APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      }, item.kind === "photo" ? PHOTO_TIMEOUT_MS : LEAD_TIMEOUT_MS)
        .then((r) => { if (!r.ok) throw new Error("bad status"); return r.json(); })
        .then((data) => {
          if (data && data.ok === true) return "ok";
          return data && data.busy ? "network" : "rejected";
        }, () => "network");
    });
  }

  const rejectedUntil = {}; // "store:qid" -> time before which we don't re-send it

  function drainStore(store, state) {
    return store.keys().catch(() => []).then((keys) => keys.reduce((chain, key) => chain.then(() => {
      if (state.stop) return;
      const tag = `${store.name}:${key}`;
      if (rejectedUntil[tag] > Date.now()) return;
      return store.get(key).then((item) => {
        if (!item) return; // already sent (e.g. by another open copy of the app)
        return sendItem(item).then((result) => {
          if (result === "ok") {
            delete rejectedUntil[tag];
            return store.del(key).then(renderQueueBadge);
          }
          if (result === "network") state.stop = true;
          else rejectedUntil[tag] = Date.now() + REJECTED_PAUSE_MS;
        });
      });
    }), Promise.resolve()));
  }

  // Only one drain runs at a time. If something asks for a drain while one
  // is running (a new submit, signal coming back), it runs again right after.
  // navigator.locks does the same across two open copies of the app.
  let draining = false;
  let drainRequested = false;

  function drainQueue() {
    if (!hasBackend()) return Promise.resolve();
    if (draining) { drainRequested = true; return Promise.resolve(); }
    draining = true;
    drainRequested = false;
    const run = () => {
      const state = { stop: false };
      return drainStore(idbStore, state).then(() => drainStore(memStore, state));
    };
    const done = navigator.locks ? navigator.locks.request("ja-queue-drain", run) : run();
    return done.catch(() => {}).then(() => {
      draining = false;
      renderQueueBadge();
      if (drainRequested) drainQueue();
    });
  }

  // "2 waiting" = number of visits with a row or photos still to send.
  function renderQueueBadge() {
    return Promise.all([idbStore.leadIds().catch(() => []), memStore.leadIds()]).then(([a, b]) => {
      const n = new Set(a.concat(b)).size;
      if (n > 0) {
        queueBadgeEl.textContent = memStore.items.length ? `${n} waiting · keep app open` : `${n} waiting`;
        queueBadgeEl.classList.remove("hidden");
      } else {
        queueBadgeEl.classList.add("hidden");
      }
    });
  }

  window.addEventListener("online", drainQueue);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") drainQueue();
  });
  setInterval(() => { if (navigator.onLine !== false) drainQueue(); }, RETRY_EVERY_MS);

  // ---------------------------------------------------------------------
  // 9. Service worker
  // ---------------------------------------------------------------------

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      // update() asks the browser to check for a new sw.js right away,
      // rather than whenever it gets round to it (some phones are slow to).
      // Changes to the other app files are picked up by sw.js itself.
      navigator.serviceWorker.register("sw.js")
        .then((registration) => registration.update())
        .catch(() => {});
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  initPasscode();
  migrateLegacyQueue().then(() => { renderQueueBadge(); drainQueue(); });
})();
