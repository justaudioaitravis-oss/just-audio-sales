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
//   6. Follow-ups tab: render list (every open lead, with its next contact
//      date); tap a row for Send / Call / Edit / Quoted / Won / Lost
//   7. New Entry tab: type of contact, owner's sites (duplicate check),
//      venue details, location, enquiry + music chips, room-based photos +
//      compression, review before saving, editing a saved lead
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

  // Swaps {placeholders} for real values. A line whose link placeholder
  // ({brochure} or {website}) has no link set is dropped, so a message
  // never says "Our brochure: " with nothing after it.
  const LINK_KEYS = ["brochure", "website"];
  function fillTemplate(str, vars) {
    const kept = str.split("\n").filter((line) => !LINK_KEYS.some((k) => line.includes(`{${k}}`) && !vars[k]));
    return kept.join("\n")
      .replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? vars[key] : ""))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Made once and reused: toLocaleDateString builds a new formatter on
  // every call, which adds up across a long Follow-ups list.
  const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

  function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return DAY_MONTH.format(new Date(y, m - 1, d));
  }

  // A Google Maps link for "15.593712, 73.740021" — opens the Maps app on
  // the phone, free, no account or key needed.
  function mapsUrl(location) {
    return `https://www.google.com/maps?q=${encodeURIComponent(location.replace(/\s/g, ""))}`;
  }

  function formatPhone(phone) {
    return String(phone || "").replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");
  }

  // "Sales" for "sales" — the words shown on the Enquiry chips.
  function enquiryName(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // A lead's enquiry is saved as e.g. "sales, acoustics".
  function enquiryKeys(enquiry) {
    return String(enquiry || "").split(/,\s*/).filter(Boolean);
  }

  function enquiryNames(enquiry) {
    return enquiryKeys(enquiry).map(enquiryName).join(", ");
  }

  // "a new sound system, servicing your current setup and acoustic
  // treatment" — the {services} words in the first message.
  function servicesPhrase(enquiry) {
    const parts = enquiryKeys(enquiry).map((k) => CONFIG.ENQUIRIES[k] || k);
    if (parts.length < 2) return parts.join("");
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  }

  // The automatic reminder cadence. An open lead is on one of two tracks:
  // reminders after a contact ("nudge"), or chases once it has been quoted
  // ("quote"). Stage 0 is the first message on the track, stage 1 the
  // next, and so on. Each gap counts from the previous message actually
  // sent (for stage 0, from the contact or the quote itself), so the next
  // one can never be sent sooner than its gap. Once the track's list of
  // gaps runs out, it repeats every CONFIG.MONTHLY_INTERVAL_DAYS.
  const TRACKS = {
    nudge: { days: () => CONFIG.REMINDER_SCHEDULE_DAYS, templates: ["nudge_2day", "nudge_1week", "nudge_2week"], monthly: "nudge_monthly", noun: "nudge" },
    quote: { days: () => CONFIG.QUOTE_SCHEDULE_DAYS, templates: ["quote_2day", "quote_1week", "quote_2week"], monthly: "quote_monthly", noun: "quote chase" }
  };

  function trackFor(lead) {
    return lead.status === "quoted" ? TRACKS.quote : TRACKS.nudge;
  }

  function gapForStage(track, stage) {
    const days = track.days();
    return stage < days.length ? days[stage] : CONFIG.MONTHLY_INTERVAL_DAYS;
  }

  // The label ("1-week nudge") and template of a lead's next message.
  function stageInfo(lead) {
    const track = trackFor(lead);
    const stage = lead.reminder_stage || 0;
    const days = track.days();
    if (stage >= days.length) return { label: `Monthly ${track.noun}`, template: track.monthly };
    const gap = days[stage];
    const when = gap % 7 === 0 ? `${gap / 7}-week` : `${gap}-day`;
    return { label: `${when} ${track.noun}`, template: track.templates[stage] || track.monthly };
  }

  // ---------------------------------------------------------------------
  // 2. localStorage "database"
  // ---------------------------------------------------------------------

  const STORE_KEYS = {
    key: "ja_key",               // the passcode, once the Apps Script has accepted it
    legacyUnlocked: "ja_unlocked", // older versions: "yes" once unlocked (no longer enough)
    rep: "ja_rep",
    leads: "ja_leads",
    queue: "ja_queue",
    serverVersion: "ja_server_v" // the Apps Script's version, last time it said
  };

  // The passcode is checked by the Apps Script, not by this code (which is
  // public). Once accepted it's kept on the phone and sent with every
  // request — the script refuses anything without it.
  function getKey() {
    return localStorage.getItem(STORE_KEYS.key) || "";
  }
  function setKey(passcode) {
    localStorage.setItem(STORE_KEYS.key, passcode);
    localStorage.removeItem(STORE_KEYS.legacyUnlocked);
  }
  function clearKey() {
    localStorage.removeItem(STORE_KEYS.key);
  }
  function isUnlocked() {
    return !!getKey();
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
  // Never throws: if the phone's storage is ever full, the visit still
  // reaches the upload queue (which lives elsewhere, in IndexedDB).
  function saveLeads(leads) {
    try {
      localStorage.setItem(STORE_KEYS.leads, JSON.stringify(leads));
      return true;
    } catch (e) {
      return false;
    }
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
    showPasscodePrompt(initRepPrompt);
  }

  let afterUnlock = null;
  function showPasscodePrompt(then) {
    afterUnlock = then;
    passcodeError.textContent = "";
    passcodePromptEl.classList.remove("hidden");
  }

  passcodeSaveBtn.addEventListener("click", tryUnlock);
  passcodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });

  // Asks the Apps Script whether the passcode is right. Needs signal — the
  // first unlock on a phone can't happen offline.
  function tryUnlock() {
    const code = passcodeInput.value;
    if (!code || passcodeSaveBtn.disabled) { passcodeInput.focus(); return; }
    passcodeSaveBtn.disabled = true;
    passcodeSaveBtn.textContent = "Checking…";
    passcodeError.textContent = "";
    // The passcode check needs the current Apps Script (version 4+). An
    // older one wouldn't understand the request.
    checkServerVersion(MIN_SERVER_VERSION.verify)
      .then((state) => {
        if (state === "network") throw new Error("no signal");
        if (state !== "ok") return { outdated: true };
        return postToScript({ kind: "verify" }, code, LEAD_TIMEOUT_MS);
      })
      .then((data) => {
        if (data && data.outdated) {
          passcodeError.textContent = "The Apps Script needs updating first (see README).";
        } else if (data && data.ok) {
          setKey(code);
          passcodeInput.value = "";
          passcodePromptEl.classList.add("hidden");
          const next = afterUnlock;
          afterUnlock = null;
          if (next) next();
          drainQueue();
        } else if (data && data.setup) {
          passcodeError.textContent = "The passcode isn't set up in the Apps Script yet (see README).";
        } else if (data && data.auth) {
          passcodeError.textContent = "Incorrect passcode.";
          passcodeInput.value = "";
          passcodeInput.focus();
        } else {
          passcodeError.textContent = "Couldn't check the passcode. Try again.";
        }
      }, () => {
        passcodeError.textContent = "No signal. The first unlock needs internet — try again with signal.";
      })
      .then(() => {
        passcodeSaveBtn.disabled = false;
        passcodeSaveBtn.textContent = "Unlock";
      });
  }

  // The Apps Script refused the passcode saved on this phone (it has been
  // changed). Forget it and ask for the new one. Anything waiting to send
  // stays safely queued, and goes as soon as the new passcode is entered.
  function relock() {
    if (!isUnlocked()) return;
    clearKey();
    showPasscodePrompt(null);
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

  // Won or lost: the reminders stop and the lead leaves the list.
  function isClosed(lead) {
    return lead.status === "won" || lead.status === "lost";
  }

  function clearStaleDone(leads) {
    const today = todayStr();
    let changed = false;
    leads.forEach((lead) => {
      if (lead._doneAt && lead._doneAt !== today) {
        delete lead._doneAt;
        delete lead._doneLabel;
        delete lead._prevState; // left by older versions, which had undo
        changed = true;
      }
    });
    if (changed) saveLeads(leads);
    return leads;
  }

  // Line 2 of a Follow-ups row, e.g. "2-day nudge · 3 days late".
  function draftLabel(lead, today) {
    const { label } = stageInfo(lead);
    const diff = daysBetween(lead.next_action_date, today); // >0 = overdue, <0 = upcoming
    if (diff > 0) return `${label} · ${diff} day${diff === 1 ? "" : "s"} late`;
    if (diff < 0) return `${label} · due ${formatDateHuman(lead.next_action_date)}`;
    return label;
  }

  function messageVars(lead) {
    return {
      name: lead.contact_name,
      venue: lead.venue,
      brochure: CONFIG.BROCHURE_URL || "",
      website: CONFIG.WEBSITE_URL || "",
      rep: lead.rep,
      company: CONFIG.COMPANY_NAME,
      services: servicesPhrase(lead.enquiry)
    };
  }

  function openWhatsApp(phone, message) {
    window.open(`https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(message)}`, "_blank");
  }

  // A reminder can be sent from its due date onward (due today, or late) —
  // never before. E.g. no 2-day nudge on the day of the visit itself.
  function isDue(lead, today) {
    return !!lead.next_action_date && lead.next_action_date <= today;
  }

  function leadRowEl(lead, label, rowClass) {
    const li = document.createElement("li");
    li.className = `lead-row ${rowClass}`;
    li.dataset.id = lead.lead_id;
    const venue = document.createElement("div");
    venue.className = "venue";
    venue.textContent = lead.venue || lead.contact_name || lead.phone;
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

    // Every open lead shows up immediately, the moment a visit is logged —
    // not only once its next reminder is due — sorted soonest-due first.
    const active = leads
      .filter((l) => !l._doneAt && !isClosed(l))
      .sort((a, b) => (a.next_action_date < b.next_action_date ? -1 : a.next_action_date > b.next_action_date ? 1 : 0));

    const done = leads.filter((l) => l._doneAt === today);

    // Rows are built off-screen and swapped in at once, so the page only
    // has to lay out the list one time however long it is.
    const activeRows = document.createDocumentFragment();
    active.forEach((lead) => {
      activeRows.appendChild(leadRowEl(lead, draftLabel(lead, today), isDue(lead, today) ? "due" : "upcoming"));
    });
    followupsListEl.textContent = "";
    followupsListEl.appendChild(activeRows);

    followupsEmptyEl.textContent = leads.length ? "No open leads." : "No leads yet.";
    followupsEmptyEl.classList.toggle("hidden", active.length + done.length > 0);

    const doneRows = document.createDocumentFragment();
    done.forEach((lead) => doneRows.appendChild(leadRowEl(lead, lead._doneLabel || "Sent", "done")));
    followupsDoneEl.textContent = "";
    followupsDoneEl.appendChild(doneRows);
    doneSectionEl.classList.toggle("hidden", done.length === 0);
    resetAreaEl.classList.toggle("hidden", leads.length === 0);
  }

  // Tapping a row opens a small panel under it: Send (only once due),
  // Call, Quoted, Won, Lost. One tap listener for the whole list — rows say
  // which lead they are via data-id. Done rows can't be tapped: a sent
  // reminder can't be undone.
  followupsListEl.addEventListener("click", (e) => {
    const row = e.target.closest(".lead-row");
    if (!row) return;
    const btn = e.target.closest("[data-action]");
    if (btn) handleRowAction(row.dataset.id, btn);
    else if (!e.target.closest(".row-panel")) toggleRow(row);
  });

  function toggleRow(row) {
    const wasOpen = row.classList.contains("open");
    followupsListEl.querySelectorAll(".lead-row.open").forEach((r) => {
      r.classList.remove("open");
      const panel = r.querySelector(".row-panel");
      if (panel) panel.remove();
    });
    if (wasOpen) return;
    const lead = getLeads().find((l) => l.lead_id === row.dataset.id);
    if (!lead) return;
    row.classList.add("open");
    row.appendChild(rowPanelEl(lead, todayStr()));
  }

  function rowPanelEl(lead, today) {
    const panel = document.createElement("div");
    panel.className = "row-panel";

    const info = document.createElement("div");
    info.className = "row-info";
    const size = [lead.length_ft, lead.breadth_ft, lead.height_ft].filter(Boolean).join(" × ");
    info.textContent = [
      lead.contact_name,
      formatPhone(lead.phone),
      enquiryNames(lead.enquiry),
      lead.music,
      lead.venue_type,
      size && `${size} ft`,
      lead.area_sqft && `${lead.area_sqft} sq ft`,
      lead.status === "quoted" && lead.quoted_on && `quoted ${formatDateHuman(lead.quoted_on)}`
    ].filter(Boolean).join(" · ");
    const mapUrl = lead.map_link || (lead.location && mapsUrl(lead.location));
    if (mapUrl) {
      const a = document.createElement("a");
      a.href = mapUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Map";
      info.append(" · ", a);
    }

    const { label } = stageInfo(lead);
    const send = document.createElement("button");
    send.type = "button";
    send.className = "row-send";
    send.dataset.action = "send";
    if (isDue(lead, today)) {
      send.textContent = `Send ${label}`;
    } else {
      send.textContent = `${label} · due ${formatDateHuman(lead.next_action_date)}`;
      send.disabled = true;
    }

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const call = document.createElement("a");
    call.className = "row-btn";
    call.href = `tel:${lead.phone}`;
    call.textContent = "Call";
    actions.appendChild(call);
    [["edit", "Edit"], ["quoted", lead.status === "quoted" ? "Requoted" : "Quoted"], ["won", "Won"], ["lost", "Lost"]].forEach(([action, text]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "row-btn";
      b.dataset.action = action;
      b.textContent = text;
      actions.appendChild(b);
    });

    panel.append(info, send, actions);
    return panel;
  }

  // Quoted, Won and Lost can't be undone, so each needs a second tap:
  // the first turns the button into "Confirm" for a few seconds.
  let armTimer = null;
  function disarm(btn) {
    if (!btn.classList.contains("armed")) return;
    btn.classList.remove("armed");
    btn.textContent = btn.dataset.text;
  }

  function handleRowAction(leadId, btn) {
    const action = btn.dataset.action;
    if (action === "send") { sendReminder(leadId); return; }
    if (action === "edit") { startEdit(leadId); return; }
    if (!btn.classList.contains("armed")) {
      btn.closest(".row-actions").querySelectorAll(".armed").forEach(disarm);
      btn.dataset.text = btn.textContent;
      btn.textContent = "Confirm";
      btn.classList.add("armed");
      clearTimeout(armTimer);
      armTimer = setTimeout(() => disarm(btn), 4000);
      return;
    }
    clearTimeout(armTimer);
    if (action === "quoted") markQuoted(leadId);
    else closeLead(leadId, action);
  }

  // Sends the reminder that's due, and moves the lead on to the next one —
  // due the next gap in the schedule after today (see stageInfo).
  function sendReminder(leadId) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    const today = todayStr();
    if (!lead || !isDue(lead, today)) return;

    const info = stageInfo(lead);
    openWhatsApp(lead.phone, fillTemplate(CONFIG.TEMPLATES[info.template] || "", messageVars(lead)));

    lead.reminder_stage = (lead.reminder_stage || 0) + 1;
    lead.next_action_date = addDays(today, gapForStage(trackFor(lead), lead.reminder_stage));
    lead.last_contacted = today;
    lead._doneAt = today;
    lead._doneLabel = `${info.label} sent`;

    saveLeads(leads);
    queueFollowupUpdate(lead, ["reminder_stage", "next_action_date", "last_contacted"]);
    renderFollowups();
  }

  // A quote has gone out: switch this lead to the quote-chase messages,
  // counting from today. Tapping it again (a revised quote) restarts them.
  function markQuoted(leadId) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead) return;
    const today = todayStr();
    lead.status = "quoted";
    lead.quoted_on = today;
    lead.schedule_anchor = today;
    lead.reminder_stage = 0;
    lead.next_action_date = addDays(today, gapForStage(TRACKS.quote, 0));
    saveLeads(leads);
    queueFollowupUpdate(lead, ["status", "quoted_on", "schedule_anchor", "reminder_stage", "next_action_date"]);
    renderFollowups();
  }

  // Won or lost: reminders stop for good. The lead shows under "Done
  // today" until midnight, then leaves the list. Logging a new visit for
  // the same site reopens it.
  function closeLead(leadId, outcome) {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === leadId);
    if (!lead) return;
    const today = todayStr();
    lead.status = outcome;
    lead.closed_on = today;
    lead.next_action_date = "";
    lead._doneAt = today;
    lead._doneLabel = outcome === "won" ? "Closed — won" : "Closed — lost";
    saveLeads(leads);
    queueFollowupUpdate(lead, ["status", "closed_on", "next_action_date"]);
    renderFollowups();
  }

  // ---- Start afresh on this phone ----
  // Removes every lead from this phone (the Follow-ups list and the site
  // chips). The Google Sheet, other phones, the passcode and the rep's
  // name are untouched. Made hard to do by accident: a small link at the
  // very bottom opens an explanation, CLEAR must be typed, and it refuses
  // while anything is still waiting to upload — checked again at the
  // moment of confirming — so an unsent visit can never be lost.

  const resetAreaEl = document.getElementById("reset-area");
  const resetLink = document.getElementById("reset-link");
  const resetPanel = document.getElementById("reset-panel");
  const resetText = document.getElementById("reset-text");
  const resetInput = document.getElementById("reset-input");
  const resetCancelBtn = document.getElementById("reset-cancel-btn");
  const resetConfirmBtn = document.getElementById("reset-confirm-btn");

  // How many items (rows, photos, follow-up changes) are still to upload.
  function queuedItemCount() {
    return Promise.all([idbStore.keys().catch(() => []), memStore.keys()]).then(([a, b]) => a.length + b.length);
  }

  function closeResetPanel() {
    resetPanel.classList.add("hidden");
    resetLink.classList.remove("hidden");
    resetInput.value = "";
  }

  function showResetBlocked() {
    resetText.textContent = "Some visits are still waiting to upload (see the badge at the top). They need signal to send. Once the badge has gone, try again — clearing now would lose them.";
    resetInput.classList.add("hidden");
    resetConfirmBtn.classList.add("hidden");
  }

  resetLink.addEventListener("click", () => {
    resetLink.classList.add("hidden");
    resetPanel.classList.remove("hidden");
    resetText.textContent = "Checking…";
    resetInput.classList.add("hidden");
    resetConfirmBtn.classList.add("hidden");
    queuedItemCount().then((n) => {
      if (n > 0) { showResetBlocked(); return; }
      const count = getLeads().length;
      resetText.textContent = `This removes all ${count} lead${count === 1 ? "" : "s"} from this phone's Follow-ups. ` +
        "It can't be undone. The Google Sheet, photos and other phones are not changed, and your passcode and name stay.";
      resetInput.classList.remove("hidden");
      resetConfirmBtn.classList.remove("hidden");
      resetConfirmBtn.disabled = true;
    });
  });

  resetInput.addEventListener("input", () => {
    resetConfirmBtn.disabled = resetInput.value.trim().toUpperCase() !== "CLEAR";
  });

  resetCancelBtn.addEventListener("click", closeResetPanel);

  resetConfirmBtn.addEventListener("click", () => {
    if (resetInput.value.trim().toUpperCase() !== "CLEAR") return;
    resetConfirmBtn.disabled = true;
    queuedItemCount().then((n) => {
      if (n > 0) { showResetBlocked(); return; }
      saveLeads([]);
      resetNewForm();
      closeResetPanel();
      renderFollowups();
      followupsEmptyEl.textContent = "Cleared. No leads on this phone.";
    });
  });

  // ---------------------------------------------------------------------
  // 7. New Entry tab
  // ---------------------------------------------------------------------

  const phoneInput = document.getElementById("phone-input");
  const phoneRow = document.getElementById("phone-row");
  const phoneError = document.getElementById("phone-error");
  const dupeLine = document.getElementById("dupe-line");
  const siteChipsEl = document.getElementById("site-chips");
  const contactNameInput = document.getElementById("contact-name-input");
  const venueInput = document.getElementById("venue-input");
  const venueTypeInput = document.getElementById("venue-type-input");
  const lengthInput = document.getElementById("length-input");
  const breadthInput = document.getElementById("breadth-input");
  const heightInput = document.getElementById("height-input");
  const areaInput = document.getElementById("area-input");
  const enquiryChipsEl = document.getElementById("enquiry-chips");
  const enquiryError = document.getElementById("enquiry-error");
  const noteInput = document.getElementById("note-input");
  const submitBtn = document.getElementById("submit-btn");
  const newForm = document.getElementById("new-form");
  const roomsContainerEl = document.getElementById("rooms-container");
  const addRoomBtn = document.getElementById("add-room-btn");
  const musicChipsEl = document.getElementById("music-chips");
  const locateBtn = document.getElementById("locate-btn");
  const locationLine = document.getElementById("location-line");
  const locationMap = document.getElementById("location-map");
  const mapLinkInput = document.getElementById("map-link-input");
  const newHeading = document.getElementById("new-heading");
  const cancelEditBtn = document.getElementById("cancel-edit-btn");
  const reviewEl = document.getElementById("review");
  const reviewListEl = document.getElementById("review-list");
  const reviewEditBtn = document.getElementById("review-edit-btn");
  const reviewConfirmBtn = document.getElementById("review-confirm-btn");

  let selectedSource = "site_visit";
  const selectedEnquiries = new Set(["sales"]);
  const selectedMusic = new Set();
  let editingId = null; // lead_id being edited (Edit in Follow-ups), or null for a new entry
  let photosProcessing = 0; // photos still being compressed; while above 0, Send waits ("Preparing photos…")

  // Phone: allow spaces while typing, keep it visually grouped
  phoneInput.addEventListener("input", () => {
    const digits = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    phoneInput.value = digits.replace(/(\d{5})(\d{1,5})/, "$1 $2");
    updateSubmitLabel();
    phoneError.textContent = "";
    phoneRow.classList.remove("error");
    onPhoneChanged();
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
    submitBtn.textContent = editingId ? "Review changes" : "Review";
  }
  updateSubmitLabel();

  // Type of contact: Site visit / Walk-in (one). Leads saved by older
  // versions may say "visit" or "inbound"; editing one keeps that value
  // unless a chip is tapped.
  const sourceChips = Array.from(document.querySelectorAll("#source-chips .chip"));
  function selectSource(value) {
    selectedSource = value;
    sourceChips.forEach((c) => c.classList.toggle("selected-dark", c.dataset.value === value));
  }
  sourceChips.forEach((c) => c.addEventListener("click", () => selectSource(c.dataset.value)));
  selectSource("site_visit");

  // A row of chips where any number can be picked. Returns a function that
  // redraws which ones are selected (after `selected` is changed in code).
  function multiChips(containerEl, entries, selected, onChange) {
    entries.forEach(([value, label]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.value = value;
      chip.textContent = label;
      chip.addEventListener("click", () => {
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        if (onChange) onChange();
        render();
      });
      containerEl.appendChild(chip);
    });
    function render() {
      containerEl.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected-dark", selected.has(c.dataset.value)));
    }
    render();
    return render;
  }

  // Enquiry: one chip per CONFIG.ENQUIRIES. Type of music: one per CONFIG.MUSIC_TYPES.
  const renderEnquiryChips = multiChips(enquiryChipsEl, Object.keys(CONFIG.ENQUIRIES).map((k) => [k, enquiryName(k)]),
    selectedEnquiries, () => { enquiryError.textContent = ""; });
  const renderMusicChips = multiChips(musicChipsEl, CONFIG.MUSIC_TYPES.map((m) => [m, m]), selectedMusic);

  // Saved as e.g. "Background, DJ", in the order of CONFIG.MUSIC_TYPES.
  function musicValue() {
    return CONFIG.MUSIC_TYPES.filter((m) => selectedMusic.has(m)).join(", ");
  }

  // ---- Location ----
  // "Pin my current location" asks the phone for its position (free, no
  // key; GPS works without signal; needs location permission once). Two
  // requests run together: a quick, rougher fix (Wi-Fi / mobile towers, or
  // a fix the phone got in the last 2 minutes) so something shows within a
  // second or two, and the GPS, which keeps refining for up to a minute and
  // stops early once it is within 20 m. The most precise fix is kept.
  // Tapping the button again while it searches stops it. If nothing at all
  // arrives, it says why. A walk-in client's site can't be pinned from the
  // shop, so a Google Maps link can be pasted instead (coordinates are read
  // from it when the link contains them).
  let pinned = null; // { lat, lng, acc } or null
  let watchId = null;
  let locateTimer = null;
  let locating = false;
  let mapWanted = false; // show the map preview for the current pin?
  const GOOD_ENOUGH_M = 20;
  const LOCATE_MAX_MS = 60000;

  function locationText(p) {
    return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
  }

  function stopLocating() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearTimeout(locateTimer);
    locating = false;
    locateBtn.textContent = pinned ? "Re-pin my current location" : "Pin my current location";
  }

  function locationMessage(text) {
    locationLine.textContent = text;
    locationLine.classList.remove("hidden");
  }

  function showPinned() {
    locationLine.textContent = "";
    if (!pinned) {
      locationLine.classList.add("hidden");
      locationMap.classList.add("hidden");
      locationMap.removeAttribute("src");
      return;
    }
    const link = document.createElement("a");
    link.href = mapsUrl(locationText(pinned));
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open in Maps";
    const refining = locating ? " · improving…" : "";
    locationLine.append(`${locationText(pinned)}${pinned.acc ? ` · ±${Math.round(pinned.acc)} m` : ""}${refining} · `, link);
    locationLine.classList.remove("hidden");
    // A small OpenStreetMap preview (free, no key) — only with signal, and
    // only once the rep asks for it: straight away after pinning, or by
    // tapping "Show map" for a location filled in from a saved site. That
    // way a site's coordinates only go to OpenStreetMap when someone
    // actually wants to see the map, not every time its number is typed.
    if (!mapWanted) {
      locationMap.classList.add("hidden");
      locationMap.removeAttribute("src");
      const show = document.createElement("a");
      show.href = "#";
      show.textContent = "Show map";
      show.addEventListener("click", (e) => { e.preventDefault(); mapWanted = true; showPinned(); });
      locationLine.append(" · ", show);
      return;
    }
    if (navigator.onLine !== false) {
      const d = 0.002;
      const src = "https://www.openstreetmap.org/export/embed.html?bbox=" +
        `${pinned.lng - d},${pinned.lat - d},${pinned.lng + d},${pinned.lat + d}&layer=mapnik&marker=${pinned.lat},${pinned.lng}`;
      if (locationMap.getAttribute("src") !== src) locationMap.src = src;
      locationMap.classList.remove("hidden");
    }
  }

  // Plain-language help for each way asking for the location can fail.
  function locationErrorText(err) {
    const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (err.code === 1) {
      return iPhone
        ? "Location is blocked. On the iPhone: Settings → Privacy & Security → Location Services → turn it on, and set Safari Websites to \"While Using\". Then try again, or paste a Maps link."
        : "Location is blocked for this app. In Chrome: ⋮ → Settings → Site settings → Location → allow this site, and make sure the phone's Location is on. Then try again, or paste a Maps link.";
    }
    if (err.code === 2) {
      return iPhone
        ? "The phone couldn't find its location. Check Settings → Privacy & Security → Location Services is on, then try again near a window or outdoors."
        : "The phone couldn't find its location. Check Location is switched on (pull down from the top of the screen), then try again near a window or outdoors.";
    }
    return "Couldn't get a location in time — try again near a window or outdoors, or paste a Maps link.";
  }

  locateBtn.addEventListener("click", () => {
    if (locating) { stopLocating(); showPinned(); return; }
    if (!navigator.geolocation || !window.isSecureContext) {
      locationMessage("This phone can't share its location here — paste a Maps link instead.");
      return;
    }
    locating = true;
    mapWanted = true;
    locateBtn.textContent = "Finding location… tap to stop";
    locationMessage("Finding location — the first fix can take up to a minute indoors.");
    const startedWith = pinned;
    let best = null;
    let lastError = null;

    function take(pos) {
      if (!locating) return;
      const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      if (best && fix.acc >= best.acc) return;
      best = fix;
      pinned = fix;
      if (fix.acc <= GOOD_ENOUGH_M) stopLocating();
      showPinned();
    }
    function fail(err) {
      lastError = err;
      if (!locating || best) return;
      // A refusal or "location switched off" won't fix itself — stop now.
      // A timeout on the quick fix just leaves the GPS to keep trying.
      if (err.code === 1 || err.code === 2) {
        stopLocating();
        pinned = startedWith;
        showPinned();
        locationMessage(locationErrorText(err));
      }
    }

    navigator.geolocation.getCurrentPosition(take, fail, { enableHighAccuracy: false, maximumAge: 120000, timeout: LOCATE_MAX_MS });
    watchId = navigator.geolocation.watchPosition(take, fail, { enableHighAccuracy: true, maximumAge: 0 });
    locateTimer = setTimeout(() => {
      if (!locating) return;
      stopLocating();
      if (best) { showPinned(); return; }
      pinned = startedWith;
      showPinned();
      locationMessage(locationErrorText(lastError || { code: 3 }));
    }, LOCATE_MAX_MS);
  });

  // Reads coordinates out of a pasted Maps link, e.g. ".../@15.59,73.74,17z"
  // or "...?q=15.59,73.74". Short links (maps.app.goo.gl) have none — the
  // link itself is still saved.
  function coordsFromLink(link) {
    const m = link.match(/(?:@|[?&](?:q|ll|query)=)(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
    return m ? { lat: Number(m[1]), lng: Number(m[2]), acc: 0 } : null;
  }

  // The location fields saved to the Sheet.
  function locationValues() {
    const pasted = mapLinkInput.value.trim();
    const p = pinned || (pasted && coordsFromLink(pasted));
    return {
      location: p ? locationText(p) : "",
      location_accuracy_m: p && p.acc ? String(Math.round(p.acc)) : "",
      map_link: pasted || (p ? mapsUrl(locationText(p)) : "")
    };
  }

  function setLocation(record) {
    if (locating) stopLocating();
    const m = record && String(record.location || "").match(/(-?[\d.]+),\s*(-?[\d.]+)/);
    pinned = m ? { lat: Number(m[1]), lng: Number(m[2]), acc: Number(record.location_accuracy_m) || 0 } : null;
    mapWanted = false;
    const link = record ? String(record.map_link || "") : "";
    mapLinkInput.value = link && !(pinned && link === mapsUrl(locationText(pinned))) ? link : "";
    stopLocating();
    showPinned();
  }

  CONFIG.VENUE_TYPES.forEach((type) => {
    const option = document.createElement("option");
    option.value = option.textContent = type;
    venueTypeInput.appendChild(option);
  });
  // Makes sure a saved venue type shows even if it's since been removed
  // from CONFIG.VENUE_TYPES.
  function setVenueType(value) {
    if (value && !Array.from(venueTypeInput.options).some((o) => o.value === value)) {
      const option = document.createElement("option");
      option.value = option.textContent = value;
      venueTypeInput.appendChild(option);
    }
    venueTypeInput.value = value || "";
  }

  // Venue size: area fills itself in as length × breadth, unless it has
  // been typed in by hand.
  let areaTyped = false;
  areaInput.addEventListener("input", () => { areaTyped = areaInput.value.trim() !== ""; });
  function autoArea() {
    if (areaTyped) return;
    const l = parseFloat(lengthInput.value);
    const b = parseFloat(breadthInput.value);
    areaInput.value = l > 0 && b > 0 ? String(Math.round(l * b)) : "";
  }
  lengthInput.addEventListener("input", autoArea);
  breadthInput.addEventListener("input", autoArea);
  function cleanNumber(value) {
    return value.replace(/[^\d.]/g, "");
  }

  // ---- Owners with several sites ----
  // Each site (venue) is its own lead, with its own Sheet row and its own
  // reminders; an owner's sites share a phone number. Once 10 digits are
  // typed, this number's sites appear as chips — straight away for the
  // ones on this phone, then any others the Sheet knows about — plus
  // "+ New site". The newest site is picked unless the rep picks another.

  let sheetSites = [];     // this number's sites according to the Sheet
  let siteChoice = null;   // lead_id of the site this entry is for, "new", or null (none yet)
  let siteChosenByRep = false;
  let sitesForDigits = ""; // the number the site chips are showing

  function siteSortKey(site) {
    return site.last_contacted || site.visit_date || site.created_at || "";
  }

  // This phone's leads and the Sheet's rows for the number, merged (the
  // phone's copy wins for a site on both), newest first.
  function sitesFor(digits) {
    const fullPhone = "+91" + digits;
    const byId = {};
    sheetSites.forEach((s) => { byId[s.lead_id] = s; });
    getLeads().forEach((l) => { if (l.phone === fullPhone) byId[l.lead_id] = l; });
    return Object.keys(byId).map((id) => byId[id])
      .sort((a, b) => (siteSortKey(a) < siteSortKey(b) ? 1 : siteSortKey(a) > siteSortKey(b) ? -1 : 0));
  }

  function onPhoneChanged() {
    if (editingId) return; // editing a saved lead: it's already that site
    const digits = currentPhoneDigits();
    if (digits === sitesForDigits) return;
    sitesForDigits = digits;
    sheetSites = [];
    siteChoice = null;
    siteChosenByRep = false;
    renderSites();
    if (digits.length === 10) lookupSites(digits);
  }

  // Asks the Sheet for this number's sites. Silent on failure — never
  // blocks the form; the phone's own sites are already showing.
  function lookupSites(digits) {
    if (!hasBackend() || !isUnlocked()) return;
    checkServerVersion(MIN_SERVER_VERSION.lookup)
      .then((state) => (state === "ok" ? postToScript({ kind: "lookup", phone: "+91" + digits }, getKey(), LEAD_TIMEOUT_MS) : null))
      .then((data) => {
        if (data && data.auth) { relock(); return; }
        if (currentPhoneDigits() !== digits) return; // number changed while we were asking
        if (data && data.found && data.records) {
          sheetSites = data.records.filter((r) => r.lead_id).map((r) => Object.assign({}, r, { lead_id: String(r.lead_id) }));
          renderSites();
        }
      })
      .catch(() => {});
  }

  function renderSites() {
    const digits = currentPhoneDigits();
    const sites = digits.length === 10 ? sitesFor(digits) : [];
    siteChipsEl.textContent = "";
    if (sites.length === 0) {
      dupeLine.classList.add("hidden");
      siteChipsEl.classList.add("hidden");
      siteChoice = null;
      return;
    }
    if (!siteChosenByRep && siteChoice !== sites[0].lead_id) {
      siteChoice = sites[0].lead_id;
      fillFromSite(sites[0]);
    }

    const newest = sites[0];
    const last = /^\d{4}-\d{2}-\d{2}$/.test(newest.last_contacted) ? formatDateHuman(newest.last_contacted) : "—";
    dupeLine.textContent = sites.length === 1
      ? `${newest.contact_name || ""} · ${newest.venue || ""} · last contacted ${last}`
      : `${newest.contact_name || ""} · ${sites.length} sites · last contacted ${last}`;
    dupeLine.classList.remove("hidden");

    sites.concat([{ lead_id: "new" }]).forEach((site) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.classList.toggle("selected-dark", site.lead_id === siteChoice);
      chip.textContent = site.lead_id === "new"
        ? "+ New site"
        : (site.venue || "No venue name") + (isClosed(site) ? ` · ${site.status}` : "");
      chip.addEventListener("click", () => {
        siteChosenByRep = true;
        siteChoice = site.lead_id;
        fillFromSite(site.lead_id === "new" ? null : site);
        renderSites();
      });
      siteChipsEl.appendChild(chip);
    });
    siteChipsEl.classList.remove("hidden");
  }

  // Fills in the form from a site already on record, or (null) clears the
  // site's own details for a new site of the same owner.
  function fillFromSite(site) {
    if (site && site.contact_name) contactNameInput.value = site.contact_name;
    venueInput.value = site ? site.venue || "" : "";
    setVenueType(site ? site.venue_type : "");
    lengthInput.value = site ? site.length_ft || "" : "";
    breadthInput.value = site ? site.breadth_ft || "" : "";
    heightInput.value = site ? site.height_ft || "" : "";
    areaInput.value = site ? site.area_sqft || "" : "";
    areaTyped = !!areaInput.value && !(lengthInput.value && breadthInput.value);
    selectedMusic.clear();
    if (site && site.music) String(site.music).split(/,\s*/).forEach((m) => selectedMusic.add(m));
    renderMusicChips();
    setLocation(site);
  }

  // Photos: room-based, each room has one labeled slot per
  // CONFIG.ROOM_LABELS (always in capitals). Per label, each room keeps:
  //   photos  — the compressed photo that gets uploaded (up to 1600px)
  //   thumbs  — a small copy for the on-screen thumbnail. Showing the full
  //             photo in a small square would hold ~8MB of memory per photo,
  //             enough to crash the page on a mid-range phone with many photos
  //   failed  — true if the photo couldn't be read, so the slot says "Try again"
  //   latest  — which attempt is newest, so a slow earlier shot can't
  //             overwrite a quick retake
  const THUMB_EDGE = 192;
  let rooms = [];

  function newRoom() {
    return { labels: CONFIG.ROOM_LABELS.map((l) => String(l).toUpperCase()), photos: {}, thumbs: {}, failed: {}, latest: {} };
  }

  function resetRooms() {
    rooms = [newRoom()];
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
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-btn";
        remove.textContent = "Remove room";
        remove.addEventListener("click", () => removeRoom(room, remove));
        heading.append(`ROOM ${roomIndex + 1}`, remove);
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
        caption.textContent = room.failed[label] ? "TRY AGAIN" : label;

        cell.appendChild(slot);
        cell.appendChild(caption);
        row.appendChild(cell);
      });

      block.appendChild(row);
      roomsContainerEl.appendChild(block);
    });
  }

  // Removes a room that isn't needed (the rooms after it move up a
  // number). If it already has photos, the first tap asks to confirm.
  function removeRoom(room, btn) {
    if (Object.keys(room.photos).length && !btn.classList.contains("armed")) {
      btn.classList.add("armed");
      btn.textContent = "Tap again to remove its photos";
      setTimeout(() => {
        if (!btn.isConnected || !btn.classList.contains("armed")) return;
        btn.classList.remove("armed");
        btn.textContent = "Remove room";
      }, 4000);
      return;
    }
    rooms = rooms.filter((r) => r !== room);
    renderRooms();
  }

  addRoomBtn.addEventListener("click", () => {
    rooms.push(newRoom());
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

  // The fields of a lead that go to its Sheet row (photo_folder and
  // updated_at are filled in by the Apps Script).
  const LEAD_FIELDS = [
    "lead_id", "created_at", "rep", "phone", "contact_name", "venue", "enquiry",
    "visit_date", "note", "reminder_stage", "schedule_anchor", "next_action_date",
    "last_contacted", "status", "source", "venue_type", "length_ft", "breadth_ft",
    "height_ft", "area_sqft", "visit_type", "quoted_on", "closed_on",
    "music", "location", "location_accuracy_m", "map_link"
  ];

  // new → quoted → won/lost. When the phone and the Sheet disagree about a
  // site (e.g. "quoted" set on another phone, or by hand in the Sheet),
  // the further-along one is kept.
  const STATUS_RANK = { new: 0, quoted: 1, won: 2, lost: 2 };

  // Everything a lead's form holds, as the fields saved to the Sheet.
  function formValues() {
    return Object.assign({
      phone: "+91" + currentPhoneDigits(),
      contact_name: contactNameInput.value.trim(),
      venue: venueInput.value.trim(),
      venue_type: venueTypeInput.value,
      length_ft: cleanNumber(lengthInput.value),
      breadth_ft: cleanNumber(breadthInput.value),
      height_ft: cleanNumber(heightInput.value),
      area_sqft: cleanNumber(areaInput.value),
      enquiry: Object.keys(CONFIG.ENQUIRIES).filter((k) => selectedEnquiries.has(k)).join(", "),
      music: musicValue(),
      visit_type: selectedSource,
      note: noteInput.value.trim()
    }, locationValues());
  }

  const CONTACT_TYPES = { site_visit: "Site visit", walkin: "Walk-in", visit: "Field visit", inbound: "Inbound" };

  // Step 1 — "Review": check the form, then show everything that will be
  // saved. Nothing is saved or sent until Confirm.
  newForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (photosProcessing > 0) return; // a photo is still being prepared — Review is disabled until it's done

    const digits = currentPhoneDigits();
    if (digits.length !== 10) {
      phoneError.textContent = "Enter a 10-digit phone number.";
      phoneRow.classList.add("error");
      phoneInput.focus();
      return;
    }
    if (selectedEnquiries.size === 0) {
      enquiryError.textContent = "Pick at least one enquiry.";
      return;
    }
    showReview();
  });

  function showReview() {
    const v = formValues();
    const size = [v.length_ft, v.breadth_ft, v.height_ft].filter(Boolean).join(" × ");
    const photoCounts = rooms.map((r, i) => `Room ${i + 1}: ${Object.keys(r.photos).length}`).join(" · ");
    const siteId = siteChoice && siteChoice !== "new" ? siteChoice : null;
    const rows = [
      ["Type of contact", CONTACT_TYPES[v.visit_type] || v.visit_type],
      ["Phone", formatPhone(v.phone)],
      !editingId && sitesFor(currentPhoneDigits()).length > 0 && ["Site", siteId ? "Existing site (updates it)" : "New site"],
      ["Contact name", v.contact_name],
      ["Venue", v.venue],
      ["Venue type", v.venue_type],
      ["Size", [size && `${size} ft`, v.area_sqft && `${v.area_sqft} sq ft`].filter(Boolean).join(" · ")],
      ["Location", v.location || (v.map_link ? "Maps link" : "")],
      ["Enquiry", enquiryNames(v.enquiry)],
      ["Music", v.music],
      ["Photos", editingId && !rooms.some((r) => Object.keys(r.photos).length) ? "No new photos" : photoCounts],
      ["Note", v.note]
    ].filter(Boolean);

    reviewListEl.textContent = "";
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value || "—";
      if (!value) dd.className = "empty";
      row.append(dt, dd);
      reviewListEl.appendChild(row);
    });
    reviewConfirmBtn.textContent = editingId ? "Save changes" : `Send to ${formatPhone(v.phone)}`;
    newHeading.textContent = editingId ? "Check changes" : "Check and send";
    newForm.classList.add("hidden");
    reviewEl.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function hideReview() {
    reviewEl.classList.add("hidden");
    newForm.classList.remove("hidden");
    newHeading.textContent = editingId ? "Edit lead" : "New entry";
  }

  reviewEditBtn.addEventListener("click", () => { hideReview(); window.scrollTo(0, 0); });

  // Step 2 — Confirm: save to the phone and the upload queue (and, for a
  // new entry, open WhatsApp — it must open within this tap, or phones
  // block it).
  reviewConfirmBtn.addEventListener("click", () => {
    if (editingId) saveEdit();
    else saveNewEntry();
  });

  function queueLeadWithPhotos(lead) {
    const payload = { photos: collectPhotosPayload() };
    LEAD_FIELDS.forEach((f) => { payload[f] = lead[f] != null ? lead[f] : ""; });
    queueLead(payload);
  }

  function saveNewEntry() {
    const today = todayStr();
    const leads = getLeads();

    // Which site is this for? One already on this phone, one the Sheet
    // knows about (logged by another rep or phone — take over its lead_id
    // so this entry updates that row instead of adding a duplicate), or a
    // new one.
    const siteId = siteChoice && siteChoice !== "new" ? siteChoice : null;
    const rec = siteId ? sheetSites.find((s) => s.lead_id === siteId) : null;
    let lead = siteId ? leads.find((l) => l.lead_id === siteId) : null;
    if (!lead && rec) {
      lead = { lead_id: rec.lead_id, created_at: rec.created_at || today, status: rec.status || "new", source: rec.source || selectedSource, quoted_on: rec.quoted_on || "" };
      leads.push(lead);
    } else if (lead && rec && (STATUS_RANK[rec.status] || 0) > (STATUS_RANK[lead.status] || 0)) {
      lead.status = rec.status;
      lead.quoted_on = rec.quoted_on || lead.quoted_on;
    }
    if (!lead) {
      lead = { lead_id: String(Date.now()), created_at: today, status: "new", source: selectedSource };
      leads.push(lead);
    }

    // A new contact with a won or lost site reopens it.
    if (isClosed(lead)) {
      lead.status = "new";
      lead.closed_on = "";
    }
    delete lead._doneAt;
    delete lead._doneLabel;

    Object.assign(lead, formValues());
    lead.rep = getRep();
    lead.visit_date = today;

    // Every contact restarts the reminders, counting from today (a quoted
    // site restarts its quote chases).
    lead.schedule_anchor = today;
    lead.reminder_stage = 0;
    lead.last_contacted = today;
    lead.next_action_date = addDays(today, gapForStage(trackFor(lead), 0));

    saveLeads(leads);
    queueLeadWithPhotos(lead);

    const template = CONFIG.TEMPLATES["first_" + selectedSource] || CONFIG.TEMPLATES.first_site_visit;
    openWhatsApp(lead.phone, fillTemplate(template, messageVars(lead)));

    resetNewForm();
    switchTab("tab-followups");
  }

  // ---- Editing a saved lead (Edit in its Follow-ups panel) ----
  // Opens the lead in this form. Saving changes its details (and adds any
  // new photos) without restarting its reminders or sending a message.

  function startEdit(leadId) {
    const lead = getLeads().find((l) => l.lead_id === leadId);
    if (!lead) return;
    resetNewForm();
    editingId = leadId;
    newHeading.textContent = "Edit lead";
    cancelEditBtn.classList.remove("hidden");
    phoneInput.value = lead.phone.slice(3).replace(/(\d{5})(\d{5})/, "$1 $2");
    contactNameInput.value = lead.contact_name || "";
    fillFromSite(lead);
    selectSource(lead.visit_type || lead.source || "site_visit");
    selectedEnquiries.clear();
    enquiryKeys(lead.enquiry).forEach((k) => selectedEnquiries.add(k));
    renderEnquiryChips();
    noteInput.value = lead.note || "";
    updateSubmitLabel();
    switchTab("tab-new");
    window.scrollTo(0, 0);
  }

  function saveEdit() {
    const leads = getLeads();
    const lead = leads.find((l) => l.lead_id === editingId);
    if (lead) {
      Object.assign(lead, formValues());
      saveLeads(leads);
      queueLeadWithPhotos(lead);
    }
    resetNewForm();
    switchTab("tab-followups");
  }

  cancelEditBtn.addEventListener("click", () => {
    resetNewForm();
    switchTab("tab-followups");
  });

  function resetNewForm() {
    editingId = null;
    newHeading.textContent = "New entry";
    cancelEditBtn.classList.add("hidden");
    reviewEl.classList.add("hidden");
    newForm.classList.remove("hidden");
    phoneInput.value = "";
    contactNameInput.value = "";
    noteInput.value = "";
    fillFromSite(null);
    areaTyped = false;
    phoneError.textContent = "";
    enquiryError.textContent = "";
    phoneRow.classList.remove("error");
    onPhoneChanged();
    resetRooms();
    updateSubmitLabel();
    selectSource("site_visit");
    selectedEnquiries.clear();
    selectedEnquiries.add("sales");
    renderEnquiryChips();
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

  // A Follow-ups action (Send, Quoted, Won, Lost) changes only a few of a
  // lead's fields; this sends just those, so it can't overwrite anything
  // newer in the Sheet — like a later visit logged on another phone.
  function queueFollowupUpdate(lead, fields) {
    const item = { kind: "update", lead_id: lead.lead_id };
    fields.forEach((f) => { item[f] = lead[f] != null ? lead[f] : ""; });
    queueItems([item]);
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

  // Before sending anything, check the Apps Script deployment is new
  // enough to understand it. An older deployment could mistake it for a
  // whole lead, write a damaged row, or drop the new columns (venue type,
  // size, quoted/closed), so it waits in the queue until the new script is
  // deployed. The version is remembered on the phone (every answer from
  // the script carries it), so this usually costs no extra call.
  const MIN_SERVER_VERSION = { lead: 6, photo: 2, update: 5, verify: 4, lookup: 6 };
  let serverVersion = Number(localStorage.getItem(STORE_KEYS.serverVersion)) || 0;
  function rememberServerVersion(v) {
    serverVersion = v;
    try { localStorage.setItem(STORE_KEYS.serverVersion, String(v)); } catch (e) { /* storage full: just ask again next time */ }
  }
  function checkServerVersion(min) {
    if (serverVersion >= min) return Promise.resolve("ok");
    return timedFetch(`${CONFIG.APPS_SCRIPT_URL}?v=1`, {}, LEAD_TIMEOUT_MS)
      .then((r) => r.json())
      .then((data) => {
        rememberServerVersion((data && data.v) || 1);
        return serverVersion >= min ? "ok" : "rejected";
      }, () => "network");
  }

  // POSTs to the Apps Script with the passcode added. Resolves with the
  // script's JSON answer; rejects if there's no answer (no signal, timeout,
  // or a Google error page). The passcode is added here, at send time — it
  // is never stored inside queued items.
  function postToScript(body, key, timeoutMs) {
    return timedFetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({}, body, { key }))
    }, timeoutMs).then((r) => {
      if (!r.ok) throw new Error("bad status");
      return r.json();
    }).then((data) => {
      if (data && data.v && data.v !== serverVersion) rememberServerVersion(data.v);
      return data;
    });
  }

  // Sends one queue item. Resolves with:
  //   "ok"       — the Apps Script saved it; safe to delete from the phone
  //   "network"  — no signal, timeout, or a Google error page; stop for now
  //   "rejected" — the Apps Script answered but refused it; leave it queued
  //                and carry on with the rest of the queue
  // A wrong-passcode answer re-locks the app and counts as "network": the
  // item waits until the new passcode is entered.
  // A "busy" answer (the Sheet was tied up by other uploads) counts as
  // "network": nothing wrong with the item, just try again shortly.
  function sendItem(item) {
    if (!getKey()) return Promise.resolve("network"); // locked: wait until the passcode is entered
    const minVersion = MIN_SERVER_VERSION[item.kind];
    const gate = minVersion ? checkServerVersion(minVersion) : Promise.resolve("ok");
    return gate.then((state) => {
      if (state !== "ok") return state;
      const body = Object.assign({}, item);
      delete body.qid;
      return postToScript(body, getKey(), item.kind === "photo" ? PHOTO_TIMEOUT_MS : LEAD_TIMEOUT_MS)
        .then((data) => {
          if (data && data.ok === true) return "ok";
          if (data && data.auth) { relock(); return "network"; }
          return data && data.busy ? "network" : "rejected";
        }, () => "network");
    });
  }

  const rejectedUntil = {}; // "store:qid" -> time before which we don't re-send it

  // A lead's row and follow-up updates must reach the Sheet in the order
  // they happened, or an older one could overwrite a newer one. So once
  // one of them is held back (refused, or waiting to retry), everything
  // after it for that lead waits too (state.held).
  function drainStore(store, state) {
    return store.keys().catch(() => []).then((keys) => keys.reduce((chain, key) => chain.then(() => {
      if (state.stop) return;
      const tag = `${store.name}:${key}`;
      return store.get(key).then((item) => {
        if (!item) return; // already sent (e.g. by another open copy of the app)
        const inOrder = item.kind === "lead" || item.kind === "update";
        if (state.held.has(item.lead_id) || rejectedUntil[tag] > Date.now()) {
          if (inOrder) state.held.add(item.lead_id);
          return;
        }
        return sendItem(item).then((result) => {
          if (result === "ok") {
            delete rejectedUntil[tag];
            return store.del(key).then(renderQueueBadge);
          }
          if (result === "network") state.stop = true;
          else rejectedUntil[tag] = Date.now() + REJECTED_PAUSE_MS;
          if (inOrder) state.held.add(item.lead_id);
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
    if (!hasBackend() || !isUnlocked()) return Promise.resolve();
    if (draining) { drainRequested = true; return Promise.resolve(); }
    draining = true;
    drainRequested = false;
    const run = () => {
      const state = { stop: false, held: new Set() };
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
