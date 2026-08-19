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
const payoutWrap = document.getElementById("payoutWrap");
const mapWrap = document.getElementById("mapWrap");
const payoutBody = document.getElementById("payoutBody");
const payoutEmpty = document.getElementById("payoutEmpty");
const payoutTotals = document.getElementById("payoutTotals");

/** Where a passenger reads their own trip. Their token is the only key. */
const TRIP_URL = location.origin + location.pathname.replace(/control\/$/, "trip/");

let currentFilter = "active";
let currentView = "bookings";
let clientQuery = "";
const expandedClients = new Set(); // clients whose trip table is open
const expandedPayouts = new Set(); // boats whose week's trips are open
const openThreads = new Set();     // bookings whose message thread is open
let threadsByBooking = new Map();  // booking id -> messages, loaded with the board
let weekOffset = 0;                // 0 = the pay week running now
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
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
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
    .select(
      "id, name, kind, capacity, home_dock, captain_name, captain_whatsapp, owner_id, " +
        "is_available, availability_changed_at, commission_pct, last_lat, last_lng, last_located_at"
    )
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
  payoutWrap.style.display = on("payout");
  mapWrap.style.display = on("map");
  if (currentView === "clients") renderClients(window.__allBookings || []);
  else if (currentView === "boats") renderBoats();
  else if (currentView === "payout") renderPayout();
  else if (currentView === "map") renderMap();
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
  await loadMessages();
  if (currentView === "clients") renderClients(data);
  else if (currentView === "boats") renderBoats();
  else if (currentView === "payout") renderPayout();
  else if (currentView === "map") renderMap();
  else renderBookings(data);
}

/* ── Friday payout ────────────────────────────────────────────────────────
   Boats are paid every Friday, so a pay week runs Friday to Thursday and is
   settled on the Friday straight after it closes. Nothing is ever paid before
   it's earned, and there's no gap between one week and the next. Confirmed
   with Jack as how the business actually runs, not an assumption. */
const PAY_WEEK_ENDS_ON = 5; // 0 Sun … 5 Fri: the day a week is paid out

/** Midnight on the payday-weekday that opens the pay week `offset` weeks away. */
function payWeekStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() - PAY_WEEK_ENDS_ON + 7) % 7;
  d.setDate(d.getDate() - back + offset * 7);
  return d;
}

function payWeek(offset = 0) {
  const start = payWeekStart(offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7); // exclusive: the payday itself opens the next week
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  return { start, end, payday: end, lastDay };
}

const dayMonth = (d) =>
  d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

document.getElementById("weekPrev").addEventListener("click", () => {
  weekOffset -= 1;
  expandedPayouts.clear();
  renderPayout();
});
document.getElementById("weekNext").addEventListener("click", () => {
  if (weekOffset >= 0) return; // nothing to show for a week that hasn't started
  weekOffset += 1;
  expandedPayouts.clear();
  renderPayout();
});

/** What a fare splits into. Integer cents throughout so nothing rounds away. */
function splitFare(grossCents, pct) {
  const rate = Number(pct) > 0 ? Number(pct) : 0;
  const commission = Math.round((grossCents * rate) / 100);
  return { gross: grossCents, commission, net: grossCents - commission };
}

/**
 * The rate that applies to one trip.
 *
 * A completed trip carries the rate it was closed out at, so changing a boat's
 * rate today can't rewrite what a captain was paid last month. A trip still
 * running has no stamp yet and reads the boat, which is right: nothing is owed
 * until it's finished.
 */
function tripPct(booking, boat) {
  return booking.commission_pct != null
    ? Number(booking.commission_pct)
    : Number(boat?.commission_pct) || 0;
}

