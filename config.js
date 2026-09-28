// ============================================================================
// CONFIG.JS — every value you might want to change lives in this one file.
// Nothing else in the app needs editing for normal use.
// ============================================================================

const CONFIG = {
  // Paste the URL you get after deploying the Apps Script as a Web App.
  // It will look like: https://script.google.com/macros/s/AKfycb.../exec
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby0FDcwHB7LoKkEqs1MaOE2JD7WDHg5nsArNaB6ZLxOWmn3IXLqrQiXtcvQuoI9eSVI/exec",

  // A simple lock screen shown once per phone before the app can be used.
  // This is NOT strong security — anyone who reads the app's code could
  // find this value — but it stops casual/accidental access to a link
  // that shouldn't be public. Change this to whatever you like.
  PASSCODE: "1234",

  // Brochure links — one per enquiry type. These are sent inside the
  // WhatsApp message so the customer can tap through to see products.
  // If you only have one brochure, set all three to the same URL.
  BROCHURE: {
    sales:     "BROCHURE_URL_SALES_PLACEHOLDER",
    service:   "BROCHURE_URL_SERVICE_PLACEHOLDER",
    acoustics: "BROCHURE_URL_ACOUSTICS_PLACEHOLDER"
  },

  // Shown inside message templates wherever {company} appears.
  COMPANY_NAME: "Just Audio",

  // The automatic follow-up cadence, counted in days from the date of the
  // visit (not from today, and not from the previous nudge). A lead's very
  // first reminder falls due REMINDER_SCHEDULE_DAYS[0] days after the visit,
  // the second at REMINDER_SCHEDULE_DAYS[1], and so on. Once the schedule
  // runs out, reminders keep repeating every MONTHLY_INTERVAL_DAYS days.
  // Default below = 2 days, then 1 week, then 2 weeks, then monthly.
  REMINDER_SCHEDULE_DAYS: [2, 7, 14],
  MONTHLY_INTERVAL_DAYS: 30,

  // Photo labels for the first room logged against a lead.
  ROOM_ONE_LABELS: ["Front wall", "Left wall", "Right wall", "Back wall", "Ceiling"],

  // Photo labels used for every room added after the first, via
  // "+ Add another room" on the New Entry screen.
  EXTRA_ROOM_LABELS: ["Front wall", "Left wall", "Right wall", "Back wall", "Ceiling", "Overview"],

  // Message templates. Placeholders {name} {venue} {brochure} {rep} {company}
  // are swapped for real values right before the WhatsApp message is built.
  // Use \n for a line break — it will show as a real line break on WhatsApp.
  TEMPLATES: {
    // Sent the moment a Sales visit is logged (New Entry submit).
    first_sales:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Good speaking with you at {venue}. We would love to put together a sound system quote for your space, and can arrange a free site survey at a time that suits you.\n\n" +
      "Here is a bit about what we do: {brochure}\n\n" +
      "Let me know a good time to visit.",

    // Sent the moment a Service visit is logged (New Entry submit).
    first_service:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Good speaking with you at {venue}. Happy to take a look at your current setup and sort out any issues you are facing.\n\n" +
      "A little more on our service work: {brochure}\n\n" +
      "Let me know a time that works and we will come by.",

    // Sent the moment an Acoustics visit is logged (New Entry submit).
    first_acoustics:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Good speaking with you at {venue}. We can take a look at the room and suggest some simple ways to improve the sound and cut down on complaints.\n\n" +
      "Here is some background on our acoustics work: {brochure}\n\n" +
      "Let me know a good time to visit.",

    // Reminder #1 — sent REMINDER_SCHEDULE_DAYS[0] days after the visit (default: 2 days).
    nudge_2day:
      "Hi {name}, this is {rep} from {company}, following up after visiting {venue}.\n\n" +
      "Just checking you received everything you needed from our chat — happy to answer any questions.",

    // Reminder #2 — sent REMINDER_SCHEDULE_DAYS[1] days after the visit (default: 1 week).
    nudge_1week:
      "Hi {name}, this is {rep} from {company}, checking in again about {venue}.\n\n" +
      "Wanted to see if you have had a chance to think this over, and if there is anything I can help with.",

    // Reminder #3 — sent REMINDER_SCHEDULE_DAYS[2] days after the visit (default: 2 weeks).
    nudge_2week:
      "Hi {name}, this is {rep} from {company}, following up once more on {venue}.\n\n" +
      "No pressure at all — just let me know if the timing works better later, or if you would like another look at the numbers.",

    // Reminder #4 onward — sent every MONTHLY_INTERVAL_DAYS days after that (default: monthly).
    nudge_monthly:
      "Hi {name}, this is {rep} from {company}, touching base again about {venue}.\n\n" +
      "We are still very happy to help whenever the time is right — just let me know.",

    // Sent when a quote has gone out and is overdue for a reply
    // (used only when a lead's status is manually set to "quoted").
    quote_chase:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Checking in on the quote we sent over for {venue}. Happy to answer any questions or adjust anything to fit your budget.",

    // Available for manual use — not sent automatically by the schedule.
    survey_offer:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "If it helps, we can arrange a free, no-obligation site survey at {venue} so you can see exactly what we would suggest before deciding anything."
  }
};
