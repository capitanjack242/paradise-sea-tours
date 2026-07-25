/* ── Edit these with your real details ──────────────────────────── */
const CONFIG = {
  phone: "+50764819290",          // tel: dialable, no spaces
  phoneDisplay: "+507 6481-9290",
  whatsapp: "50764819290",        // digits only, country code first
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

// wire up phone / whatsapp / call links
document.querySelectorAll("[data-phone]").forEach((el) => {
  el.href = "tel:" + CONFIG.phone;
  if (el.textContent.includes("000")) el.textContent = "📞 " + CONFIG.phoneDisplay;
});
const waLink = (text) =>
  `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
document.querySelectorAll("[data-whatsapp]").forEach((el) =>
  (el.href = waLink("Hi! I'd like to book a boat tour.")));
document.querySelectorAll("[data-call]").forEach((el) =>
  (el.href = waLink("Hi! I'd like to book a boat tour.")));
document.querySelectorAll("[data-captain]").forEach((el) =>
  (el.href = waLink("Hi! I own a boat in Nassau and want to join the Paradise Sea Tours network.")));

// booking form: writes a real booking record; staff get an automatic
// Telegram alert the instant it lands (see supabase/functions/notify-booking).
const form = document.getElementById("bookingForm");
const status = document.getElementById("formStatus");
const dateInput = form.querySelector('[name="date"]');

// Don't let the date picker itself offer past dates.
dateInput.min = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

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
      `Something went wrong sending your request. Please call or WhatsApp us at ${CONFIG.phoneDisplay} instead.`;
    status.classList.add("err");
    return;
  }

  status.textContent = "Thanks! We've received your request and will confirm shortly.";
  status.classList.add("ok");
  form.reset();
});

// fleet: pull real active boats/captains instead of showing generic placeholders
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadFleet() {
  const wrap = document.getElementById("fleetCards");
  const { data, error } = await db
    .from("boats")
    .select("name, kind, capacity, captain_name, description, photo_url")
    .eq("is_active", true)
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