function buildPayout() {
  const { start, end } = payWeek(weekOffset);
  const byBoat = new Map();

  for (const b of window.__allBookings || []) {
    if (b.status !== "completed") continue; // only trips actually run are owed
    const at = b.scheduled_at ? new Date(b.scheduled_at) : null;
    if (!at) continue;

    const inWeek = at >= start && at < end;
    const tipOwing = (b.tip_cents || 0) > 0 && !b.tip_paid_out_at;
    // A tip given after its week was paid out would otherwise be stranded in a
    // settled week nobody opens again. It carries forward into the open week.
    const strandedTip = !inWeek && at < start && tipOwing && weekOffset === 0;
    if (!inWeek && !strandedTip) continue;

    const key = b.assigned_boat_id || "unassigned";
    let row = byBoat.get(key);
    if (!row) {
      const boat = boatsList.find((x) => x.id === b.assigned_boat_id);
      row = {
        key,
        name: b.boats?.name || "No boat assigned",
        captain: b.boats?.captain_name || null,
        boat,
        // Rates seen in this week's trips. Usually one; more than one after a
        // rate change mid-week, and the header has to stop claiming a single
        // figure when that happens.
        rates: new Set(),
        trips: [],
        owedCents: 0,      // net — what actually goes to the boat
        paidCents: 0,      // net, already settled
        grossCents: 0,     // fares before tax — the base commission is taken on
        vatCents: 0,       // the government's share, never anyone's to split
        tipCents: 0,       // tips still to hand over — no commission comes off these
        commissionCents: 0 // what Paradise keeps
      };
      byBoat.set(key, row);
    }
    row.trips.push(b);
    if (inWeek) {
      const pct = tripPct(b, row.boat);
      row.rates.add(pct);
      // The fare, not the total: commission on VAT would be a cut of a tax bill.
      const split = splitFare(b.quoted_price_cents || 0, pct);
      row.grossCents += split.gross;
      row.vatCents += b.vat_cents || 0;
      row.commissionCents += split.commission;
      if (b.paid_out_at) row.paidCents += split.net;
      else row.owedCents += split.net;
    }
    // Every cent of a tip goes to the boat, so it joins what's owed without
    // passing through the commission split at all.
    if (tipOwing) {
      row.tipCents += b.tip_cents;
      row.owedCents += b.tip_cents;
    }
  }

  for (const row of byBoat.values()) {
    row.trips.sort((x, y) => (x.scheduled_at || "").localeCompare(y.scheduled_at || ""));
    row.unpaid = row.trips.filter((t) => !t.paid_out_at);
    // A trip whose fare was settled but whose tip wasn't is still owed money.
    row.tipsUnpaid = row.trips.filter((t) => (t.tip_cents || 0) > 0 && !t.tip_paid_out_at);
    row.settled = row.unpaid.length === 0 && row.tipsUnpaid.length === 0;
    // One rate across the week gets named; a mixture doesn't get flattened into
    // an average that matches none of the trips.
    const rates = [...row.rates];
    row.pct = rates.length === 1 ? rates[0] : 0;
    row.mixedRates = rates.filter((r) => r > 0).length > 1;
  }
  return [...byBoat.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function renderPayout() {
  const { start, lastDay, payday } = payWeek(weekOffset);
  const rows = buildPayout();

  document.getElementById("weekRange").textContent = `${dayMonth(start)} — ${dayMonth(lastDay)}`;
  const paydayText =
    weekOffset === 0
      ? `Still running · pay out ${dayMonth(payday)}`
      : `Paid out ${dayMonth(payday)}`;
  document.getElementById("weekPayday").textContent = paydayText;
  document.getElementById("weekNext").disabled = weekOffset >= 0;

  const owed = rows.reduce((n, r) => n + r.owedCents, 0);
  const paid = rows.reduce((n, r) => n + r.paidCents, 0);
  const trips = rows.reduce((n, r) => n + r.trips.length, 0);
  const commission = rows.reduce((n, r) => n + r.commissionCents, 0);
  const vat = rows.reduce((n, r) => n + r.vatCents, 0);
  const tips = rows.reduce((n, r) => n + r.tipCents, 0);

  payoutTotals.innerHTML = rows.length
    ? `<div class="tot">
         <span class="tot-lab">To pay</span>
         <span class="tot-val money">${dollars(owed)}</span>
       </div>
       <div class="tot">
         <span class="tot-lab">Already paid</span>
         <span class="tot-val money muted-val">${dollars(paid)}</span>
       </div>
       ${commission
         ? `<div class="tot tot-keep">
              <span class="tot-lab">Your commission</span>
              <span class="tot-val money">${dollars(commission)}</span>
            </div>`
         : ""}
       ${vat
         ? `<div class="tot tot-vat">
              <span class="tot-lab">VAT collected</span>
              <span class="tot-val money">${dollars(vat)}</span>
              <span class="tot-hint">owed to government</span>
            </div>`
         : ""}
       ${tips
         ? `<div class="tot tot-tip">
              <span class="tot-lab">Tips</span>
              <span class="tot-val money">${dollars(tips)}</span>
              <span class="tot-hint">all to the boats</span>
            </div>`
         : ""}
       <div class="tot">
         <span class="tot-lab">Trips</span>
         <span class="tot-val money">${trips}</span>
       </div>
       <div class="tot">
         <span class="tot-lab">Boats</span>
         <span class="tot-val money">${rows.length}</span>
       </div>`
    : "";

  countInfo.textContent = rows.length ? `${dollars(owed)} to pay` : "";
  payoutEmpty.style.display = rows.length ? "none" : "block";
  payoutBody.innerHTML = rows.map(payoutHtml).join("");

  payoutBody.querySelectorAll("button.btn-payout-trips").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.key;
      expandedPayouts.has(k) ? expandedPayouts.delete(k) : expandedPayouts.add(k);
      renderPayout();
    });
  });
  payoutBody.querySelectorAll("button.btn-mark-paid").forEach((btn) => {
    btn.addEventListener("click", () => markPaid(btn.dataset.key, btn.closest(".payout-card")));
  });
}

function dollars(cents) {
  return `$${((cents || 0) / 100).toFixed(2).replace(/\.00$/, "")}`;
}

