/* Staff accounts are created in the Supabase dashboard (Authentication → Users),
   then promoted to admin with:
     update profiles set role = 'admin' where id = '<user-id>';
   run once in the SQL Editor. No public sign-up exists on this page. */
const SUPABASE_URL = "https://fjdoaonnoezbbitbawzs.supabase.co";
const SUPABASE_KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginView = document.getElementById("loginView");
const dashView = document.getElementById("dashView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const whoami = document.getElementById("whoami");
const bookingsBody = document.getElementById("bookingsBody");
const emptyState = document.getElementById("emptyState");
const countInfo = document.getElementById("countInfo");

const bookingFilters = document.getElementById("bookingFilters");
const bookingsWrap = document.getElementById("bookingsWrap");
const clientsWrap = document.getElementById("clientsWrap");
const clientsBody = document.getElementById("clientsBody");
const clientsEmpty = document.getElementById("clientsEmpty");
const clientSearch = document.getElementById("clientSearch");
const boatsWrap = document.getElementById("boatsWrap");
const boatsBody = document.getElementById("boatsBody");
const boatsEmpty = document.getElementById("boatsEmpty");

let currentFilter = "active";
let currentView = "bookings";
let clientQuery = "";
const expandedClients = new Set(); // clients whose trip table is open
let pollTimer = null;
let boatsList = []; // active boats available to assign, loaded once per session
let realtimeChannel = null;
let refreshTimer = null;
let pendingRefresh = false; // a change landed while the user was typing

// ── auth ─────────────────────────────────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) loginError.textContent = error.message;
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  teardownLiveUpdates();
  await db.auth.signOut();
});

db.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showDashboard(session);
  } else {
    teardownLiveUpdates();
    dashView.style.display = "none";
    loginView.style.display = "grid";
  }
});

async function showDashboard(session) {
  loginView.style.display = "none";
  dashView.style.display = "block";
  whoami.textContent = session.user.email;
  await loadBoats();
  await loadBookings();
  startLiveUpdates();
}

// ── live updates ─────────────────────────────────────────────────────────
// Realtime is the fast path: new bookings and edits (including ones made by
// the other dispatcher) appear within a second. A slow poll stays as a safety
// net in case the websocket drops.
function startLiveUpdates() {
  teardownLiveUpdates();

  realtimeChannel = db
    .channel("dispatch-bookings")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bookings" },
      () => scheduleRefresh()
    )
    .subscribe((status) => {
      setLiveStatus(status === "SUBSCRIBED" ? "live" : "polling");
    });

  pollTimer = setInterval(() => refreshUnlessTyping(), 60000);
}

function teardownLiveUpdates() {
  clearInterval(pollTimer);
  clearTimeout(refreshTimer);
  pollTimer = refreshTimer = null;
  pendingRefresh = false;
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  setLiveStatus("off");
}

// Coalesce bursts (a single edit can emit several events) into one reload.
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshUnlessTyping(), 400);
}

function refreshUnlessTyping() {
  // Never rebuild the list out from under a field being edited. Re-check on a
  // short timer rather than waiting on a blur/focusout event — if that event
  // never fires the deferred reload would be stuck and the board would go
  // stale without anyone noticing.
  //
  // Only fields holding unsaved text count. A button keeps focus after it's
  // clicked, so treating "anything focused" as typing meant every button press
  // deferred the reload forever and the board never showed the result.
  const active = document.activeElement;
  const typing =
    active && bookingsBody.contains(active) && active.matches("input, textarea, select");
  if (typing) {
    pendingRefresh = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshUnlessTyping(), 1500);
    return;
  }
  pendingRefresh = false;
  loadBookings();
}

function setLiveStatus(state) {
  const el = document.getElementById("liveStatus");
  if (!el) return;
  el.className = "live-status " + state;
  el.textContent =
    state === "live" ? "● Live" : state === "polling" ? "● Reconnecting…" : "";
  el.title =
    state === "live"
      ? "Connected — new bookings appear instantly"
      : state === "polling"
      ? "Live connection lost; refreshing every 60s instead"
      : "";
}

