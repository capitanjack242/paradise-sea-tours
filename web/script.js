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

/* Every time on this form is Nassau time.

   A visitor's phone is often still on home time — a cruise passenger who landed
   this morning, a European who never switched roaming on. Read "10:30" in the
   phone's own zone and a Berlin phone books 4:30am Nassau, and a captain waits
   at dawn for nobody. So the date picker's "today" is Nassau's today, and the
   day+time they choose is turned into an instant using Nassau's clock, not the
   phone's. */
const NASSAU_TZ = "America/Nassau";

/** Minutes Nassau's clock is ahead of UTC at a given instant (-240 or -300). */
function nassauOffsetMinutes(at) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NASSAU_TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const n = (t) => Number(parts.find((x) => x.type === t).value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((wall - at.getTime()) / 60000);
}

/** The instant at which Nassau's clocks read the given date ("YYYY-MM-DD") and time ("HH:MM"). */
function nassauInstant(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes: the offset can differ either side of a clock change.
  const first = wall - nassauOffsetMinutes(new Date(wall)) * 60000;
  return new Date(wall - nassauOffsetMinutes(new Date(first)) * 60000);
}

// Today, in Nassau — no past dates offered.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: NASSAU_TZ }).format(new Date());
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

// ── Docks, from the one list the app reads too ───────────────────────────
/* The options typed into the page are the fallback. When the list loads, both
   pickers are rebuilt from it, keeping whatever was already chosen, with
   "Other (see notes)" last — it isn't a dock, so it isn't in the table. */
const OTHER_DOCK = "Other (see notes)";
(async () => {
  const { data, error } = await db.from("docks").select("name, can_pickup").order("sort");
  if (error || !data?.length) return error && console.error("could not load docks:", error);
  for (const sel of form.querySelectorAll('select[name="pickup"], select[name="destination"]')) {
    const chosen = sel.value;
    // Drop-off-only stops (can_pickup false) are somewhere to go, not to start.
    const docks = sel.name === "pickup" ? data.filter((d) => d.can_pickup !== false) : data;
    const names = [...docks.map((d) => d.name), OTHER_DOCK];
    sel.replaceChildren(...names.map((n) => new Option(n, n, false, n === chosen)));
    // A default that has left the list falls back to the first dock.
    if (!names.includes(chosen)) sel.selectedIndex = 0;
  }
  renderFare();
})();

// ── Live fare, from the same published routes the app reads ──────────────
let routes = [];

/* Bahamas VAT, read from the database rather than typed into the page, so the
   website, both apps and dispatch cannot end up quoting three different taxes.
   Falls back to 10 only if the read fails — never to zero, because a page that
   quietly drops the tax quotes a price nobody can honour. */
let vatPct = 10;
(async () => {
  const { data, error } = await db.from("app_settings").select("vat_pct").limit(1);
  if (error) return console.error("could not load the VAT rate:", error);
  if (data?.[0]?.vat_pct != null) vatPct = Number(data[0].vat_pct);
  showVatRate();
  renderFare();
})();

/** Every place the rate is written on the page, filled from the one source. */
function showVatRate() {
  const shown = Number.isInteger(vatPct) ? String(vatPct) : String(vatPct).replace(/0+$/, "");
  document.querySelectorAll("[data-vat-rate]").forEach((el) => (el.textContent = shown));
}

(async () => {
  const { data, error } = await db.from("services").select("*").order("sort");
  if (error) return console.error("could not load the price list:", error);
  routes = (data ?? []).filter((s) => s.category === "route");
  showPriceList(data ?? []);
  renderFare();
})();

/* Every price printed on the page, from the same price list the booking form
   quotes from. The numbers typed into the HTML are only what shows if this
   read fails — change a fare in the database and the cards, the "from $…" line
   and the small print all follow, with no edit to the page. A service priced
   "by quote" (no price) leaves its typed text alone. */
function showPriceList(services) {
  const bySlug = new Map(services.map((s) => [s.slug, s]));
  const whole = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

  // The fares table: every published route, one row each, in the list's order.
  // Only trips to or from the Cruise Port — the table says so in its caption.
  // Stop-to-stop fares are still quoted live in the booking form.
  const PORT = "Nassau Cruise Port";
  const fares = services.filter((s) =>
    s.category === "route" && s.is_active !== false && s.price_cents != null &&
    (s.from_point === PORT || s.to_point === PORT));
  if (fares.length) {
    const other = (s) => (s.from_point === PORT ? s.to_point : s.from_point) || s.title;
    document.getElementById("faresBody").innerHTML = fares
      .map((s) => `<tr><td>${escHtml(other(s))}</td><td>$${whole(s.price_cents)}</td>` +
                  `<td>$${whole(s.round_trip_cents ?? s.price_cents * 2)}</td></tr>`)
      .join("");
  }

  document.querySelectorAll("[data-price]").forEach((el) => {
    const s = bySlug.get(el.dataset.price);
    if (s?.price_cents != null) el.textContent = whole(s.price_cents);
  });
  document.querySelectorAll("[data-minutes]").forEach((el) => {
    const s = bySlug.get(el.dataset.minutes);
    if (s?.est_minutes != null) el.textContent = String(s.est_minutes);
  });

  // "from $15", and the range in the small print, across a whole category.
  const priced = (cat) =>
    services.filter((s) => s.category === cat && s.is_active !== false && s.price_cents != null)
      .map((s) => s.price_cents);
  const fill = (attr, pick) =>
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const prices = priced(el.getAttribute(attr));
      if (prices.length) el.textContent = whole(pick(prices));
    });
  fill("data-price-from", (p) => Math.min(...p));
  fill("data-price-min", (p) => Math.min(...p));
  fill("data-price-max", (p) => Math.max(...p));
}

