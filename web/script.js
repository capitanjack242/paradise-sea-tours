/* ── Edit these with your real details ──────────────────────────── */
const CONFIG = {
  phone: "+50764819290",          // tel: dialable, no spaces
  phoneDisplay: "+507 6481-9290",
  email: "hello@paradiseseaexpress.com",
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
      encodeURIComponent("Joining the Paradise Sea Express network"))
);

// ── Booking ──────────────────────────────────────────────────────────────
// Same steps as the app: choose the trip and see the fare first, then say who
// you are. Identity is asked once the boat is chosen, not before.
const form = document.getElementById("bookingForm");
const status = document.getElementById("formStatus");
const tripStep = document.getElementById("tripStep");
const identityStep = document.getElementById("identityStep");
const dateInput = form.querySelector('[name="date"]');
const phoneInput = form.querySelector('[name="phone"]');
const returnWrap = document.getElementById("returnWrap");
const tripTypeInput = form.querySelector('[name="triptype"]');

// Today, in the browser's own timezone — no past dates offered.
const today = () => new Date().toLocaleDateString("en-CA");
dateInput.min = today();
dateInput.value = today();

// ── Trip type ────────────────────────────────────────────────────────────
document.getElementById("tripSeg").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-item");
  if (!btn) return;
  document.querySelectorAll(".seg-item").forEach((b) => b.classList.toggle("is-on", b === btn));
  tripTypeInput.value = btn.dataset.trip;
  returnWrap.hidden = btn.dataset.trip !== "Round trip";
  renderFare();
});

// ── Live fare, from the same published routes the app reads ──────────────
let routes = [];
(async () => {
  const { data, error } = await db
    .from("services")
    .select("*")
    .eq("category", "route")
    .order("sort");
  if (error) return console.error("could not load routes:", error);
  routes = data ?? [];
  renderFare();
})();

function matchRoute(pickup, destination) {
  const norm = (x) => (x ?? "").toLowerCase();
  const a = pickup.toLowerCase();
  const b = destination.toLowerCase();
  return routes.find((r) => {
    const from = norm(r.from_point);
    const to = norm(r.to_point);
    const hit = (x, y) =>
      (x.includes(from) || from.includes(x)) && (y.includes(to) || to.includes(y));
    return hit(a, b) || hit(b, a);
  });
}

const money = (cents) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

function currentFare() {
  const d = Object.fromEntries(new FormData(form).entries());
  if (!d.pickup || !d.destination) return { cents: null, route: undefined };
  const route = matchRoute(d.pickup, d.destination);
  if (!route?.price_cents) return { cents: null, route };
  const legs = d.triptype === "Round trip" ? 2 : 1;
  return { cents: route.price_cents * (Number(d.guests) || 1) * legs, route };
}

function renderFare() {
  const d = Object.fromEntries(new FormData(form).entries());
  const { cents, route } = currentFare();
  const total = document.getElementById("fareTotal");
  const math = document.getElementById("fareMath");
  const note = document.getElementById("fareNote");

  total.textContent = money(cents);
  if (cents != null && route) {
    const legs = d.triptype === "Round trip" ? " × 2 legs" : "";
    math.textContent = `${d.guests} × ${money(route.price_cents)}${legs}`;
    note.textContent = "Fixed price. Nothing charged until a captain says yes.";
  } else {
    math.textContent = "";
    note.textContent = !d.pickup || !d.destination
      ? "Pick your route and we'll show the price."
      : "We'll quote this trip and confirm before you pay anything.";
  }
}

form.addEventListener("input", renderFare);
form.addEventListener("change", renderFare);

// ── Step 1 → 2: validate the trip, then ask who's taking it ──────────────
function validateTrip() {
  const d = Object.fromEntries(new FormData(form).entries());
  for (const k of ["pickup", "destination", "date", "time"]) {
    if (!d[k]) return "Please choose your route, day and time.";
  }
  if (d.pickup === d.destination) return "Your pickup and destination are the same.";

  const scheduledAt = new Date(`${d.date}T${d.time}`);
  if (scheduledAt.getTime() <= Date.now()) return "Please choose a date and time in the future.";

  if (d.triptype === "Round trip") {
    if (!d.returntime) return "Tell us what time you'd like collecting again.";
    const back = new Date(`${d.date}T${d.returntime}`);
    if (back <= scheduledAt) return "The return has to be after you head out.";
  }
  return null;
}

document.getElementById("requestBtn").addEventListener("click", () => {
  status.className = "form-status";
  const problem = validateTrip();
  if (problem) {
    status.textContent = problem;
    status.classList.add("err");
    return;
  }
  status.textContent = "";

  const d = Object.fromEntries(new FormData(form).entries());
  const { cents } = currentFare();
  const when = new Date(`${d.date}T${d.time}`).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  document.getElementById("holdingText").innerHTML =
    `Holding: <b>${d.pickup} → ${d.destination}</b><br>${when} · ${d.guests} ` +
    `${Number(d.guests) === 1 ? "person" : "people"} · ${d.triptype}` +
    (cents != null ? ` · ${money(cents)}` : "");

  tripStep.hidden = true;
  identityStep.hidden = false;
  identityStep.scrollIntoView({ block: "nearest", behavior: "smooth" });
  form.querySelector('[name="name"]').focus();
});

