// ============================================================================
// APP.JS — all the app's behaviour lives here. Plain vanilla JS, no build step.
//
// Plain-language map of what this file does, top to bottom:
//   1. Small date/string helpers
//   2. localStorage "database" for the passcode lock, rep's name, leads,
//      and the offline queue
//   3. Passcode lock screen (first open only, per phone)
//   4. Rep name prompt (first open only, per phone)
//   5. Bottom nav tab switching
//   6. Follow-ups tab: render list (every lead, with its next contact date),
//      handle tap-to-send, handle undo
//   7. New Entry tab: chips, room-based labeled photo capture + compression,
//      duplicate check, submit
//   8. Offline queue: retry failed submissions automatically
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

  function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEYS.queue)) || [];
    } catch (e) {
      return [];
    }
  }
  function saveQueue(queue) {
    localStorage.setItem(STORE_KEYS.queue, JSON.stringify(queue));
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

  function draftFor(lead) {
    const today = todayStr();
    const diff = daysBetween(lead.next_action_date, today); // >0 = overdue, <0 = upcoming

    let kind, template;
    if (lead.status === "quoted") {
      kind = "Quote chase";
      template = CONFIG.TEMPLATES.quote_chase;
    } else {
      const info = stageInfo(lead.reminder_stage || 0);
      kind = info.label;
      template = CONFIG.TEMPLATES[info.template];
    }

    let label = kind;
    if (diff > 0) {
      label = `${kind} · ${diff} day${diff === 1 ? "" : "s"} late`;
    } else if (diff < 0) {
      label = `${kind} · due ${formatDateHuman(lead.next_action_date)}`;
    }

    const message = fillTemplate(template, {
      name: lead.contact_name,
      venue: lead.venue,
      brochure: (CONFIG.BROCHURE && CONFIG.BROCHURE[lead.enquiry]) || "",
      rep: lead.rep,
      company: CONFIG.COMPANY_NAME
    });

    return { label, message };
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

    followupsListEl.innerHTML = "";
    active.forEach((lead) => {
      const { label } = draftFor(lead);
      const li = document.createElement("li");
      li.className = "lead-row";
      li.innerHTML = `<div class="venue"></div><div class="draft-line"></div>`;
      li.querySelector(".venue").textContent = lead.venue;
      li.querySelector(".draft-line").textContent = label;
      li.addEventListener("click", () => handleFollowupTap(lead.lead_id));
      followupsListEl.appendChild(li);
    });

    followupsEmptyEl.classList.toggle("hidden", leads.length > 0);

    followupsDoneEl.innerHTML = "";
    done.forEach((lead) => {
      const { label } = draftFor(lead);
      const li = document.createElement("li");
      li.className = "lead-row done";
      li.innerHTML = `<div class="venue"></div><div class="draft-line"></div>`;
      li.querySelector(".venue").textContent = lead.venue;
      li.querySelector(".draft-line").textContent = label;
      li.addEventListener("click", () => handleUndoTap(lead.lead_id));
      followupsDoneEl.appendChild(li);
    });
    doneSectionEl.classList.toggle("hidden", done.length === 0);
  }

  function handleFollowupTap(leadId) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead) return;

    const { message } = draftFor(lead);
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
  let foundDupeLeadId = null;

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
    const digits = currentPhoneDigits();
    const shown = digits.length === 10 ? digits.replace(/(\d{5})(\d{5})/, "$1 $2") : "98765 43210";
    submitBtn.textContent = `Send to +91 ${shown}`;
  }
  updateSubmitLabel();

  phoneInput.addEventListener("blur", () => {
    const digits = currentPhoneDigits();
    dupeLine.classList.add("hidden");
    foundDupeLeadId = null;
    if (digits.length !== 10) return;
    if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.indexOf("PASTE_") === 0) return;

    const fullPhone = "+91" + digits;
    fetch(`${CONFIG.APPS_SCRIPT_URL}?phone=${encodeURIComponent(fullPhone)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.found && data.record) {
          const rec = data.record;
          foundDupeLeadId = rec.lead_id || null;
          contactNameInput.value = rec.contact_name || "";
          venueInput.value = rec.venue || "";
          const lastContacted = rec.last_contacted ? formatDateHuman(rec.last_contacted) : "—";
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
  // CONFIG.EXTRA_ROOM_LABELS. Each room stores { label: dataUrl }.
  let rooms = [];

  function resetRooms() {
    rooms = [{ labels: CONFIG.ROOM_ONE_LABELS, photos: {} }];
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
        const existing = room.photos[label];
        if (existing) {
          const img = document.createElement("img");
          img.src = existing;
          slot.appendChild(img);
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "environment";
        input.addEventListener("change", () => handlePhotoChosen(roomIndex, label, input, slot));
        slot.appendChild(input);

        const caption = document.createElement("div");
        caption.className = "photo-cell-label";
        caption.textContent = label;

        cell.appendChild(slot);
        cell.appendChild(caption);
        row.appendChild(cell);
      });

      block.appendChild(row);
      roomsContainerEl.appendChild(block);
    });
  }

  addRoomBtn.addEventListener("click", () => {
    rooms.push({ labels: CONFIG.EXTRA_ROOM_LABELS, photos: {} });
    renderRooms();
  });

  function handlePhotoChosen(roomIndex, label, input, slot) {
    const file = input.files && input.files[0];
    if (!file) return;
    compressImage(file, 1600, 0.7).then((dataUrl) => {
      rooms[roomIndex].photos[label] = dataUrl;
      let img = slot.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        slot.insertBefore(img, slot.firstChild);
      }
      img.src = dataUrl;
    });
  }

  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxEdge) { h = Math.round(h * (maxEdge / w)); w = maxEdge; }
        else if (h >= w && h > maxEdge) { w = Math.round(w * (maxEdge / h)); h = maxEdge; }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      reader.readAsDataURL(file);
    });
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
    let lead = foundDupeLeadId ? leads.find((l) => l.lead_id === foundDupeLeadId) : null;
    const isNew = !lead;

    if (isNew) {
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

    const photos = collectPhotosPayload();

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
      photos: photos
    };

    saveLeads(leads);
    postLead(payload);

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
    foundDupeLeadId = null;
    resetRooms();
    updateSubmitLabel();
    document.querySelectorAll("#enquiry-chips .chip").forEach((c) => c.classList.toggle("selected-dark", c.dataset.value === "sales"));
    selectedEnquiry = "sales";
  }

  // ---------------------------------------------------------------------
  // 8. Offline queue
  // ---------------------------------------------------------------------

  const queueBadgeEl = document.getElementById("queue-badge");

  function renderQueueBadge() {
    const n = getQueue().length;
    if (n > 0) {
      queueBadgeEl.textContent = `${n} waiting`;
      queueBadgeEl.classList.remove("hidden");
    } else {
      queueBadgeEl.classList.add("hidden");
    }
  }

  function postLead(payload) {
    if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.indexOf("PASTE_") === 0) {
      enqueue(payload);
      return;
    }
    fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    })
      .then((r) => { if (!r.ok) throw new Error("bad status"); return r.json(); })
      .catch(() => { enqueue(payload); });
  }

  function enqueue(payload) {
    const queue = getQueue();
    queue.push(payload);
    saveQueue(queue);
    renderQueueBadge();
  }

  function retryQueue() {
    const queue = getQueue();
    if (queue.length === 0) return;
    if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.indexOf("PASTE_") === 0) return;

    const remaining = [];
    let pending = queue.length;

    queue.forEach((payload) => {
      fetch(CONFIG.APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      })
        .then((r) => { if (!r.ok) throw new Error("bad status"); })
        .catch(() => { remaining.push(payload); })
        .finally(() => {
          pending -= 1;
          if (pending === 0) {
            saveQueue(remaining);
            renderQueueBadge();
          }
        });
    });
  }

  window.addEventListener("online", retryQueue);

  // ---------------------------------------------------------------------
  // 9. Service worker
  // ---------------------------------------------------------------------

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  initPasscode();
  retryQueue();
})();