async function loadBoats() {
  const { data, error } = await db
    .from("boats")
    .select("id, name, kind, capacity, home_dock, captain_name, captain_whatsapp, owner_id, is_available, availability_changed_at")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error("load boats failed:", error);
    return;
  }
  boatsList = data;
}

// ── views and filters ────────────────────────────────────────────────────
document.getElementById("viewTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  currentView = btn.dataset.view;
  document.querySelectorAll(".vtab").forEach((t) => t.classList.toggle("active", t === btn));
  applyView();
});

function applyView() {
  const on = (v) => (currentView === v ? "" : "none");
  bookingsWrap.style.display = on("bookings");
  bookingFilters.style.display = on("bookings");
  clientsWrap.style.display = on("clients");
  boatsWrap.style.display = on("boats");
  if (currentView === "clients") renderClients(window.__allBookings || []);
  else if (currentView === "boats") renderBoats();
  else renderBookings(window.__allBookings || []);
}

document.getElementById("filterTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  renderBookings(window.__allBookings || []);
});

clientSearch.addEventListener("input", () => {
  clientQuery = clientSearch.value.trim().toLowerCase();
  renderClients(window.__allBookings || []);
});

document.getElementById("refreshBtn").addEventListener("click", loadBookings);

// ── data ─────────────────────────────────────────────────────────────────
async function loadBookings() {
  const { data, error } = await db
    .from("bookings")
    .select("*, boats(name, captain_name, captain_whatsapp, owner_id)")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("load bookings failed:", error);
    return;
  }
  window.__allBookings = data;
  if (currentView === "clients") renderClients(data);
  else if (currentView === "boats") renderBoats();
  else renderBookings(data);
}

/* ── boats ────────────────────────────────────────────────────────────────
   Who is available to be given work. Deliberately not "out" — a boat can be
   available and tied up at the dock, or unavailable and out fishing. This is
   about whether dispatch may offer them a run, nothing else. */