document.getElementById("backBtn").addEventListener("click", () => {
  identityStep.hidden = true;
  tripStep.hidden = false;
  hidePhoneConfirm();
  status.textContent = "";
  status.className = "form-status";
});

// ── Number confirmation ──────────────────────────────────────────────────
// This number is how the customer is reached about the trip, so a typo means a
// captain gets committed to a trip they never hear about.
const phoneConfirm = document.getElementById("phoneConfirm");
const pcNumber = document.getElementById("pcNumber");
const submitBtn = document.getElementById("submitBtn");
let phoneConfirmed = false;

/**
 * Work out what number someone meant and hand back a parsed one.
 * People leave off the "+", write 00 for it, or type a local number with no
 * country code at all — all of those are answerable, so answer them instead of
 * making the customer guess the format.
 *
 * Local numbers are tried first (Bahamas, then US — the two biggest sources of
 * passengers), because "2425550100" is a Bahamian number, not country code 242.
 */
function parsePhone(raw) {
  const text = (raw || "").trim();
  if (!text) return null;
  const lp = window.libphonenumber;
  const digits = text.replace(/[^\d+]/g, "");

  const attempts = [];
  if (digits.startsWith("+")) attempts.push([digits, undefined]);
  else if (digits.startsWith("00")) attempts.push(["+" + digits.slice(2), undefined]);
  else {
    attempts.push([digits, "BS"], [digits, "US"], ["+" + digits, undefined]);
  }

  for (const [value, country] of attempts) {
    try {
      const p = lp.parsePhoneNumberFromString(value, country);
      if (p?.isValid()) return p;
    } catch {
      /* try the next interpretation */
    }
  }
  return null;
}

function prettyPhone(raw) {
  return parsePhone(raw)?.formatInternational() ?? raw;
}

// Tidy the number as soon as they move on, so they see it accepted rather than
// being told off for the formatting.
phoneInput.addEventListener("blur", () => {
  const p = parsePhone(phoneInput.value);
  if (p) phoneInput.value = p.formatInternational();
});

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

phoneInput.addEventListener("input", () => {
  phoneConfirmed = false;
  if (!phoneConfirm.hidden) hidePhoneConfirm();
});

// ── Submit ───────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  status.className = "form-status";
  const d = Object.fromEntries(new FormData(form).entries());

  if (!d.name?.trim() || !d.phone?.trim()) {
    status.textContent = "We need a name and a number so your captain can reach you.";
    status.classList.add("err");
    return;
  }
  const parsedPhone = parsePhone(d.phone);
  if (!parsedPhone) {
    status.textContent = "We couldn't read that as a phone number — try it with your country code, like +1 242 555 0100.";
    status.classList.add("err");
    return;
  }
  // Show them the tidied version, and store the unambiguous form.
  phoneInput.value = parsedPhone.formatInternational();
  if (!phoneConfirmed) {
    status.textContent = "";
    askPhoneConfirm(d.phone);
    return;
  }

  const problem = validateTrip();
  if (problem) {
    status.textContent = problem;
    status.classList.add("err");
    return;
  }

  status.textContent = "Sending your request…";

  // The return time is its own field, not a line of prose in the notes — it
  // decides whether a captain goes back for someone.
  const returnAt =
    d.triptype === "Round trip" && d.returntime
      ? new Date(`${d.date}T${d.returntime}`).toISOString()
      : null;

  const { error } = await db.from("bookings").insert({
    contact_name: d.name.trim(),
    contact_phone: parsedPhone.number, // E.164
    pickup: d.pickup,
    destination: d.destination,
    scheduled_at: new Date(`${d.date}T${d.time}`).toISOString(),
    return_at: returnAt,
    passengers: Number(d.guests) || 1,
    trip_type: d.triptype,
    notes: d.notes?.trim() || null,
  });

  if (error) {
    console.error("booking insert failed:", error);
    status.textContent =
      `Something went wrong sending your request. Please call us at ${CONFIG.phoneDisplay} instead.`;
    status.classList.add("err");
    return;
  }

  status.textContent =
    "Thanks! We're confirming a captain now — you'll hear from us shortly, and you don't pay anything until a captain says yes.";
  status.classList.add("ok");
  form.reset();
  phoneConfirmed = false;
  identityStep.hidden = true;
  tripStep.hidden = false;
  dateInput.min = today();
  dateInput.value = today();
  tripTypeInput.value = "One way";
  document.querySelectorAll(".seg-item").forEach((b, i) => b.classList.toggle("is-on", i === 0));
  returnWrap.hidden = true;
  renderFare();
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
