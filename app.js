// ============================================================================
// APP.JS — all the app's behaviour lives here. Plain vanilla JS, no build step.
//
// Plain-language map of what this file does, top to bottom:
//   1. Small date/string helpers
//   2. localStorage "database" for the rep's name, leads, and the offline queue
//   3. Rep name prompt (first open only)
//   4. Bottom nav tab switching
//   5. Follow-ups tab: render list, handle tap-to-send, handle undo
//   6. New Entry tab: chips, photo capture + compression, duplicate check, submit
//   7. Offline queue: retry failed submissions automatically
//   8. Service worker registration
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

  function nudgeLabel(nudgeKey) {
    switch (nudgeKey) {
      case "tomorrow": return "Next-day nudge";
      case "3 days": return "3-day nudge";
      case "1 week": return "1-week nudge";
      case "1 month": return "1-month nudge";
      default: return "Nudge";
    }
  }

  // ---------------------------------------------------------------------
  // 2. localStorage "database"
  // ---------------------------------------------------------------------

  const STORE_KEYS = {
    rep: "ja_rep",
    leads: "ja_leads",
    queue: "ja_queue"
  };

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
  // 3. Rep name prompt
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
  // 4. Bottom nav
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
  // 5. Follow-ups tab
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
    const late = daysBetween(lead.next_action_date, today);
    let kind;
    let template;

    if (!lead.last_contacted) {
      kind = "First message";
      template = CONFIG.TEMPLATES["first_" + lead.enquiry] || CONFIG.TEMPLATES.first_sales;
    } else if (lead.status === "quoted") {
      kind = "Quote chase";
      template = CONFIG.TEMPLATES.quote_chase;
    } else {
      kind = nudgeLabel(lead.nudge_interval);
      template = CONFIG.TEMPLATES.nudge;
    }

    const label = late > 0 ? `${kind} · ${late} day${late === 1 ? "" : "s"} late` : kind;

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

    const active = leads
      .filter((l) => !l._doneAt && l.next_action_date <= today)
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

    followupsEmptyEl.classList.toggle("hidden", active.length > 0);

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
      next_action_date: lead.next_action_date,
      last_contacted: lead.last_contacted,
      status: lead.status
    };
    const interval = CONFIG.NUDGE_DAYS[lead.nudge_interval] || 3;
    lead.next_action_date = addDays(today, interval);
    lead.last_contacted = today;
    lead._doneAt = today;

    saveLeads(leads);
    renderFollowups();
  }

  function handleUndoTap(leadId) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead || !lead._prevState) return;

    lead.next_action_date = lead._prevState.next_action_date;
    lead.last_contacted = lead._prevState.last_contacted;
    lead.status = lead._prevState.status;
    delete lead._doneAt;
    delete lead._prevState;

    saveLeads(leads);
    renderFollowups();
  }

  // ---------------------------------------------------------------------
  // 6. New Entry tab
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
  const photoRowEl = document.getElementById("photo-row");

  let selectedEnquiry = "sales";
  let selectedNudge = "3 days";
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

  // Chips: enquiry (dark fill) and nudge (accent fill)
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
  setupChipGroup("nudge-chips", "selected-accent", "3 days", (v) => { selectedNudge = v; });

  // Photos: 5 slots, each a file input capturing the camera
  const PHOTO_SLOT_COUNT = 5;
  const photoDataUrls = new Array(PHOTO_SLOT_COUNT).fill(null);

  function buildPhotoSlots() {
    photoRowEl.innerHTML = "";
    for (let i = 0; i < PHOTO_SLOT_COUNT; i++) {
      const slot = document.createElement("div");
      slot.className = "photo-slot";
      slot.innerHTML = `<input type="file" accept="image/*" capture="environment">`;
      const input = slot.querySelector("input");
      input.addEventListener("change", () => handlePhotoChosen(i, input, slot));
      photoRowEl.appendChild(slot);
    }
  }
  buildPhotoSlots();

  function handlePhotoChosen(index, input, slot) {
    const file = input.files && input.files[0];
    if (!file) return;
    compressImage(file, 1600, 0.7).then((dataUrl) => {
      photoDataUrls[index] = dataUrl;
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
    lead.nudge_interval = selectedNudge;
    lead.last_contacted = today;
    lead.next_action_date = addDays(today, CONFIG.NUDGE_DAYS[selectedNudge] || 3);

    const photos = photoDataUrls.filter(Boolean);

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
      nudge_interval: lead.nudge_interval,
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
    photoDataUrls.fill(null);
    buildPhotoSlots();
    updateSubmitLabel();
    document.querySelectorAll("#enquiry-chips .chip").forEach((c) => c.classList.toggle("selected-dark", c.dataset.value === "sales"));
    selectedEnquiry = "sales";
    document.querySelectorAll("#nudge-chips .chip").forEach((c) => c.classList.toggle("selected-accent", c.dataset.value === "3 days"));
    selectedNudge = "3 days";
  }

  // ---------------------------------------------------------------------
  // 7. Offline queue
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
  // 8. Service worker
  // ---------------------------------------------------------------------

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  initRepPrompt();
  retryQueue();
})();