function payoutHtml(r) {
  const open = expandedPayouts.has(r.key);
  const tripRows = r.trips
    .map((t) => {
      const when = t.scheduled_at
        ? new Date(t.scheduled_at).toLocaleString(undefined, {
            weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          })
        : "—";
      return `
        <tr>
          <td>${esc(when)}</td>
          <td>${esc(t.pickup || "—")} → ${esc(t.destination || "—")}</td>
          <td>${t.passengers ?? "?"}</td>
          <td>${t.paid_out_at ? `<span class="pill pill-completed">Paid</span>` : ""}</td>
          <td class="num${t.paid_out_at ? " unpaid" : ""}">${dollars(
            (t.paid_out_at ? 0 : splitFare(t.quoted_price_cents || 0, tripPct(t, r.boat)).net) +
            ((t.tip_cents || 0) > 0 && !t.tip_paid_out_at ? t.tip_cents : 0)
          )}${(t.tip_cents || 0) > 0 ? ` <span class="tip-flag">+tip</span>` : ""}</td>
        </tr>`;
    })
    .join("");

  return `
    <article class="payout-card${r.settled ? " is-settled" : ""}">
      <div class="payout-top">
        <div>
          <div class="payout-boat">${esc(r.name)}</div>
          <div class="payout-cap">${r.captain ? `Capt. ${esc(r.captain)} · ` : ""}${r.trips.length} trip${r.trips.length === 1 ? "" : "s"}</div>
        </div>
        <div class="payout-amount">
          <div class="money payout-owed">${dollars(r.owedCents)}</div>
          ${r.pct
            ? `<div class="payout-split">${dollars(r.grossCents)} in fares before VAT · less ${r.pct}% (${dollars(r.commissionCents)})</div>`
            : r.mixedRates
            ? `<div class="payout-split">${dollars(r.grossCents)} in fares before VAT · less commission (${dollars(r.commissionCents)}), rate changed this week</div>`
            : ""}
          ${r.tipCents ? `<div class="payout-tip">plus ${dollars(r.tipCents)} in tips — no commission</div>` : ""}
          ${r.paidCents ? `<div class="payout-already">${dollars(r.paidCents)} already paid</div>` : ""}
        </div>
      </div>
      <div class="payout-actions">
        <button type="button" class="btn-payout-trips" data-key="${esc(r.key)}">
          ${open ? "Hide trips" : "See trips"}
        </button>
        ${r.settled
          ? `<span class="payout-done">✓ Settled</span>`
          : `<button type="button" class="btn-mark-paid" data-key="${esc(r.key)}">
               Mark ${dollars(r.owedCents)} paid
             </button>`}
      </div>
      ${open
        ? `<div class="client-trips">
             <table class="trips-table">
               <thead><tr><th>When</th><th>Trip</th><th>Pax</th><th></th><th class="num">To boat</th></tr></thead>
               <tbody>${tripRows}</tbody>
             </table>
           </div>`
        : ""}
    </article>`;
}

