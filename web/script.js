/* ── Edit these with your real details ──────────────────────────── */
const CONFIG = {
  phone: "+12425357430",          // tel: dialable, no spaces
  phoneDisplay: "+1 (242) 535-7430",
  email: "hello@paradiseseaexpress.com",
  // Publishable (anon) key — safe to expose client-side, access is scoped by RLS.
  supabaseUrl: "https://fjdoaonnoezbbitbawzs.supabase.co",
  supabaseKey: "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP",
};
/* ───────────────────────────────────────────────────────────────── */

const db = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// Where this visitor came from, so the booking can say which marketing brought
// it. A tagged link (?utm_source=cruise-port&utm_medium=qr&utm_campaign=launch)
// says it outright; otherwise the site that sent them (google.com). Newest
// wins; a visit with neither (typed in, or one page to the next here) leaves
// the last one alone. Same code in routes.js — people land on the stop pages too.
(() => {
  try {
    const q = new URLSearchParams(location.search);
    const tag = (k) => (q.get(k) || "").trim().slice(0, 100) || null;
    const here = location.hostname.replace(/^www\./, "");
    const from = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
    const seen = tag("utm_source")
      ? { source: tag("utm_source"), medium: tag("utm_medium"), campaign: tag("utm_campaign") }
      : from && from !== here
      ? { source: from, medium: null, campaign: null }
      : null;
    if (seen) localStorage.setItem("pse-source", JSON.stringify({ ...seen, at: Date.now() }));
    // A ship code on the link (?code=CELEB14NOV) fills the promo box later.
    if (tag("code")) localStorage.setItem("pse-code", JSON.stringify({ code: tag("code"), at: Date.now() }));
  } catch {
    /* storage blocked (private window): the booking goes without it */
  }
})();

/** The source remembered above, if it's from the last 30 days. */
function visitSource() {
  try {
    const s = JSON.parse(localStorage.getItem("pse-source") || "null");
    if (s && Date.now() - s.at < 30 * 864e5) return s;
  } catch {
    /* nothing remembered */
  }
  return {};
}

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

/* The form opens on today at 10:30. Later in the day that time has gone, and
   the visitor would only find out when the form refuses it, so start at the
   next half hour instead (and tomorrow morning once the day's runs are over). */
