/* Captain's board. One job: see the trips dispatch has given me, and mark each
   one finished when the passengers are off the boat.

   Captain accounts are created in the Supabase dashboard (Authentication →
   Users), then linked to their boat with:
     update boats set owner_id = '<user-id>' where name = '<boat name>';
   Dispatch stamps the trip with that owner when it assigns the boat, which is
   what makes it show up here. */
const SUPABASE_URL = "https://fjdoaonnoezbbitbawzs.supabase.co";
const SUPABASE_KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginView = document.getElementById("loginView");
const tripsView = document.getElementById("tripsView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const whoami = document.getElementById("whoami");
const tripsBody = document.getElementById("tripsBody");
const emptyState = document.getElementById("emptyState");

let currentTab = "today";
let realtimeChannel = null;
let pollTimer = null;
let refreshTimer = null;

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
  await db.auth.signOut();
});

document.getElementById("refreshBtn").addEventListener("click", () => loadTrips());

db.auth.onAuthStateChange((_event, session) => {
  if (session) showTrips(session);
  else showLogin();
});

db.auth.getSession().then(({ data }) => {
  if (data.session) showTrips(data.session);
  else showLogin();
});

function showLogin() {
  teardownLiveUpdates();
  loginView.style.display = "";
  tripsView.style.display = "none";
}

async function showTrips(session) {
  loginView.style.display = "none";
  tripsView.style.display = "";
  whoami.textContent = session.user.email;
  await loadTrips();
  startLiveUpdates();
}

// ── live updates ─────────────────────────────────────────────────────────
// A captain wants a new job to appear without thinking about it, so the same
// realtime channel dispatch uses feeds this board too.
function startLiveUpdates() {
  teardownLiveUpdates();
  realtimeChannel = db
    .channel("captain-bookings")
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => loadTrips(), 400);
    })
    .subscribe((status) => setLiveStatus(status === "SUBSCRIBED" ? "live" : "polling"));
  pollTimer = setInterval(() => loadTrips(), 60000);
}

function teardownLiveUpdates() {
  clearInterval(pollTimer);
  clearTimeout(refreshTimer);
  pollTimer = refreshTimer = null;
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  setLiveStatus("off");
}

function setLiveStatus(state) {
  const el = document.getElementById("liveStatus");
  el.className = "live-status " + state;
  el.textContent = state === "live" ? "● Live" : state === "polling" ? "● Reconnecting" : "";
}

// ── tabs ─────────────────────────────────────────────────────────────────
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  currentTab = btn.dataset.tab;
  document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.toggle("active", t === btn));
  renderTrips(window.__trips || []);
});

// ── data ─────────────────────────────────────────────────────────────────
async function loadTrips() {
  // Row-level security limits this to trips assigned to the signed-in captain,
  // so there's no filter here to get wrong.
  const { data, error } = await db
    .from("bookings")
    .select("*, boats(name)")
    .order("scheduled_at", { ascending: true });
  if (error) {
    console.error("load trips failed:", error);
    return;
  }
  window.__trips = data;
  renderTrips(data);
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function matchesTab(b) {
  if (currentTab === "done") return b.status === "completed";
  if (b.status === "completed" || b.status === "cancelled") return false;
  // Anything still open and dated today — including one that ran late — is the
  // job in front of you. Everything else open is "coming up".
  const today = isToday(b.scheduled_at) || (b.scheduled_at && new Date(b.scheduled_at) < new Date());
  return currentTab === "today" ? today : !today;
}

function renderTrips(all) {
  const rows = all.filter(matchesTab);
  tripsBody.innerHTML = rows.map(tripHtml).join("");
  emptyState.style.display = rows.length ? "none" : "block";
  emptyState.textContent =
    currentTab === "done" ? "No finished trips yet." :
    currentTab === "today" ? "Nothing on today. Dispatch will send jobs here." :
    "Nothing booked ahead yet.";

  tripsBody.querySelectorAll("button.btn-done").forEach((btn) => {
    btn.addEventListener("click", () => confirmDone(btn));
  });
  tripsBody.querySelectorAll("button.btn-undo").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".trip");
      card.querySelector(".confirm-row").hidden = true;
      card.querySelector(".btn-done").hidden = false;
    });
  });
  tripsBody.querySelectorAll("button.btn-really-done").forEach((btn) => {
    btn.addEventListener("click", () => markFinished(btn.dataset.id, btn.closest(".trip")));
  });
}

/* Two taps, because a phone in a pocket on a boat presses things by itself and
   a captain has no way to undo a trip marked finished. */
function confirmDone(btn) {
  const card = btn.closest(".trip");
  btn.hidden = true;
  card.querySelector(".confirm-row").hidden = false;
}

async function markFinished(id, card) {
  card.classList.add("saving");
  const { error } = await db.from("bookings").update({ status: "completed" }).eq("id", id);
  card.classList.remove("saving");
  if (error) {
    const msg = card.querySelector(".trip-msg");
    msg.textContent = "Couldn't save that — check your signal and try again.";
    msg.hidden = false;
    return;
  }
  const b = (window.__trips || []).find((x) => x.id === id);
  if (b) b.status = "completed";
  renderTrips(window.__trips || []);
}

// ── rendering ────────────────────────────────────────────────────────────
function tripHtml(b) {
  const when = b.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "No time given";
  const fare = b.quoted_price_cents != null ? `$${(b.quoted_price_cents / 100).toFixed(2).replace(/\.00$/, "")}` : "—";
  const done = b.status === "completed";
  const waiting = b.status !== "confirmed" && b.status !== "in_progress" && !done;

  return `
    <article class="trip${done ? " is-done" : ""}">
      <div class="trip-when">${when}</div>
      <div class="trip-route">${esc(b.pickup || "—")} <span class="arrow">→</span> ${esc(b.destination || "—")}</div>
      <div class="trip-meta">${b.passengers ?? "?"} passengers · ${esc(b.trip_type || "")} · ${fare}</div>
      ${b.notes ? `<div class="trip-notes">${esc(b.notes)}</div>` : ""}

      <div class="trip-pax">
        <span class="pax-name">${esc(b.contact_name || "Passenger")}</span>
        ${b.contact_phone ? `<a class="call" href="tel:${esc(b.contact_phone)}">📞 Call</a>` : ""}
      </div>

      <p class="trip-msg" hidden></p>

      ${done
        ? `<div class="done-banner">✓ Finished</div>`
        : waiting
        ? `<div class="waiting-banner">Not confirmed by the office yet</div>`
        : `<button type="button" class="btn-done" data-id="${b.id}">Passengers dropped off</button>
           <div class="confirm-row" hidden>
             <span class="confirm-q">Trip finished?</span>
             <button type="button" class="btn-undo">No</button>
             <button type="button" class="btn-really-done" data-id="${b.id}">Yes, finished</button>
           </div>`}
    </article>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
