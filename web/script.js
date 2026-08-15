/* ── Edit these with your real details ──────────────────────────── */
const CONFIG = {
  phone: "+50764819290",          // tel: dialable, no spaces
  phoneDisplay: "+507 6481-9290",
  email: "hello@paradiseseatours.com",
  // Publishable (anon) key — safe to expose client-side, access is scoped by RLS.
  supabaseUrl: "https://fjdoaonnoezbbitbawzs.supabase.co",
  supabaseKey: "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP",
};
/* ───────────────────────────────────────────────────────────────── */

const db = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// year
document.getElementById("year").textContent = new Date().getFullYear();

// mobile nav
const navLinks = document.getElementById("navLinks");
document.getElementById("navToggle").addEventListener("click", () =>
  navLinks.classList.toggle("open"));
navLinks.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => navLinks.classList.remove("open")));

// wire up phone / call links
document.querySelectorAll("[data-phone]").forEach((el) => {
  el.href = "tel:" + CONFIG.phone;
  if (el.textContent.includes("000")) el.textContent = "📞 " + CONFIG.phoneDisplay;
});
document.querySelectorAll("[data-call]").forEach((el) => (el.href = "tel:" + CONFIG.phone));
// Captains reaching out about joining the network — email keeps it out of the
// booking line and gives them somewhere to send boat details.
document.querySelectorAll("[data-captain]").forEach(
  (el) =>
    (el.href =
      `mailto:${CONFIG.email}?subject=` +
      encodeURIComponent("Joining the Paradise Sea Tours network"))
);

// booking form: writes a real booking record; staff get an automatic
// Telegram alert the instant it lands (see supabase/functions/notify-booking).
const form = document.getElementById("bookingForm");
const status = document.getElementById("formStatus");
const dateInput = form.querySelector('[name="date"]');
const phoneInput = form.querySelector('[name="phone"]');

// Don't let the date picker itself offer past dates.
dateInput.min = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

// ── Mobile number confirmation ───────────────────────────────────────────
// The confirmation and the payment link both go to this number, so a typo
// means a captain gets committed to a trip the customer never hears about.
// Make them eyeball the parsed number before anything is submitted.
const phoneConfirm = document.getElementById("phoneConfirm");
const pcNumber = document.getElementById("pcNumber");
const submitBtn = document.getElementById("submitBtn");
let phoneConfirmed = false;

function prettyPhone(raw) {
  try {
    const p = window.libphonenumber.parsePhoneNumber(raw);
    return p ? p.formatInternational() : raw;
  } catch {
    return raw;
  }
}

function askPhoneConfirm(raw) {
  pcNumber.textContent = prettyPhone(raw);
  phoneConfirm.hidden = false;
  submitBtn.hidden = true;
  phoneConfirm.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function hidePhoneConfirm() {
  phoneConfirm.hidden = true;
  submitBtn.hidden = false;
}

document.getElementById("pcYes").addEventListener("click", () => {
  phoneConfirmed = true;
  hidePhoneConfirm();
  form.requestSubmit();
});

document.getElementById("pcEdit").addEventListener("click", () => {
  phoneConfirmed = false;
  hidePhoneConfirm();
  phoneInput.focus();
  phoneInput.select();
});

// Editing the number invalidates any previous confirmation.
phoneInput.addEventListener("input", () => {
  phoneConfirmed = false;
  if (!phoneConfirm.hidden) hidePhoneConfirm();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  status.className = "form-status";
  const data = Object.fromEntries(new FormData(form).entries());

  // basic validation
  for (const k of ["name", "phone", "pickup", "destination", "date", "time"]) {
    if (!data[k]) {
      status.textContent = "Please fill in all required fields.";
      status.classList.add("err");
      return;
    }
  }

  const scheduledAt = new Date(`${data.date}T${data.time}`);
  if (scheduledAt.getTime() <= Date.now()) {
    status.textContent = "Please choose a date and time in the future.";
    status.classList.add("err");
    return;
  }

  // Format-validate the phone number (catches typos and garbage). It can't
  // tell us the number is switched on or belongs to them — only that it's a
  // real, well-formed number.
  if (!window.libphonenumber.isValidPhoneNumber(data.phone)) {
    status.textContent = "Please enter a valid mobile number, including country code (e.g. +1 242 555 0100).";
    status.classList.add("err");
    return;
  }

  // This number is how we reach them about the trip — make them confirm it
  // before a request goes anywhere.
  if (!phoneConfirmed) {
    status.textContent = "";
    askPhoneConfirm(data.phone);
    return;
  }

  status.textContent = "Sending your request…";

  const { error } = await db.from("bookings").insert({
    contact_name: data.name,
    contact_phone: data.phone,
    pickup: data.pickup,
    destination: data.destination,
    scheduled_at: scheduledAt.toISOString(),
    passengers: Number(data.guests) || 1,
    trip_type: data.triptype,
    notes: data.notes || null,
  });

  if (error) {
    console.error("booking insert failed:", error);
    status.textContent =
      `Something went wrong sending your request. Please call us at ${CONFIG.phoneDisplay} instead.`;
    status.classList.add("err");
    return;
  }

  status.textContent = "Thanks! We've received your request and will confirm shortly.";
  status.classList.add("ok");
  form.reset();
  phoneConfirmed = false; // next booking must confirm its own number
  dateInput.min = new Date().toLocaleDateString("en-CA");
});

// fleet: pull real active boats/captains instead of showing generic placeholders
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadFleet() {
  const wrap = document.getElementById("fleetCards");
  // public_boats is a view that deliberately omits captain_whatsapp — the
  // boats table itself is staff-only so captains' numbers can't be scraped.
  const { data, error } = await db
    .from("public_boats")
    .select("name, kind, capacity, captain_name, description, photo_url")
    .order("name");

  if (error || !data || data.length === 0) {
    if (error) console.error("load fleet failed:", error);
    wrap.innerHTML = '<p class="muted">Fleet details coming soon.</p>';
    return;
  }

  const photoClasses = ["", "alt", "alt2"];
  wrap.innerHTML = data
    .map((b, i) => {
      // Real photo when we have one; otherwise fall back to a gradient placeholder.
      const photoClass = b.photo_url ? "" : photoClasses[i % photoClasses.length];
      const photoStyle = b.photo_url
        ? ` style="background-image:url('${escHtml(b.photo_url)}');background-size:cover;background-position:center"`
        : "";
      return `
        <article class="card boat">
          <div class="boat-photo ${photoClass}"${photoStyle} data-label="${escHtml(b.kind || b.name)}"></div>
          <h3>${escHtml(b.name)}</h3>
          ${b.captain_name ? `<p class="boat-captain">Capt. ${escHtml(b.captain_name)}</p>` : ""}
          <p>${escHtml(b.description || "")}</p>
          <span class="tag">Up to ${b.capacity} guests</span>
        </article>`;
    })
    .join("");
}
loadFleet();