/* The published route between two stops, either way round. Exact names, the
   same rule the database's quote_fare uses — every stop comes from the one
   dock list, so there's nothing to guess. */
function matchRoute(pickup, destination) {
  const norm = (x) => (x ?? "").trim().toLowerCase();
  const a = norm(pickup);
  const b = norm(destination);
  return routes.find((r) => {
    const from = norm(r.from_point);
    const to = norm(r.to_point);
    return (from === a && to === b) || (from === b && to === a);
  });
}

/** Per person for this trip type: a round trip has its own price, else two legs. */
const perPersonCents = (route, tripType) =>
  tripType === "Round trip" ? route.round_trip_cents ?? route.price_cents * 2 : route.price_cents;

const money = (cents) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/* The fare, the tax on it, and what that adds up to. Worked out in cents and
   rounded once, the same way the database works it out, so the number quoted
   here is the number that turns up on the trip. */
function currentFare() {
  const d = Object.fromEntries(new FormData(form).entries());
  const none = { fare: null, vat: null, total: null, route: undefined };
  if (!d.pickup || !d.destination) return none;
  // A charter is the whole boat by the hour; the per-seat price list doesn't
  // cover it, and the office quotes it before anything is paid.
  if (d.triptype === "Private charter (whole boat)") return none;
  const route = matchRoute(d.pickup, d.destination);
  if (!route?.price_cents) return { ...none, route };
  const fare = perPersonCents(route, d.triptype) * (Number(d.guests) || 1);
  const vat = Math.round((fare * vatPct) / 100);
  return { fare, vat, total: fare + vat, route };
}

function renderFare() {
  const d = Object.fromEntries(new FormData(form).entries());
  const { fare, vat, total: totalCents, route } = currentFare();
  const total = document.getElementById("fareTotal");
  const math = document.getElementById("fareMath");
  const note = document.getElementById("fareNote");
  const split = document.getElementById("fareSplit");

  // The big number is what leaves their pocket, tax and all.
  total.textContent = money(totalCents);
  split.hidden = totalCents == null;
  if (totalCents != null) {
    document.getElementById("fareSub").textContent = money(fare);
    document.getElementById("fareVat").textContent = money(vat);
  }

  if (totalCents != null && route) {
    const each = money(perPersonCents(route, d.triptype));
    math.textContent = `${d.guests} × ${each}${d.triptype === "Round trip" ? " round trip" : ""}`;
    note.textContent = "Fixed price, VAT included. Nothing charged until a captain says yes.";
  } else {
    math.textContent = "";
    note.textContent = !d.pickup || !d.destination
      ? "Pick your route and we'll show the price."
      : d.triptype === "Private charter (whole boat)"
      ? "Charters are priced for the whole boat — we'll quote it and confirm before you pay anything."
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

  const scheduledAt = nassauInstant(d.date, d.time);
  if (scheduledAt.getTime() <= Date.now()) return "Please choose a date and time in the future.";

  if (d.triptype === "Round trip") {
    if (!d.returntime) return "Tell us what time you'd like collecting again.";
    const back = nassauInstant(d.date, d.returntime);
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
  const { total: totalCents } = currentFare();
  const when = nassauInstant(d.date, d.time).toLocaleString(undefined, {
    timeZone: NASSAU_TZ,
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  document.getElementById("holdingText").innerHTML =
    `Holding: <b>${escHtml(d.pickup)} → ${escHtml(d.destination)}</b><br>${when} · ${escHtml(d.guests)} ` +
    `${Number(d.guests) === 1 ? "person" : "people"} · ${escHtml(d.triptype)}` +
    (totalCents != null ? ` · ${money(totalCents)} incl. VAT` : "");

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
      ? nassauInstant(d.date, d.returntime).toISOString()
      : null;

  // The same door the app uses. It creates the booking and hands back the key
  // to it, so the customer lands on their own trip page — messages, paying,
  // their captain — instead of a thank-you with no way back to the trip.
  const { data: tripToken, error } = await db.rpc("request_boat", {
    p_contact_name: d.name.trim(),
    p_contact_phone: parsedPhone.number, // E.164
    p_pickup: d.pickup,
    p_destination: d.destination,
    p_scheduled_at: nassauInstant(d.date, d.time).toISOString(),
    p_return_at: returnAt,
    p_passengers: Number(d.guests) || 1,
    p_trip_type: d.triptype,
    p_notes: d.notes?.trim() || null,
  });

  if (error || !tripToken) {
    console.error("booking failed:", error);
    // The database explains its own refusals in words written for a customer
    // ("choose a time in the future", "you've just asked for a few boats").
    // Anything else is a connection problem, and the phone still works.
    const said = error?.message || "";
    const forCustomer = /^(We|Your|Please|Tell us|How many|Choose|That|You)/.test(said);
    status.textContent = forCustomer
      ? said
      : `Something went wrong sending your request. Please call us at ${CONFIG.phoneDisplay} instead.`;
    status.classList.add("err");
    return;
  }

  status.textContent = "Request sent — opening your trip page…";
  status.classList.add("ok");
  location.href = `trip/?t=${encodeURIComponent(tripToken)}&new=1`;
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