async function markPaid(key, card) {
  const row = buildPayout().find((r) => r.key === key);
  if (!row || (!row.unpaid.length && !row.tipsUnpaid.length)) return;

  const stamp = new Date().toISOString();
  card?.classList.add("row-saving");

  // Two stamps, because they come apart: a trip whose fare was paid out last
  // Friday can still be carrying a tip that hasn't been handed over.
  const errors = [];
  if (row.unpaid.length) {
    const { error } = await db
      .from("bookings")
      .update({ paid_out_at: stamp })
      .in("id", row.unpaid.map((t) => t.id));
    if (error) errors.push(error.message);
  }
  if (row.tipsUnpaid.length) {
    const { error } = await db
      .from("bookings")
      .update({ tip_paid_out_at: stamp })
      .in("id", row.tipsUnpaid.map((t) => t.id));
    if (error) errors.push(error.message);
  }
  card?.classList.remove("row-saving");

  if (errors.length) {
    alert("Couldn't record that payout: " + errors.join("; "));
    loadBookings();
    return;
  }
  for (const t of row.unpaid) {
    const b = (window.__allBookings || []).find((x) => x.id === t.id);
    if (b) b.paid_out_at = stamp;
  }
  for (const t of row.tipsUnpaid) {
    const b = (window.__allBookings || []).find((x) => x.id === t.id);
    if (b) b.tip_paid_out_at = stamp;
  }
  renderPayout();
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

  // A boat is working if it has a trip under way or confirmed for today; on
  // and not working is idle, and idle is what dispatch is hunting for.
  const working = new Set(
    (window.__allBookings || [])
      .filter((bk) => bk.assigned_boat_id && ["confirmed", "in_progress"].includes(bk.status))
      .map((bk) => bk.assigned_boat_id)
  );

  const sorted = [...boatsList].sort((a, b) => {
    if (!!a.is_available !== !!b.is_available) return a.is_available ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
  boatsBody.innerHTML = sorted
    .map((b) => boatHtml(b, runsToday.get(b.id) || 0, working.has(b.id)))
    .join("");
}

function boatHtml(b, runs, working) {
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
      ${boatWhereHtml(b, on, working)}
      ${stale ? `<div class="boat-stale">⚠ Set available on ${changed} and never changed — worth checking he still is</div>` : ""}
    </article>`;
}

/* Where a boat is.

   Only ever shown for a boat that is switched on: the position is wiped when a
   captain goes unavailable, so an off boat has nothing to show and that is the
   point — nobody is followed off the clock.

   The age is always on screen. A fix from an hour ago is still worth seeing on
   this board — it tells dispatch roughly where he was — but it must not be
   read as where he is now, and "1h ago" says that plainly. */
function boatWhereHtml(b, on, working) {
  if (!on) return "";

  if (b.last_lat == null || b.last_lng == null) {
    return `<div class="boat-where boat-where-none">
      📍 No position — the app hasn't reported in
    </div>`;
  }

  const mins = Math.max(Math.round((Date.now() - new Date(b.last_located_at)) / 60000), 0);
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
  const cold = mins > 10;
  const map = `https://www.google.com/maps/search/?api=1&query=${b.last_lat},${b.last_lng}`;

  return `<div class="boat-where${cold ? " boat-where-cold" : ""}">
    <span class="boat-where-tag">${working ? "On a run" : "Idle"}</span>
    <a href="${map}" target="_blank" rel="noopener noreferrer">📍 Where she is</a>
    <span class="boat-where-age">updated ${age}</span>
  </div>`;
}

/* ── the fleet on a map ───────────────────────────────────────────────────

   The same positions the Boats tab prints as a link, drawn together so dispatch
   can answer "who is nearest the port" without opening five tabs.

   What is NOT on the map matters as much as what is. A boat only reports while
   its captain is switched on — going unavailable wipes the position, by design,
   because nobody is followed off the clock. So every boat that cannot be drawn
   is named underneath the map with the reason. A map that silently omits half
   the fleet would be read as "that's everyone", and that is the one thing it
   must never say.

   Fixes older than ten minutes are drawn hollow and carry their age. A boat
   that reported twenty minutes ago is still worth seeing — it says roughly
   where she was — but it is not where she is. */

const NASSAU = [25.0793, -77.3383]; // Prince George Wharf, near enough
const STALE_MINS = 10;

let fleetMap = null;
let fleetLayer = null;

function fixAge(at) {
  const mins = Math.max(Math.round((Date.now() - new Date(at)) / 60000), 0);
  return {
    mins,
    text: mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`,
  };
}

function renderMap() {
  const note = document.getElementById("mapNote");
  const missing = document.getElementById("mapMissing");

  // Leaflet comes off a CDN. If it didn't arrive, say so plainly rather than
  // leaving an empty grey box that looks like "no boats".
  if (typeof L === "undefined") {
    note.innerHTML = `<span class="map-warn">The map didn't load — check the connection and refresh.
      The Boats tab still has every position as a link.</span>`;
    missing.innerHTML = "";
    return;
  }

  if (!fleetMap) {
    fleetMap = L.map("fleetMap", { scrollWheelZoom: false }).setView(NASSAU, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap",
    }).addTo(fleetMap);
    fleetLayer = L.layerGroup().addTo(fleetMap);
  }
  // The container was display:none until a moment ago, so Leaflet measured it
  // as zero. Without this the tiles come out in a strip down the left.
  fleetMap.invalidateSize();
  fleetLayer.clearLayers();

  const working = new Set(
    (window.__allBookings || [])
      .filter((bk) => bk.assigned_boat_id && ["confirmed", "in_progress"].includes(bk.status))
      .map((bk) => bk.assigned_boat_id)
  );

  const drawn = [];
  const silent = [];
  const off = [];

  for (const b of boatsList) {
    if (!b.is_available) {
      off.push(b);
      continue;
    }
    if (b.last_lat == null || b.last_lng == null) {
      silent.push(b);
      continue;
    }
    drawn.push(b);

    const age = fixAge(b.last_located_at);
    const cold = age.mins > STALE_MINS;
    const busy = working.has(b.id);
    const cls = `pin${busy ? " pin-run" : " pin-idle"}${cold ? " pin-cold" : ""}`;

    L.marker([b.last_lat, b.last_lng], {
      icon: L.divIcon({
        className: "pin-wrap",
        html: `<span class="${cls}"><b>${esc(b.name || "—")}</b>${cold ? ` · ${age.text}` : ""}</span>`,
        iconSize: null,
      }),
      title: b.name || "",
    })
      .bindPopup(
        `<div class="pin-pop">
           <strong>${esc(b.name || "—")}</strong>
           <div>Capt. ${esc(b.captain_name || "—")}</div>
           <div>${busy ? "On a run" : "Idle"} · updated ${age.text}</div>
           <a href="https://www.google.com/maps/search/?api=1&query=${b.last_lat},${b.last_lng}"
              target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
         </div>`
      )
      .addTo(fleetLayer);
  }

  // Frame what there is: the whole fleet if it's spread out, a sensible zoom if
  // there's only one, and Nassau itself if nobody is reporting.
  if (drawn.length > 1) {
    fleetMap.fitBounds(
      L.latLngBounds(drawn.map((b) => [b.last_lat, b.last_lng])).pad(0.25),
      { maxZoom: 15 }
    );
  } else if (drawn.length === 1) {
    fleetMap.setView([drawn[0].last_lat, drawn[0].last_lng], 14);
  } else {
    fleetMap.setView(NASSAU, 12);
  }

  countInfo.textContent = `${drawn.length} of ${boatsList.length} reporting`;

  const cold = drawn.filter((b) => fixAge(b.last_located_at).mins > STALE_MINS).length;
  note.innerHTML = drawn.length
    ? `<span class="map-key"><i class="key key-run"></i>On a run</span>
       <span class="map-key"><i class="key key-idle"></i>Idle</span>
       ${cold ? `<span class="map-key"><i class="key key-cold"></i>Last seen over ${STALE_MINS} min ago</span>` : ""}`
    : `<span class="map-warn">No boat is reporting a position right now.</span>`;

  // Named, not counted: "2 boats missing" sends dispatch hunting for which.
  const list = (label, boats, why) =>
    boats.length
      ? `<div class="miss-row"><span class="miss-lab">${label}</span>
           <span class="miss-names">${boats.map((b) => esc(b.name || "—")).join(", ")}</span>
           <span class="miss-why">${why}</span></div>`
      : "";
  missing.innerHTML =
    list("Not on the map", silent, "switched on, but the app hasn't reported a position") +
    list("Off", off, "unavailable — position is wiped when a captain switches off");
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
      // What they actually paid, which includes the tax on it.
      c.spentCents += b.total_cents ?? b.quoted_price_cents ?? 0;
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
    const charged = b.total_cents ?? b.quoted_price_cents;
    const fare = charged != null
      ? `$${(charged / 100).toFixed(2).replace(/\.00$/, "")}`
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

  // This is a client's own history — what they paid us. Commission is between
  // us and the boat, and the footer here used to reach for a payout row's rate
  // that doesn't exist in this function, which threw the moment anyone opened
  // a client's trips.
  const paid = c.spentCents ? `$${(c.spentCents / 100).toFixed(2).replace(/\.00$/, "")}` : "$0";
  return `
    <div class="client-trips">
      <table class="trips-table">
        <thead>
          <tr><th>When</th><th>Trip</th><th>Pax</th><th>Status</th><th class="num">Total</th></tr>
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

async function loadMessages() {
  const { data, error } = await db
    .from("messages")
    .select("id, booking_id, sender, body, channel, created_at")
    .order("created_at");
  if (error) {
    console.error("load messages failed:", error);
    return;
  }
  const byBooking = new Map();
  for (const m of data || []) {
    if (!byBooking.has(m.booking_id)) byBooking.set(m.booking_id, []);
    byBooking.get(m.booking_id).push(m);
  }
  threadsByBooking = byBooking;
}

/* How many passenger messages have arrived since anyone here last replied.
   Derived rather than stored — no read receipts to keep in step, and it answers
   the only question that matters: is somebody waiting on us. */
function awaitingReply(bookingId) {
  const thread = threadsByBooking.get(bookingId) || [];
  let n = 0;
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].sender === "customer") n++;
    else break;
  }
  return n;
}

async function sendMessage(bookingId, body, card) {
  const text = (body || "").trim();
  if (!text) return;
  card?.classList.add("row-saving");
  const { error } = await db
    // The office speaks in the office channel — the one a passenger can always
    // reach, paid or not.
    .insert({ booking_id: bookingId, sender: "dispatch", body: text, channel: "office" });
  card?.classList.remove("row-saving");
  if (error) {
    alert("Message not sent: " + error.message);
    return;
  }
  await loadMessages();
  renderBookings(window.__allBookings || []);
}

/* Payment, and what it unlocks.

   No provider is wired up yet, so today this is dispatch recording a payment
   that was taken by hand while we get Fygaro connected. It is scaffolding, not
   a way of working: fares are card only, and no trip runs before the card link
   is live. When that link exists it calls the same database function this
   button calls, and this panel doesn't change.

   It earns its place on the card because payment is what opens the captain to
   the passenger: an unpaid trip means dispatch is the only way through, and a
   dispatcher on the phone needs to see that at a glance. */
function paymentHtml(b) {
  // The total, not the fare. A passenger who paid the fare and left the tax has
  // not paid, and the captain must stay out of reach until they have.
  const owed = b.total_cents != null ? b.total_cents : b.quoted_price_cents;
  const paid = b.amount_paid_cents || 0;
  const outstanding = Math.max((owed || 0) - paid, 0);
  const breakdown = b.vat_cents
    ? `<span class="pay-breakdown">${dollars(b.quoted_price_cents)} fare + ${dollars(b.vat_cents)} VAT</span>`
    : "";

  if (b.paid_at) {
    const when = new Date(b.paid_at).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    return `<div class="pay-row is-paid">
      <span class="pay-state">✓ Paid ${dollars(paid)}</span>
      <span class="pay-when">${esc(when)} · captain reachable</span>
      ${outstanding > 0 ? `<span class="pay-owing">${dollars(outstanding)} still outstanding</span>` : ""}
    </div>`;
  }

  if (!owed) {
    return `<div class="pay-row">
      <span class="pay-state">Unpaid</span>
      <span class="pay-when">Set a fare before recording a payment</span>
    </div>`;
  }

  return `<div class="pay-row">
    <span class="pay-state">Unpaid — captain not reachable</span>
    ${breakdown}
    <button type="button" class="btn-mark-paid-booking" data-id="${b.id}" data-amount="${owed}">
      Record ${dollars(owed)} paid
    </button>
  </div>`;
}

/* What the passenger thought.

   Two scores, because they fail differently: a captain who was late is a
   conversation with him, a boat that was too small is a conversation about the
   boat. Only ever shown once they've said — an unrated trip says nothing, and
   dressing that up as a zero would be a lie about a captain. */
function ratingHtml(b) {
  if (!b.rated_at) return "";
  const stars = (n) => `<span class="rate-stars" aria-label="${n} out of 5">${
    "★".repeat(n)}<span class="rate-off">${"★".repeat(5 - n)}</span></span>`;
  const note = b.rating_note
    ? `<div class="rate-said">"${esc(b.rating_note)}"</div>`
    : "";
  const low = Math.min(b.rating_captain || 5, b.rating_ride || 5) <= 3;
  return `<div class="rating-row${low ? " rating-low" : ""}">
    <div class="rate-pair">
      <span class="rate-lab">Captain</span>${stars(b.rating_captain || 0)}
      <span class="rate-lab">Trip</span>${stars(b.rating_ride || 0)}
    </div>
    ${note}
  </div>`;
}

/* Tips, on the same card as the payment.

   Recorded by dispatch today because the money arrives in their hand — cash on
   the dock, usually. When a payment link exists the passenger will add it
   themselves and this calls the same function.

   It sits apart from the payment row on purpose: a tip is not part of the bill,
   it isn't taxed, and no commission comes off it. Every cent goes to the boat. */
function tipHtml(b) {
  // Nothing to tip until there's a boat on the trip.
  if (!b.assigned_boat_id) return "";
  const tip = b.tip_cents || 0;

  const state = tip
    ? `<span class="tip-state">✓ ${dollars(tip)} tip${
        b.tip_paid_out_at ? " · handed over" : " · goes to the boat in full"
      }</span>`
    : `<span class="tip-state tip-none">No tip</span>`;

  return `<div class="tip-row${tip ? " has-tip" : ""}">
    ${state}
    <input type="number" class="tip-input" data-id="${b.id}" min="0.01" step="0.01"
           placeholder="Add $" inputmode="decimal" aria-label="Tip amount in dollars">
    <button type="button" class="btn-add-tip" data-id="${b.id}">Add tip</button>
  </div>`;
}

function threadHtml(b) {
  const thread = threadsByBooking.get(b.id) || [];
  const bubbles = thread.length
    ? thread
        .map((m) => {
          const at = new Date(m.created_at).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          });
          const who = m.sender === "customer" ? esc(b.contact_name || "Passenger")
                    : m.sender === "captain" ? esc(b.boats?.captain_name || "Captain")
                    : "You";
          return `<div class="bub bub-${esc(m.sender)}">
                    <div class="bub-who">${who} · ${at}</div>
                    <div class="bub-body">${esc(m.body)}</div>
                  </div>`;
        })
        .join("")
    : `<p class="thread-empty">Nothing said yet.</p>`;

  return `
    <div class="thread-box">
      <div class="thread-scroll">${bubbles}</div>
      <div class="thread-compose">
        <input type="text" class="thread-input" data-id="${b.id}"
               placeholder="Message ${esc(b.contact_name || "the passenger")}…" maxlength="2000">
        <button type="button" class="thread-send" data-id="${b.id}">Send</button>
      </div>
      <p class="thread-link">
        Passenger's link:
        <code>${TRIP_URL}?t=${esc(b.access_token || "")}</code>
        <button type="button" class="thread-copy" data-token="${esc(b.access_token || "")}">Copy</button>
      </p>
    </div>`;
}

