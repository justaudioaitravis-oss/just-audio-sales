// ============================================================================
// CONFIG.JS — every value you might want to change lives in this one file.
// Nothing else in the app needs editing for normal use.
// ============================================================================

const CONFIG = {
  // Paste the URL you get after deploying the Apps Script as a Web App.
  // It will look like: https://script.google.com/macros/s/AKfycb.../exec
  APPS_SCRIPT_URL: "PASTE_APPS_SCRIPT_URL_HERE",

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

  // How many days to add to "next action date" for each nudge option.
  // These numbers are what the four chips on the New Entry screen mean.
  NUDGE_DAYS: { "tomorrow": 1, "3 days": 3, "1 week": 7, "1 month": 30 },

  // Message templates. Placeholders {name} {venue} {brochure} {rep} {company}
  // are swapped for real values right before the WhatsApp message is built.
  // Use \n for a line break — it will show as a real line break on WhatsApp.
  TEMPLATES: {
    // Sent the first time we contact a venue about a Sales enquiry.
    first_sales:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Good speaking with you at {venue}. We would love to put together a sound system quote for your space, and can arrange a free site survey at a time that suits you.\n\n" +
      "Here is a bit about what we do: {brochure}\n\n" +
      "Let me know a good time to visit.",

    // Sent the first time we contact a venue about a Service enquiry.
    first_service:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Good speaking with you at {venue}. Happy to take a look at your current setup and sort out any issues you are facing.\n\n" +
      "A little more on our service work: {brochure}\n\n" +
      "Let me know a time that works and we will come by.",

    // Sent the first time we contact a venue about an Acoustics enquiry.
    first_acoustics:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Good speaking with you at {venue}. We can take a look at the room and suggest some simple ways to improve the sound and cut down on complaints.\n\n" +
      "Here is some background on our acoustics work: {brochure}\n\n" +
      "Let me know a good time to visit.",

    // Sent for routine, low-pressure follow-ups.
    nudge:
      "Hi {name}, this is {rep} from {company}, just following up on {venue}.\n\n" +
      "Wanted to check if you had a chance to think this over, and if there is anything I can help with.",

    // Sent when a quote has gone out and is overdue for a reply.
    quote_chase:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "Checking in on the quote we sent over for {venue}. Happy to answer any questions or adjust anything to fit your budget.",

    // Offered as a soft next step, e.g. after a nudge has gone unanswered.
    survey_offer:
      "Hi {name}, this is {rep} from {company}.\n\n" +
      "If it helps, we can arrange a free, no-obligation site survey at {venue} so you can see exactly what we would suggest before deciding anything."
  }
};
