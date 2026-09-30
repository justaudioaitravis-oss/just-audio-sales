// ============================================================================
// CONFIG.JS — every value you might want to change lives in this one file.
// Nothing else in the app needs editing for normal use.
// ============================================================================

const CONFIG = {
  // Paste the URL you get after deploying the Apps Script as a Web App.
  // It will look like: https://script.google.com/macros/s/AKfycb.../exec
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby0FDcwHB7LoKkEqs1MaOE2JD7WDHg5nsArNaB6ZLxOWmn3IXLqrQiXtcvQuoI9eSVI/exec",

  // The passcode is NOT kept here: this file is public on GitHub. It lives
  // in the Apps Script's private settings (Project Settings → Script
  // Properties → PASSCODE) — see README, "Changing the passcode".

  // The brochure link sent inside WhatsApp messages wherever {brochure}
  // appears. One brochure covers every service. While this is left empty
  // (""), the "Our brochure" line is left out of messages automatically.
  BROCHURE_URL: "",

  // The website link sent at the end of every WhatsApp message ({website}).
  WEBSITE_URL: "https://www.justaudioindia.com/",

  // Shown inside message templates wherever {company} appears.
  COMPANY_NAME: "Just Audio",

  // The automatic follow-up cadence. Each number is the gap in days since
  // the PREVIOUS message went out — the next reminder can't be sent before
  // then. So by default: 2 days after the first message, then 1 week after
  // that nudge, then 2 weeks after that one, then every MONTHLY_INTERVAL_DAYS.
  // Sent reminders can't be undone.
  REMINDER_SCHEDULE_DAYS: [2, 7, 14],
  MONTHLY_INTERVAL_DAYS: 30,

  // The same, for chasing a quote once "Quoted" is tapped on a Follow-ups
  // lead: counted from the day it was quoted, then from each chase sent.
  // After the list runs out, chases repeat every MONTHLY_INTERVAL_DAYS.
  QUOTE_SCHEDULE_DAYS: [2, 7, 14],

  // Enquiry chips on the New entry screen. More than one can be picked.
  // The words on the right are what goes into {services} in the first
  // message, e.g. "a new sound system and acoustic treatment".
  ENQUIRIES: {
    sales:      "a new sound system",
    service:    "servicing your current setup",
    acoustics:  "acoustic treatment",
    automation: "automation",
    rental:     "equipment rental"
  },

  // The "Venue type" dropdown on the New entry screen, in this order.
  VENUE_TYPES: ["Hotel", "Shack", "Restaurant", "Bar", "Pub", "Club", "Home (Stereo)", "Home (Surround)", "Other"],

  // "Type of music" chips on the New entry screen. More than one can be
  // picked. Saved in the Sheet as e.g. "Background, DJ".
  MUSIC_TYPES: ["Background", "Live Band", "Duo", "Trio", "DJ"],

  // Photo labels — every room gets one slot per label, in this order
  // ("+ Add another room" adds another full set). Always shown and saved
  // in capitals, however they are typed here.
  ROOM_LABELS: ["FRONT WALL", "LEFT WALL", "RIGHT WALL", "BACK WALL", "CEILING", "OVERVIEW"],

  // Message templates. Placeholders {name} {venue} {brochure} {website}
  // {rep} {company} {services} are swapped for real values right before the WhatsApp
  // message is built. Use \n for a line break — it will show as a real line
  // break on WhatsApp. A line whose {brochure} or {website} link is empty is
  // left out of the message.
  TEMPLATES: {
    // First message, sent the moment a New entry is saved. One per type of
    // contact (the chips at the top of New entry).
    first_site_visit:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Thank you for your time at {venue} today. As discussed, we can help with {services}. We will put together a quote and send it over shortly.\n\n" +
      "Our brochure: {brochure}\n" +
      "Website: {website}",

    first_walkin:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Thank you for coming in to see us. As discussed, we can help with {services} for {venue}. We will put together a quote, and can arrange a free site survey at a time that suits you.\n\n" +
      "Our brochure: {brochure}\n" +
      "Website: {website}",

    // Reminders, in order (see REMINDER_SCHEDULE_DAYS above).
    nudge_2day:
      "Hi {name}, this is {rep} from {company}, following up on our chat about {venue}.\n\n" +
      "Just checking you received everything you needed — happy to answer any questions.\n\n" +
      "Website: {website}",
    nudge_1week:
      "Hi {name}, this is {rep} from {company}, checking in again about {venue}.\n\n" +
      "Wanted to see if you have had a chance to think this over, and if there is anything I can help with.\n\n" +
      "Website: {website}",
    nudge_2week:
      "Hi {name}, this is {rep} from {company}, following up once more on {venue}.\n\n" +
      "No pressure at all — just let me know if the timing works better later.\n\n" +
      "Website: {website}",
    nudge_monthly:
      "Hi {name}, this is {rep} from {company}, touching base again about {venue}.\n\n" +
      "We are still very happy to help whenever the time is right — just let me know.\n\n" +
      "Website: {website}",
    // Quote chases, in order (see QUOTE_SCHEDULE_DAYS above). Used once
    // "Quoted" has been tapped for a lead, instead of the reminders above.
    quote_2day:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Just checking the quote for {venue} reached you. Happy to go through it or answer any questions.\n\n" +
      "Website: {website}",
    quote_1week:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Checking in on the quote we sent over for {venue}. Happy to adjust anything to fit your budget.\n\n" +
      "Website: {website}",
    quote_2week:
      "Hi {name}, this is {rep} from {company}, following up on the quote for {venue}.\n\n" +
      "If the timing is not right yet, just let me know and I will check back later.\n\n" +
      "Website: {website}",
    quote_monthly:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Our quote for {venue} still stands, and we are happy to revisit it whenever suits you.\n\n" +
      "Website: {website}",
    // Available for manual use — not sent automatically by the schedule.
    survey_offer:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "If it helps, we can arrange a free, no-obligation site survey at {venue} so you can see exactly what we would suggest before deciding anything.\n\n" +
      "Website: {website}"
  }
};