/* ── asking a captain ─────────────────────────────────────────────────────
   Nothing is promised to a passenger before a boat has agreed to run it. Most
   captains have no app, so the office asking on the phone and writing down the
   answer is the normal path, not a workaround — but it's recorded either way,
   and it's recorded who said it. */
function offerHtml(b) {
  if (!b.assigned_boat_id) return "";
  const who = esc(b.boats?.captain_name || "the captain");

  if (b.captain_response === "accepted") {
    const how = b.response_by === "captain" ? "in the app" : "on the phone";
    return `<p class="offer-state offer-yes">✓ ${who} accepted ${how}${
      b.responded_at ? ` · ${shortTime(b.responded_at)}` : ""
    }</p>`;
  }

  if (b.captain_response === "declined") {
    return `<div class="offer-state offer-no">
        <strong>✗ ${who} can't take this one</strong>
        ${b.decline_reason ? `<span>${esc(b.decline_reason)}</span>` : ""}
        <span class="offer-hint">Pick another boat — changing it asks them fresh.</span>
      </div>`;
  }

  if (b.offered_at) {
    return `<div class="offer-state offer-waiting">
        <strong>Asked ${who} · ${shortTime(b.offered_at)}</strong>
        <span class="offer-hint">Waiting on an answer. If you get them on the phone:</span>
        <span class="offer-actions">
          <button type="button" class="btn-said-yes" data-id="${b.id}">They said yes</button>
          <button type="button" class="btn-said-no" data-id="${b.id}">They said no</button>
        </span>
      </div>`;
  }

  return `<div class="offer-state offer-ask">
      <button type="button" class="btn-ask-captain" data-id="${b.id}">Ask ${who}</button>
      <span class="offer-hint">Nothing is promised until they say yes.</span>
    </div>`;
}

function shortTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });
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
  bookingsBody.querySelectorAll("button.msg-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      openThreads.has(id) ? openThreads.delete(id) : openThreads.add(id);
      renderBookings(window.__allBookings || []);
      if (openThreads.has(id)) {
        const card = bookingsBody.querySelector(`.thread-input[data-id="${id}"]`);
        card?.focus();
        const scroll = card?.closest(".thread-box")?.querySelector(".thread-scroll");
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
      }
    });
  });
  bookingsBody.querySelectorAll("button.thread-send").forEach((btn) => {
    const input = bookingsBody.querySelector(`.thread-input[data-id="${btn.dataset.id}"]`);
    const fire = () => {
      const text = input.value;
      input.value = "";
      sendMessage(btn.dataset.id, text, btn.closest(".booking-card"));
    };
    btn.addEventListener("click", fire);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); fire(); }
    });
  });
  bookingsBody.querySelectorAll("button.thread-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const link = `${TRIP_URL}?t=${btn.dataset.token}`;
      try {
        await navigator.clipboard.writeText(link);
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      } catch {
        // Clipboard blocked (insecure context, or permission refused) — select
        // the link instead so it can still be copied by hand.
        const code = btn.previousElementSibling;
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = "Press ⌘C";
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
  // Recording money goes through the database function, never a direct write:
  // it writes the ledger row and flips the booking together, and it's the same
  // door a payment provider will come through later.
  // Tips go through their own database function. Deliberately not through
  // record_payment: that one pays down a balance, and a tip isn't owed.
  bookingsBody.querySelectorAll("input.tip-input").forEach((inp) => {
    inp.addEventListener("input", () => inp.classList.remove("input-error"));
  });
  bookingsBody.querySelectorAll("button.btn-add-tip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".booking-card");
      const input = card.querySelector(`input.tip-input[data-id="${btn.dataset.id}"]`);
      const amount = parseFloat(input.value);
      if (!Number.isFinite(amount) || amount <= 0) {
        input.classList.add("input-error");
        input.focus();
        return;
      }
      btn.disabled = true;
      card?.classList.add("row-saving");
      const { error } = await db.rpc("record_tip", {
        p_booking: btn.dataset.id,
        p_amount_cents: Math.round(amount * 100),
        p_provider: "manual",
        p_reference: null,
      });
      card?.classList.remove("row-saving");
      if (error) {
        btn.disabled = false;
        const msg = card?.querySelector(".card-msg");
        if (msg) {
          msg.textContent = error.message;
          msg.hidden = false;
        }
        return;
      }
      loadBookings();
    });
  });
  bookingsBody.querySelectorAll("button.btn-mark-paid-booking").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".booking-card");
      const amount = Number(btn.dataset.amount);
      btn.disabled = true;
      card?.classList.add("row-saving");
      const { error } = await db.rpc("record_payment", {
        p_booking: btn.dataset.id,
        p_amount_cents: amount,
        p_provider: "manual",
        p_reference: null,
      });
      card?.classList.remove("row-saving");
      if (error) {
        btn.disabled = false;
        const msg = card?.querySelector(".card-msg");
        if (msg) {
          msg.textContent = error.message;
          msg.hidden = false;
        }
        return;
      }
      loadBookings();
    });
  });
  // Confirming is the promise to the customer, so it needs the two things the
  // confirmation actually tells them: which boat, and what it costs.
  bookingsBody.querySelectorAll("button.btn-ask-captain").forEach((btn) => {
    btn.addEventListener("click", () =>
      updateBooking(
        btn.dataset.id,
        { offered_at: new Date().toISOString() },
        btn.closest(".booking-card")
      )
    );
  });
  bookingsBody.querySelectorAll("button.btn-said-yes").forEach((btn) => {
    btn.addEventListener("click", () =>
      updateBooking(
        btn.dataset.id,
        { captain_response: "accepted", response_by: "dispatch", responded_at: new Date().toISOString() },
        btn.closest(".booking-card")
      )
    );
  });
  bookingsBody.querySelectorAll("button.btn-said-no").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reason = prompt("Why can't they take it? (optional)") ?? "";
      updateBooking(
        btn.dataset.id,
        {
          captain_response: "declined",
          response_by: "dispatch",
          responded_at: new Date().toISOString(),
          decline_reason: reason.trim() || null,
        },
        btn.closest(".booking-card")
      );
    });
  });
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
      if (b.captain_response !== "accepted") {
        return cardMessage(
          card,
          b.captain_response === "declined"
            ? "That captain turned this down — pick another boat."
            : "Ask the captain first. Nothing gets promised before a boat says yes."
        );
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
    if (patch.status || "offered_at" in patch || "captain_response" in patch) {
      renderBookings(window.__allBookings || []);
    }
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
  const lines = [`Hi ${b.contact_name || "there"}! This is Paradise Sea Express confirming your booking:`];
  lines.push(`${b.pickup || "?"} → ${b.destination || "?"}`);
  if (when) lines.push(when);
  if (b.return_at) {
    lines.push(`Back at ${new Date(b.return_at).toLocaleString(undefined, {
      hour: "numeric", minute: "2-digit",
    })}`);
  }
  if (b.boats?.name) {
    lines.push(`Boat: ${b.boats.name}${b.boats.captain_name ? ` (Capt. ${b.boats.captain_name})` : ""}`);
  }
  if (b.quoted_price_cents != null) {
    lines.push(
      b.vat_cents
        ? `Price: $${(b.total_cents / 100).toFixed(2)} ` +
          `($${(b.quoted_price_cents / 100).toFixed(2)} + $${(b.vat_cents / 100).toFixed(2)} VAT)`
        : `Price: $${(b.quoted_price_cents / 100).toFixed(2)}`
    );
  }
  lines.push("See you soon!");
  return lines.join("\n");
}