function renderBoats() {
  boatsEmpty.style.display = boatsList.length ? "none" : "block";
  countInfo.textContent = `${boatsList.filter((b) => b.is_available).length} of ${boatsList.length} available`;

  const runsToday = new Map();
  for (const bk of window.__allBookings || []) {
    if (!bk.assigned_boat_id) continue;
    if (["cancelled"].includes(bk.status)) continue;
    const at = bk.scheduled_at ? new Date(bk.scheduled_at) : null;
    if (!at || at.toDateString() !== new Date().toDateString()) continue;
    runsToday.set(bk.assigned_boat_id, (runsToday.get(bk.assigned_boat_id) || 0) + 1);
  }

  const sorted = [...boatsList].sort((a, b) => {
    if (!!a.is_available !== !!b.is_available) return a.is_available ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
  boatsBody.innerHTML = sorted.map((b) => boatHtml(b, runsToday.get(b.id) || 0)).join("");
}

function boatHtml(b, runs) {
  const noLogin = !b.owner_id;
  const on = !!b.is_available;

  // "Never said" is not the same as "said no" — a captain with no login has
  // never been asked, and showing that as Off would read as a decision.
  const state = noLogin
    ? `<span class="boat-state st-nologin">No login yet</span>`
    : on
    ? `<span class="boat-state st-on">● Available</span>`
    : `<span class="boat-state st-off">Unavailable</span>`;

  const changed = b.availability_changed_at
    ? new Date(b.availability_changed_at).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;

  // A switch left on since yesterday is a claim worth doubting.
  const stale =
    on && b.availability_changed_at &&
    new Date(b.availability_changed_at).toDateString() !== new Date().toDateString();

  return `
    <article class="boat-card${on ? " is-out" : ""}">
      <div class="boat-top">
        <div>
          <div class="boat-name">${esc(b.name || "—")}</div>
          <div class="boat-cap">Capt. ${esc(b.captain_name || "—")} · ${b.capacity ?? "?"} seats${b.home_dock ? ` · ${esc(b.home_dock)}` : ""}</div>
        </div>
        ${state}
      </div>
      <div class="boat-foot">
        ${noLogin
          ? `<span class="boat-warn">Can't be asked or close out a trip until they have a login</span>`
          : `<span>${changed ? `${on ? "Available" : "Unavailable"} since ${changed}` : "Never set"}</span>`}
        <span class="boat-runs">${runs} run${runs === 1 ? "" : "s"} today</span>
      </div>
      ${stale ? `<div class="boat-stale">⚠ Set available on ${changed} and never changed — worth checking he still is</div>` : ""}
    </article>`;
}

/* ── clients ──────────────────────────────────────────────────────────────
   There is no customer table — a booking carries a name and a number and
   nothing links one booking to the next. The phone number is the closest thing
   to an identity we have, and it's dependable now that every number is stored
   the same way, so the client list is built by grouping on it. When app sign-in
   is switched on this gets replaced by real customer records. */
function buildClients(bookings) {
  const byPhone = new Map();
  for (const b of bookings) {
    const phone = (b.contact_phone || "").trim();
    if (!phone) continue; // nothing to group on
    let c = byPhone.get(phone);
    if (!c) {
      c = { phone, name: "", bookings: 0, trips: 0, cancelled: 0, spentCents: 0, lastAt: null, rows: [] };
      byPhone.set(phone, c);
    }
    c.bookings += 1;
    c.rows.push(b);
    // Names get typed slightly differently each time; keep the most recent.
    const at = b.scheduled_at || b.created_at;
    if (b.contact_name && (!c.lastAt || (at && at > c.lastAt))) c.name = b.contact_name;
    if (at && (!c.lastAt || at > c.lastAt)) c.lastAt = at;
    if (b.status === "completed") {
      c.trips += 1;
      c.spentCents += b.quoted_price_cents || 0;
    }
    if (b.status === "cancelled") c.cancelled += 1;
  }
  for (const c of byPhone.values()) {
    c.rows.sort((x, y) =>
      (y.scheduled_at || y.created_at || "").localeCompare(x.scheduled_at || x.created_at || "")
    );
  }
  // Alphabetical by the name on screen, so a dispatcher scanning for someone
  // finds them where they expect. Anyone who booked without giving a name goes
  // to the bottom rather than filing under "N".
  return [...byPhone.values()].sort((a, b) => {
    const an = a.name.trim();
    const bn = b.name.trim();
    if (!an !== !bn) return an ? -1 : 1;
    return an.localeCompare(bn, undefined, { sensitivity: "base" });
  });
}

function renderClients(all) {
  let clients = buildClients(all);
  if (clientQuery) {
    const digits = clientQuery.replace(/\D/g, "");
    clients = clients.filter(
      (c) =>
        c.name.toLowerCase().includes(clientQuery) ||
        (digits && c.phone.replace(/\D/g, "").includes(digits))
    );
  }
  countInfo.textContent = `${clients.length} client${clients.length === 1 ? "" : "s"}`;
  clientsEmpty.style.display = clients.length ? "none" : "block";
  clientsEmpty.textContent = clientQuery ? "Nobody matches that." : "No clients yet.";
  clientsBody.innerHTML = clients.map(clientHtml).join("");

  clientsBody.querySelectorAll("button.btn-client-trips").forEach((btn) => {
    btn.addEventListener("click", () => {
      const phone = btn.dataset.phone;
      if (expandedClients.has(phone)) expandedClients.delete(phone);
      else expandedClients.add(phone);
      renderClients(window.__allBookings || []);
    });
  });
}

function clientHtml(c) {
  const open = expandedClients.has(c.phone);
  // The most recent date can be a trip they haven't taken yet, so don't call
  // an upcoming booking the last time we saw them.
  const when = c.lastAt ? new Date(c.lastAt) : null;
  const last = when
    ? `${when > new Date() ? "next" : "last"} ${when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : "—";
  const spent = c.spentCents ? `$${(c.spentCents / 100).toFixed(2).replace(/\.00$/, "")}` : "—";
  return `
    <article class="client-card">
      <div class="client-top">
        <div>
          <div class="client-name">${esc(c.name || "No name given")}</div>
          <a class="client-phone" href="tel:${esc(c.phone)}">${esc(prettyPhone(c.phone))}</a>
        </div>
        <button type="button" class="btn-client-trips" data-phone="${esc(c.phone)}">${open ? "Hide trips" : "See their trips"}</button>
      </div>
      <div class="client-stats">
        <span><strong>${c.bookings}</strong> booking${c.bookings === 1 ? "" : "s"}</span>
        <span><strong>${c.trips}</strong> taken</span>
        ${c.cancelled ? `<span class="stat-cancelled"><strong>${c.cancelled}</strong> cancelled</span>` : ""}
        <span><strong>${spent}</strong> spent</span>
        <span class="stat-last">${last}</span>
      </div>
      ${open ? tripsTableHtml(c) : ""}
    </article>`;
}

const STATUS_LABEL = {
  requested: "Awaiting confirmation", quoted: "Quoted", confirmed: "Confirmed",
  assigned: "Assigned", in_progress: "Under way", completed: "Completed", cancelled: "Cancelled",
};

/* Their trips, in place. Only completed trips count toward what they've paid —
   a cancelled or still-upcoming booking has a fare on it, but no money. */
function tripsTableHtml(c) {
  const rows = c.rows.map((b) => {
    const at = b.scheduled_at || b.created_at;
    const when = at
      ? new Date(at).toLocaleString(undefined, {
          month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
        })
      : "—";
    const paid = b.status === "completed";
    const fare = b.quoted_price_cents != null
      ? `$${(b.quoted_price_cents / 100).toFixed(2).replace(/\.00$/, "")}`
      : "—";
    return `
      <tr>
        <td>${esc(when)}</td>
        <td>${esc(b.pickup || "—")} → ${esc(b.destination || "—")}</td>
        <td>${b.passengers ?? "?"}</td>
        <td><span class="pill pill-${esc(b.status)}">${esc(STATUS_LABEL[b.status] || b.status)}</span></td>
        <td class="num${paid ? "" : " unpaid"}">${fare}</td>
      </tr>`;
  }).join("");

  const paid = c.spentCents ? `$${(c.spentCents / 100).toFixed(2).replace(/\.00$/, "")}` : "$0";
  return `
    <div class="client-trips">
      <table class="trips-table">
        <thead>
          <tr><th>When</th><th>Trip</th><th>Pax</th><th>Status</th><th class="num">Fare</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4">Paid — completed trips only</td>
            <td class="num">${paid}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

/** Read a stored E.164 number back the way a person would write it. */
function prettyPhone(raw) {
  const lp = window.libphonenumber;
  if (!lp || !raw) return raw || "";
  try {
    return lp.parsePhoneNumberFromString(raw)?.formatInternational() ?? raw;
  } catch {
    return raw;
  }
}

function matchesFilter(b) {
  if (currentFilter === "all") return true;
  if (currentFilter === "completed") return b.status === "completed";
  if (currentFilter === "cancelled") return b.status === "cancelled";
  return !["completed", "cancelled"].includes(b.status); // active
}

function renderBookings(all) {
  const rows = all.filter(matchesFilter);
  countInfo.textContent = `${rows.length} of ${all.length} bookings`;
  emptyState.style.display = rows.length ? "none" : "block";

  bookingsBody.innerHTML = rows.map(cardHtml).join("");

  bookingsBody.querySelectorAll("input.price-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const dollars = parseFloat(inp.value);
      const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
      updateBooking(inp.dataset.id, { quoted_price_cents: cents }, inp.closest(".booking-card"));
    });
  });
  bookingsBody.querySelectorAll("select.boat-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const boatId = sel.value || null;
      // Assigning the boat also hands the trip to its captain — that link is
      // what puts it on the captain's own board for them to close out.
      const boat = boatId ? boatsList.find((x) => x.id === boatId) : null;
      await updateBooking(
        sel.dataset.id,
        { assigned_boat_id: boatId, assigned_captain_id: boat?.owner_id ?? null },
        sel.closest(".booking-card")
      );
      const b = (window.__allBookings || []).find((x) => x.id === sel.dataset.id);
      if (b) {
        b.boats = boatId ? boatsList.find((x) => x.id === boatId) || null : null;
        renderBookings(window.__allBookings);
      }
    });
  });
  bookingsBody.querySelectorAll("input.cancel-reason").forEach((inp) => {
    inp.addEventListener("input", () => inp.classList.remove("input-error"));
  });
  bookingsBody.querySelectorAll("button.btn-cancel-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".booking-card");
      const reasonInput = card.querySelector("input.cancel-reason");
      const reason = reasonInput.value.trim();
      if (!reason) {
        reasonInput.classList.add("input-error");
        reasonInput.focus();
        return;
      }
      reasonInput.classList.remove("input-error");
      updateBooking(btn.dataset.id, { status: "cancelled", cancellation_reason: reason }, card);
    });
  });
  // Confirming is the promise to the customer, so it needs the two things the
  // confirmation actually tells them: which boat, and what it costs.
  bookingsBody.querySelectorAll("button.btn-confirm-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".booking-card");
      const b = (window.__allBookings || []).find((x) => x.id === btn.dataset.id);
      if (!b?.assigned_boat_id) {
        return cardMessage(card, "Pick the boat first — the customer needs to know who's collecting them.");
      }
      if (b.quoted_price_cents == null) {
        return cardMessage(card, "Put the fare in first — it goes in the confirmation.");
      }
      cardMessage(card, "");
      updateBooking(btn.dataset.id, { status: "confirmed" }, card);
    });
  });
  bookingsBody.querySelectorAll("textarea.dispatch-notes-input").forEach((ta) => {
    ta.addEventListener("change", () => {
      updateBooking(ta.dataset.id, { dispatch_notes: ta.value.trim() || null }, ta.closest(".booking-card"));
    });
  });
}

async function updateBooking(id, patch, cardEl) {
  cardEl?.classList.add("row-saving");
  const { error } = await db.from("bookings").update(patch).eq("id", id);
  cardEl?.classList.remove("row-saving");
  if (error) {
    alert("Update failed: " + error.message);
    loadBookings();
  } else {
    const b = (window.__allBookings || []).find((x) => x.id === id);
    if (b) Object.assign(b, patch);
    // A status change moves the card between Active / Completed / Cancelled and
    // changes which buttons apply, so redraw straight away instead of waiting
    // on the realtime round trip.
    if (patch.status) renderBookings(window.__allBookings || []);
  }
}

/** Inline note on one card — used when an action needs something filled in first. */
function cardMessage(card, text) {
  const el = card?.querySelector(".card-msg");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}

// ── rendering helpers ────────────────────────────────────────────────────
function customerConfirmMessage(b) {
  const when = b.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;
  const lines = [`Hi ${b.contact_name || "there"}! This is Paradise Sea Tours confirming your booking:`];
  lines.push(`${b.pickup || "?"} → ${b.destination || "?"}`);
  if (when) lines.push(when);
  if (b.boats?.name) {
    lines.push(`Boat: ${b.boats.name}${b.boats.captain_name ? ` (Capt. ${b.boats.captain_name})` : ""}`);
  }
  if (b.quoted_price_cents != null) lines.push(`Price: $${(b.quoted_price_cents / 100).toFixed(2)}`);
  lines.push("See you soon!");
  return lines.join("\n");
}

function cardHtml(b) {
  const when = b.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "No time given";
  const received = new Date(b.created_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const price = b.quoted_price_cents != null ? (b.quoted_price_cents / 100).toFixed(2) : "";

  const statusBanner =
    b.status === "cancelled"
      ? `<div class="status-banner sb-cancelled">✗ Cancelled${b.cancellation_reason ? ` — ${esc(b.cancellation_reason)}` : ""}</div>`
      : b.status === "completed"
      ? `<div class="status-banner sb-completed">✓ Trip completed</div>`
      : b.status === "in_progress"
      ? `<div class="status-banner sb-underway">⛵ Under way — passengers are aboard</div>`
      : b.status === "confirmed"
      ? `<div class="status-banner sb-confirmed">✓ Confirmed — ${esc(b.boats?.captain_name || "the captain")} has this trip</div>`
      : "";

  // A boat with no login can never close its own trips out, and dispatch has no
  // Complete button to fall back on — so say so at the point of assigning.
  const captainLoginMissing =
    b.assigned_boat_id && !b.boats?.owner_id
      ? `<p class="no-login-warn">⚠ ${esc(b.boats?.captain_name || "This captain")} has no login yet — they won't be able to mark the trip finished.</p>`
      : "";

  // A booking moves requested → confirmed → completed. Show one next step at a
  // time so it's never a guess which button applies.
  const finished = b.status === "completed" || b.status === "cancelled";
  const confirmed = b.status === "confirmed" || b.status === "in_progress";
  // Closing the trip out is the captain's call — they're the one who knows the
  // passengers are off the boat — so dispatch has no Complete button.
  const nextAction = confirmed
    ? `<span class="awaiting-captain">${b.status === "in_progress"
        ? "On the water — the captain closes it out"
        : "Waiting on the captain to pick them up"}</span>`
    : `<button type="button" class="btn-confirm-row" data-id="${b.id}">✓ Confirm this boat</button>`;
  // Once a trip is closed out, the boat and the fare are a record of what
  // happened — that fare is what the captain is owed on Friday — so they read
  // back as plain text with nothing to nudge by accident.
  const controls = finished
    ? `<div class="card-controls">
        <div class="control">
          <label>Boat</label>
          <div class="ro-value">${b.boats?.name
            ? `${esc(b.boats.name)}${b.boats.captain_name ? ` — Capt. ${esc(b.boats.captain_name)}` : ""}`
            : "No boat assigned"}</div>
          <div class="fare-row">
            <label>Fare</label>
            <div class="ro-value">${price ? `$${price}` : "—"}</div>
          </div>
        </div>
      </div>`
    : `<div class="card-controls">
        <div class="control">
          <label>Boat</label>
          <select class="boat-select" data-id="${b.id}">
            <option value="">— Unassigned —</option>
            ${boatsList.map((boat) =>
              `<option value="${boat.id}" ${boat.id === b.assigned_boat_id ? "selected" : ""}>${esc(boat.name)} — Capt. ${esc(boat.captain_name || "?")}${boat.is_available ? "" : " (not available)"}</option>`
            ).join("")}
          </select>
          ${b.boats?.captain_whatsapp
            ? `<a class="wa-link" href="https://wa.me/${b.boats.captain_whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener">💬 ${esc(b.boats.captain_name || "")}</a>`
            : ""}
          ${captainLoginMissing}
          <div class="fare-row">
            <label>Fare $</label>
            <input type="number" step="0.01" min="0" class="price-input" data-id="${b.id}" value="${price}" placeholder="—">
          </div>
        </div>
      </div>`;

  const footer = finished
    ? ""
    : `<p class="card-msg" hidden></p>
      <div class="card-footer">
        <div class="cancel-group">
          <input type="text" class="cancel-reason" placeholder="Cancel reason (required)">
          <button type="button" class="btn-cancel-row" data-id="${b.id}">Cancel</button>
        </div>
        ${nextAction}
      </div>`;

  return `
    <article class="booking-card">
      <div class="card-header">
        <div>
          <span class="contact-name">${esc(b.contact_name || "—")}</span>
          <span class="contact-phone">${esc(prettyPhone(b.contact_phone || ""))}</span>
        </div>
        <span class="received-at">Received ${received}</span>
      </div>

      ${statusBanner}

      <div class="card-trip">
        <div class="trip-route">${esc(b.pickup || "—")} <span class="arrow">→</span> ${esc(b.destination || "—")}</div>
        <div class="trip-meta">${when} · ${b.passengers ?? "?"} pax · ${esc(b.trip_type || "")}</div>
        ${b.notes ? `<div class="card-notes">${esc(b.notes)}</div>` : ""}
        ${b.contact_phone
          ? `<a class="wa-link${confirmed ? " wa-send" : ""}" href="https://wa.me/${b.contact_phone.replace(/\D/g, "")}?text=${encodeURIComponent(customerConfirmMessage(b))}" target="_blank" rel="noopener">💬 ${confirmed ? "Send the boat details" : "Message customer"}</a>`
          : ""}
      </div>

      ${controls}

      <div class="dispatch-notes-section">
        <label>Dispatch Notes</label>
        <textarea class="dispatch-notes-input" data-id="${b.id}" rows="2"
          placeholder="Internal notes — call attempts, special arrangements, etc.">${esc(b.dispatch_notes || "")}</textarea>
      </div>

      ${footer}
    </article>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