(() => {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: NASSAU_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date()).split(":").map(Number);
  const mins = now[0] * 60 + now[1];
  const next = Math.ceil((mins + 20) / 30) * 30;          // at least 20 minutes away
  if (next <= 10 * 60 + 30) return;                        // 10:30 is still ahead
  const time = form.querySelector('[name="time"]');
  if (next <= 21 * 60 + 30) {
    time.value = `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
  } else {
    const t = new Date(nassauInstant(today(), "12:00").getTime() + 86400000);
    dateInput.value = new Intl.DateTimeFormat("en-CA", { timeZone: NASSAU_TZ }).format(t);
  }
})();

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

/* A stop page's "Book" button arrives as /?to=Pearl%20Island#book (or
   ?from=). Those choices win over the form's defaults, now for the built-in
   list and again once the dock list has loaded, so the form opens on that trip. */
const wanted = new URLSearchParams(location.search);
function applyWanted() {
  for (const [param, field] of [["from", "pickup"], ["to", "destination"]]) {
    const v = wanted.get(param);
    const sel = form.querySelector(`select[name="${field}"]`);
    if (v && [...sel.options].some((o) => o.value === v)) sel.value = v;
  }
  // Going somewhere from the port is the usual trip; don't leave both ends the same.
  if (wanted.get("to") && form.pickup.value === form.destination.value) {
    form.pickup.value = "Nassau Cruise Port";
  }
}
applyWanted();

/** Same rule as scripts/build-routes.mjs: the address of a stop's page. */
const stopSlug = (name) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['\u2019]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
  applyWanted();
  renderFare();
  syncQuickStops();
  renderQuick();
})();

// ── Live fare, from the same published routes the app reads ──────────────
let routes = [];
// The ship code typed into the form. `cents` null = not (yet) a working code.
const promo = { code: "", cents: null, checked: "" };

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
  renderQuick();
  const picked = document.querySelector("#harbourMap .pin.is-picked");
  if (picked) pickStop(picked.dataset.stop);
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
      .map((s) => `<tr><td><a href="/boat-to/${stopSlug(other(s))}/">${escHtml(other(s))}</a></td><td>$${whole(s.price_cents)}</td>` +
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
  const full = perPersonCents(route, d.triptype) * (Number(d.guests) || 1);
  // The same as the database: a fixed amount off the fare, never below zero,
  // then the tax on what's left.
  const off = promo.cents ? Math.min(promo.cents, full) : 0;
  const fare = full - off;
  const vat = Math.round((fare * vatPct) / 100);
  return { fare, off, vat, total: fare + vat, route };
}

function renderFare() {
  const d = Object.fromEntries(new FormData(form).entries());
  const { fare, off, vat, total: totalCents, route } = currentFare();
  const total = document.getElementById("fareTotal");
  const math = document.getElementById("fareMath");
  const note = document.getElementById("fareNote");
  const split = document.getElementById("fareSplit");

  // The big number is what leaves their pocket, tax and all.
  // Never a bare dash: say what the number will be, or why there isn't one yet.
  total.textContent = totalCents != null ? money(totalCents)
    : !routes.length ? "…"
    : d.triptype === "Private charter (whole boat)" ? "Quoted for you"
    : d.pickup && d.destination && d.pickup !== d.destination ? "Price on request"
    : "Pick a route";
  split.hidden = totalCents == null;
  if (totalCents != null) {
    // The fare before the code, then the code off it, then the tax on the rest.
    document.getElementById("fareSub").textContent = money(fare + off);
    document.getElementById("fareVat").textContent = money(vat);
    document.getElementById("fareOffWrap").hidden = !off;
    if (off) {
      document.getElementById("fareOffCode").textContent = promo.code;
      document.getElementById("fareOff").textContent = `−${money(off)}`;
    }
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

// ── Floating call button: out of the way of the hero and the form ──────────
(() => {
  const fab = document.querySelector(".fab");
  const watch = [document.querySelector(".hero"), document.getElementById("book")].filter(Boolean);
  if (!fab || !watch.length || !("IntersectionObserver" in window)) return;
  const seen = new Set();
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target);
    fab.classList.toggle("is-away", seen.size > 0);
  }, { threshold: 0 });
  watch.forEach((el) => obs.observe(el));
})();

// ── Harbour map ─────────────────────────────────────────────────────────────
/* Nassau Harbour from the real coastline (images/harbour-map.svg, drawn by
   scripts/make-harbour-map.py) with a pin per stop at its latitude and
   longitude. HARBOUR_VIEW must match the edges in that script. The names are
   the dock names, so fares and stop pages line up. Each stop also gives its
   short map label and where the label sits: [dx, dy, anchor] from the pin. */
const HARBOUR_VIEW = { w0: -77.425, e0: -77.185, s0: 25.009, n0: 25.13, w: 1000, h: 557, npShift: 0.006 };
/* New Providence is drawn a little south of where it is (npShift degrees, as
   in the script) so the harbour is wide enough to tell its pins apart. These
   stops are on New Providence and move with it. */
const ON_NEW_PROVIDENCE = new Set(["Breezes", "Baha Mar", "Goodman's Bay", "Arawak Cay / Fish Fry",
  "Junkanoo Beach", "Señor Frog's", "Nassau Cruise Port", "Green Parrot", "Poop Deck", "Fort Montagu"]);
const HARBOUR_STOPS = [
  ["Breezes", 25.0789, -77.4095, "Breezes", [0, 21, "middle"]],
  ["Baha Mar", 25.0751, -77.3986, "Baha Mar", [0, 21, "middle"]],
  ["Goodman's Bay", 25.0794, -77.3798, "Goodman's Bay", [3, 21, "end"]],
  ["Arawak Cay / Fish Fry", 25.0805, -77.3604, "Arawak Cay", [-5, -21, "middle"]],
  ["Junkanoo Beach", 25.0795, -77.3513, "Junkanoo Beach", [-3, 21, "end"]],
  ["Señor Frog's", 25.0794, -77.3455, "Señor Frog's", [-8, 39, "middle"]],
  ["Nassau Cruise Port", 25.0800, -77.3420, "Cruise Port", [0, 21, "middle"]],
  ["Green Parrot", 25.0781, -77.3310, "Green Parrot", [14, 39, "middle"]],
  ["Poop Deck", 25.0761, -77.3258, "Poop Deck", [12, 6, "start"]],
  ["Fort Montagu", 25.0704, -77.3044, "Fort Montagu", [9, 5, "start"]],
  ["Paradise Island – Margaritaville", 25.0801, -77.3248, "Margaritaville", [5, -24, "start"]],
  ["Paradise Island – Carnival", 25.0823, -77.3340, "Carnival", [-2, -24, "end"]],
  ["Pearl Island", 25.0826, -77.2712, "Pearl Island", [-4, -24, "end"]],
  ["Blue Lagoon", 25.0967, -77.2802, "Blue Lagoon", [0, -24, "middle"]],
  ["Floating Bar", 25.0768, -77.2775, "Floating Bar", [-6, 18, "end"]],
  ["Pigs Beach (Athol Island)", 25.0776, -77.2668, "Pigs Beach", [0, 21, "middle"]],
  ["Rose Island – Goodies", 25.0897, -77.2330, "Goodies", [0, 21, "middle"]],
];
const PORT_NAME = "Nassau Cruise Port";
const harbourXY = ([name, lat, lon]) => {
  const v = HARBOUR_VIEW;
  if (ON_NEW_PROVIDENCE.has(name)) lat -= v.npShift;
  return [(lon - v.w0) / (v.e0 - v.w0) * v.w, (v.n0 - lat) / (v.n0 - v.s0) * v.h];
};

function drawHarbour() {
  const box = document.getElementById("harbourMap");
  if (!box) return;
  const { w, h } = HARBOUR_VIEW;
  const kmPx = w / ((HARBOUR_VIEW.e0 - HARBOUR_VIEW.w0) * 111.32 * Math.cos((25.084 * Math.PI) / 180));
  const pin = (stop) => {
    const [name, , , label, [dx, dy, anchor]] = stop;
    const [x, y] = harbourXY(stop);
    const home = name === PORT_NAME;
    return `<g class="pin${home ? " pin-home" : ""}" data-stop="${escHtml(name)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"
      tabindex="0" role="button" aria-label="${escHtml(name)}">
      <circle class="pin-hit" cy="-9" r="16"/>
      <g class="pin-mark"><g transform="scale(1.25)"><path d="M0 0C-3.4-5.6-7.5-8.4-7.5-13.5A7.5 7.5 0 1 1 7.5-13.5C7.5-8.4 3.4-5.6 0 0Z"/>
      <circle cy="-13.5" r="2.9"/></g></g>
      <text class="pin-label" x="${dx}" y="${dy}" text-anchor="${anchor}">${escHtml(label)}</text></g>`;
  };
  box.innerHTML = `<div class="harbour-canvas">
    <img src="/images/harbour-map.svg" width="${w}" height="${h}" alt="">
    <svg viewBox="0 0 ${w} ${h}" role="group" aria-label="Our stops">
      <text class="map-name" x="540" y="430" text-anchor="middle">NEW PROVIDENCE</text>
      <text class="map-name small pi" x="505" y="226" text-anchor="middle">PARADISE ISLAND</text>
      <text class="map-name small" x="905" y="196" text-anchor="middle">ROSE ISLAND</text>
      <text class="map-water" x="300" y="70" text-anchor="middle">Atlantic Ocean</text>
      <path class="route" id="harbourRoute" d=""/>
      <g class="map-key" transform="translate(${w - 24} 26)">
        <path d="M0-12L5 4L0 1L-5 4Z"/><text y="18" text-anchor="middle">N</text></g>
      <g class="map-key" transform="translate(24 ${h - 40})">
        <path d="M0 0H${(2 * kmPx).toFixed(1)}" class="scale-bar"/><text x="${kmPx.toFixed(1)}" y="-6" text-anchor="middle">2 km</text></g>
      ${HARBOUR_STOPS.map(pin).join("")}
    </svg><p class="harbour-credit">Coastline: geoBoundaries (CC BY 4.0)</p></div>`;
  box.addEventListener("click", (e) => {
    // A pin opens its card; the open pin again, or anywhere else on the map, closes it.
    const g = e.target.closest(".pin");
    pickStop(g && !g.classList.contains("is-picked") ? g.dataset.stop : null);
  });
  box.addEventListener("keydown", (e) => {
    const g = e.target.closest(".pin");
    if (g && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      pickStop(g.classList.contains("is-picked") ? null : g.dataset.stop);
    }
  });
  // A phone shows part of the map and scrolls sideways: start on the port.
  const [px] = harbourXY(HARBOUR_STOPS.find((s) => s[0] === PORT_NAME));
  requestAnimationFrame(() => {
    const c = box.querySelector(".harbour-canvas");
    box.scrollLeft = (px / w) * c.offsetWidth - box.clientWidth / 2;
  });
}

/* A dotted line from the port to the picked stop, bowed out to sea. */
function drawHarbourRoute(name) {
  const line = document.getElementById("harbourRoute");
  if (!line) return;
  const find = (n) => HARBOUR_STOPS.find((s) => s[0] === n);
  const to = find(name);
  if (!to || name === PORT_NAME) { line.setAttribute("d", ""); return; }
  const [x0, y0] = harbourXY(find(PORT_NAME));
  const [x1, y1] = harbourXY(to);
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 24 - Math.abs(x1 - x0) * 0.12;
  line.setAttribute("d", `M${x0.toFixed(1)} ${(y0 - 6).toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x1.toFixed(1)} ${(y1 - 6).toFixed(1)}`);
}

/* Show a stop's fare card, or with no name (the picked pin tapped again, or
   the card's close button) close it. */
function pickStop(name) {
  document.querySelectorAll("#harbourMap .pin").forEach((g) => {
    g.classList.toggle("is-picked", g.dataset.stop === name);
    if (g.dataset.stop === name) g.parentNode.appendChild(g); // draw it on top
  });
  drawHarbourRoute(name);
  const card = document.getElementById("harbourCard");
  card.hidden = !name;
  if (!name) return;
  const close = `<button type="button" class="harbour-close" aria-label="Close">×</button>`;
  if (name === PORT_NAME) {
    card.innerHTML = `${close}<h3>Nassau Cruise Port</h3>
      <p>You start here, at Prince George Wharf. Tap any other pin to see its fare.</p>`;
    card.querySelector(".harbour-close").onclick = () => pickStop(null);
    return;
  }
  const route = matchRoute(PORT_NAME, name);
  const fares = route?.price_cents
    ? `<p class="harbour-fare"><strong>${money(route.price_cents)}</strong> one way ·
         <strong>${money(perPersonCents(route, "Round trip"))}</strong> round trip</p>
       <p class="harbour-sub">per person from the Cruise Port, before VAT</p>`
    : `<p class="harbour-sub">${routes.length ? "Price on request — we'll quote it when you book." : "Loading the fare…"}</p>`;
  card.innerHTML = `${close}<h3>${escHtml(name)}</h3>${fares}
    <div class="harbour-actions">
      <button type="button" class="btn btn-primary" id="harbourBook">Book this</button>
      <a class="harbour-more" href="/boat-to/${stopSlug(name)}/">About this stop →</a>
    </div>`;
  card.querySelector(".harbour-close").onclick = () => pickStop(null);
  document.getElementById("harbourBook").addEventListener("click", () => {
    qFrom.value = PORT_NAME; qTo.value = name;
    qFrom.dataset.touched = qTo.dataset.touched = "1";
    renderQuick();
    quick.requestSubmit();
  });
}
drawHarbour();

// ── Quick booking in the hero ─────────────────────────────────────────────
/* From, To and People at the top of the page, with the fare straight away.
   It books nothing itself: "Book this ride" copies the choices into the full
   form below and takes the visitor there to add the day, time and their name.
   The stops are copied from the form's lists, so both always offer the same. */
const quick = document.getElementById("quickBook");
const qFrom = document.getElementById("qFrom");
const qTo = document.getElementById("qTo");
const qGuests = document.getElementById("qGuests");
for (let n = 1; n <= 12; n++) qGuests.add(new Option(String(n), String(n), false, n === 2));

function syncQuickStops() {
  for (const [q, field] of [[qFrom, "pickup"], [qTo, "destination"]]) {
    const src = form.querySelector(`select[name="${field}"]`);
    const chosen = q.dataset.touched ? q.value : src.value;
    q.replaceChildren(...[...src.options].map((o) => new Option(o.text, o.value)));
    q.value = [...q.options].some((o) => o.value === chosen) ? chosen : src.value;
  }
}

function renderQuick() {
  const price = document.getElementById("qPrice");
  const note = document.getElementById("qNote");
  if (!routes.length) return; // keep the "from $10" until the price list is in
  if (qFrom.value === qTo.value) {
    price.textContent = "Pick two stops";
    note.textContent = "where you are and where you're going";
    return;
  }
  const route = matchRoute(qFrom.value, qTo.value);
  if (!route?.price_cents) {
    price.textContent = "Price on request";
    note.textContent = "we'll quote it when you book";
    return;
  }
  const n = Number(qGuests.value) || 1;
  price.textContent = `${money(route.price_cents)} per person`;
  note.textContent = n > 1
    ? `${money(route.price_cents * n)} for ${n}, one way, + VAT`
    : "one way, + VAT";
}

quick.addEventListener("change", (e) => {
  if (e.target.tagName === "SELECT") e.target.dataset.touched = "1";
  renderQuick();
});
quick.addEventListener("submit", (e) => {
  e.preventDefault();
  form.pickup.value = qFrom.value;
  form.destination.value = qTo.value;
  form.guests.value = qGuests.value;
  renderFare();
  document.getElementById("book").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => form.date.focus({ preventScroll: true }), 450);
});
syncQuickStops();
renderQuick();

/* Ship codes. Checked with the database as it's typed, so the price shows the
   discount before anyone commits; the database applies it again on the way in,
   so a code that stops working between now and then is caught there too. */
const promoInput = form.querySelector('[name="promo"]');
const promoNote = document.getElementById("promoNote");
let promoTimer = null;

function showPromo() {
  const typed = promo.code;
  promoNote.hidden = !typed || promo.checked !== typed;
  promoNote.classList.toggle("err", promo.cents == null);
  promoNote.textContent = promo.cents != null
    ? `${money(promo.cents)} off this booking.`
    : "That code isn't valid or has expired.";
  renderFare();
}

async function checkPromo() {
  const code = promo.code;
  if (!code) return showPromo();
  const { data, error } = await db.rpc("check_promo", { p_code: code });
  if (promo.code !== code) return; // they kept typing
  promo.cents = error ? null : data;
  promo.checked = code;
  showPromo();
}

promoInput.addEventListener("input", () => {
  promo.code = promoInput.value.trim().toUpperCase();
  promo.cents = null;
  promo.checked = "";
  showPromo();
  clearTimeout(promoTimer);
  promoTimer = setTimeout(checkPromo, 400);
});

// A code that came in on the link: filled in and checked straight away.
try {
  const saved = JSON.parse(localStorage.getItem("pse-code") || "null");
  if (saved && Date.now() - saved.at < 30 * 864e5 && !promoInput.value) {
    promoInput.value = saved.code.toUpperCase();
    promo.code = promoInput.value;
    checkPromo();
  }
} catch {
  /* nothing remembered */
}

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
  // A code they typed that doesn't work: say so before asking who they are,
  // rather than book at a price they didn't expect.
  if (promo.code && promo.cents == null) {
    status.textContent = "That promo code isn't valid or has expired. Clear it to book without it.";
    status.classList.add("err");
    return;
  }
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
  const src = visitSource();
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
    p_source: src.source || null,
    p_source_medium: src.medium || null,
    p_source_campaign: src.campaign || null,
    // Only when there is one, so a booking without a code never depends on it.
    ...(promo.code ? { p_promo_code: promo.code } : {}),
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
  // Count the booking in Analytics (when it's switched on) before leaving the
  // page — the trip page itself is never tracked. Never waits more than a second.
  let leaving = false;
  const openTrip = () => {
    if (leaving) return;
    leaving = true;
    location.href = `trip/?t=${encodeURIComponent(tripToken)}&new=1`;
  };
  if (typeof window.gtag === "function") {
    setTimeout(openTrip, 1000);
    window.gtag("event", "generate_lead", {
      destination: d.destination,
      pickup: d.pickup,
      trip_type: d.triptype,
      passengers: Number(d.guests) || 1,
      event_callback: openTrip,
    });
  } else {
    openTrip();
  }
});

// fleet: pull real active boats/captains instead of showing generic placeholders
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadFleet() {
  const wrap = document.getElementById("fleetCards");
  if (wrap.closest("section").hidden) return; // section switched off in the page
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