/* Where the passenger said they were standing, if they shared it.
   Dispatch sees this on any live trip, without waiting for a captain to accept
   — when a captain phones in saying he can't find anyone, the office is who
   has to answer. The captain's own view is stricter; see waitingAt() there. */
const POSITION_STALE_AFTER_MINUTES = 30;

function sharedPosition(b) {
  if (b.pickup_lat == null || b.pickup_lng == null) return null;
  if (b.status === "completed" || b.status === "cancelled") return null;

  const taken = b.located_at ? new Date(b.located_at).getTime() : NaN;
  const minutesOld = Number.isFinite(taken)
    ? Math.max(0, Math.round((Date.now() - taken) / 60000))
    : Infinity;

  return {
    lat: b.pickup_lat,
    lng: b.pickup_lng,
    minutesOld,
    stale: minutesOld >= POSITION_STALE_AFTER_MINUTES,
  };
}

function howOld(minutes) {
  if (!Number.isFinite(minutes)) return "time unknown";
  if (minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${hours} hours ago`;
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
          ${offerHtml(b)}
          <div class="fare-row">
            <label>Fare $</label>
            <input type="number" step="0.01" min="0" class="price-input" data-id="${b.id}" value="${price}" placeholder="—">
          </div>
          ${paymentHtml(b)}
          ${ratingHtml(b)}
          ${tipHtml(b)}
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
        ${b.return_at
          ? `<div class="return-leg">↩ Collect again ${esc(new Date(b.return_at).toLocaleString(undefined, {
               weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div>`
          : b.trip_type === "Round trip"
          ? `<div class="return-leg missing">↩ Round trip with no return time — check with the customer</div>`
          : ""}
        ${(() => {
          const at = sharedPosition(b);
          if (!at) return "";
          return `<a class="shared-position${at.stale ? " is-stale" : ""}"
                     href="https://www.google.com/maps/search/?api=1&query=${at.lat},${at.lng}"
                     target="_blank" rel="noopener">
            <span class="position-pin">📍</span>
            <span>
              <strong>Passenger shared where they're waiting</strong>
              <small>${howOld(at.minutesOld)}${
                at.stale ? " — old enough that they may have moved" : ""
              } · Opens the map</small>
            </span>
          </a>`;
        })()}
        ${b.notes ? `<div class="card-notes">${esc(b.notes)}</div>` : ""}
        ${(() => {
          const waiting = awaitingReply(b.id);
          const count = (threadsByBooking.get(b.id) || []).length;
          return `<button type="button" class="msg-toggle${waiting ? " has-waiting" : ""}" data-id="${b.id}">
            ✉ Messages${count ? ` (${count})` : ""}${waiting ? ` · ${waiting} waiting on you` : ""}
          </button>`;
        })()}
        ${openThreads.has(b.id) ? threadHtml(b) : ""}
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
