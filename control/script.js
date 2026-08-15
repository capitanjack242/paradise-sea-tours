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
const clientBanner = document.getElementById("clientBanner");

let currentFilter = "active";
let currentView = "bookings";
let clientFilterPhone = null; // set when drilling into one client's trips
let clientQuery = "";
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
    .select("id, name, captain_name, captain_whatsapp, owner_id")
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
  if (currentView === "clients") clearClientFilter({ redraw: false });
  applyView();
});

function applyView() {
  const onClients = currentView === "clients";
  bookingsWrap.style.display = onClients ? "none" : "";
  bookingFilters.style.display = onClients ? "none" : "";
  clientsWrap.style.display = onClients ? "" : "none";
  if (onClients) renderClients(window.__allBookings || []);
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
  else renderBookings(data);
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
      c = { phone, name: "", bookings: 0, trips: 0, cancelled: 0, spentCents: 0, lastAt: null };
      byPhone.set(phone, c);
    }
    c.bookings += 1;
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
  return [...byPhone.values()].sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
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
    btn.addEventListener("click", () => showClientTrips(btn.dataset.phone));
  });
}

function clientHtml(c) {
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
        <button type="button" class="btn-client-trips" data-phone="${esc(c.phone)}">See their trips</button>
      </div>
      <div class="client-stats">
        <span><strong>${c.bookings}</strong> booking${c.bookings === 1 ? "" : "s"}</span>
        <span><strong>${c.trips}</strong> taken</span>
        ${c.cancelled ? `<span class="stat-cancelled"><strong>${c.cancelled}</strong> cancelled</span>` : ""}
        <span><strong>${spent}</strong> spent</span>
        <span class="stat-last">${last}</span>
      </div>
    </article>`;
}

function showClientTrips(phone) {
  clientFilterPhone = phone;
  currentView = "bookings";
  currentFilter = "all";
  document.querySelectorAll(".vtab").forEach((t) => t.classList.toggle("active", t.dataset.view === "bookings"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.filter === "all"));
  applyView();
}

function clearClientFilter({ redraw = true } = {}) {
  clientFilterPhone = null;
  if (redraw) renderBookings(window.__allBookings || []);
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
  if (clientFilterPhone && (b.contact_phone || "").trim() !== clientFilterPhone) return false;
  if (currentFilter === "all") return true;
  if (currentFilter === "completed") return b.status === "completed";
  if (currentFilter === "cancelled") return b.status === "cancelled";
  return !["completed", "cancelled"].includes(b.status); // active
}

function renderBookings(all) {
  const rows = all.filter(matchesFilter);
  countInfo.textContent = `${rows.length} of ${all.length} bookings`;
  emptyState.style.display = rows.length ? "none" : "block";

  if (clientFilterPhone) {
    const who = rows[0]?.contact_name || prettyPhone(clientFilterPhone);
    clientBanner.innerHTML =
      `<span>Showing every trip for <strong>${esc(who)}</strong></span>` +
      `<button type="button" id="clearClientBtn">Show all bookings</button>`;
    clientBanner.hidden = false;
    document.getElementById("clearClientBtn").addEventListener("click", () => clearClientFilter());
  } else {
    clientBanner.hidden = true;
  }

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
    ? `<span class="awaiting-captain">Waiting on the captain to close it out</span>`
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
              `<option value="${boat.id}" ${boat.id === b.assigned_boat_id ? "selected" : ""}>${esc(boat.name)} — Capt. ${esc(boat.captain_name || "?")}</option>`
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
