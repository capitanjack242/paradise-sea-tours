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
const availRow = document.getElementById("availRow");
const availSub = document.getElementById("availSub");
const availToggle = document.getElementById("availToggle");
const emptyState = document.getElementById("emptyState");

let currentTab = "today";
let myBoat = null;
let threads = new Map();          // booking id -> messages
const openThreads = new Set();    // trips whose thread is showing
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
  await Promise.all([loadMyBoat(session), loadTrips()]);
  startLiveUpdates();
}

/* ── availability ──────────────────────────────────────────────────────────
   Whether dispatch may offer this captain work today — not whether he's out on
   the water, which is a different thing and the run itself already says. */
async function loadMyBoat(session) {
  // Filtered by owner explicitly: an admin signing in here can read every boat,
  // and "your availability" has to mean one boat, not all of them.
  const { data, error } = await db
    .from("boats")
    .select("id, name, capacity, is_available, availability_changed_at")
    .eq("owner_id", session.user.id)
    .limit(1);
  if (error) {
    console.error("load boat failed:", error);
    return;
  }
  myBoat = data?.[0] ?? null;
  renderAvailability();
}

function renderAvailability() {
  if (!myBoat) {
    availRow.hidden = true; // an admin, or a login not yet tied to a boat
    return;
  }
  availRow.hidden = false;
  const on = !!myBoat.is_available;
  availToggle.setAttribute("aria-checked", String(on));
  availRow.classList.toggle("is-on", on);

  const since = myBoat.availability_changed_at
    ? new Date(myBoat.availability_changed_at).toLocaleString(undefined, {
        weekday: "short", hour: "numeric", minute: "2-digit",
      })
    : null;
  // Say the 10pm rule out loud, so being switched off overnight isn't a
  // mystery the next morning.
  availSub.textContent = on
    ? `${myBoat.name} · available${since ? ` since ${since}` : ""} · off at 10pm`
    : `${myBoat.name} · dispatch won't offer you runs`;
}

availToggle.addEventListener("click", async () => {
  if (!myBoat) return;
  const next = !myBoat.is_available;
  availToggle.disabled = true;
  const { error } = await db.from("boats").update({ is_available: next }).eq("id", myBoat.id);
  availToggle.disabled = false;
  if (error) {
    availSub.textContent = "Couldn't save that — check your signal and try again.";
    return;
  }
  myBoat.is_available = next;
  myBoat.availability_changed_at = new Date().toISOString();
  renderAvailability();
});

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
  await loadMessages();
  renderTrips(data);
}

/* Messages are how a captain and a passenger find each other — nobody is given
   a phone number, so this is the whole channel. */
async function loadMessages() {
  const { data, error } = await db
    .from("messages")
    .select("id, booking_id, sender, body, created_at")
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
  threads = byBooking;
}

/** Passenger messages sitting since anyone last answered. */
function awaitingReply(id) {
  const t = threads.get(id) || [];
  let n = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i].sender === "customer") n++; else break;
  }
  return n;
}

async function sendMessage(id, body, card) {
  const text = (body || "").trim();
  if (!text) return;
  card?.classList.add("saving");
  const { error } = await db.from("messages").insert({ booking_id: id, sender: "captain", body: text });
  card?.classList.remove("saving");
  if (error) {
    const msg = card.querySelector(".trip-msg");
    msg.textContent = "Message didn't send — check your signal and try again.";
    msg.hidden = false;
    return;
  }
  await loadMessages();
  renderTrips(window.__trips || []);
}

function threadHtml(b) {
  const t = threads.get(b.id) || [];
  const bubbles = t.length
    ? t.map((m) => {
        const at = new Date(m.created_at).toLocaleString(undefined, {
          hour: "numeric", minute: "2-digit",
        });
        const who = m.sender === "customer" ? esc(b.contact_name || "Passenger")
                  : m.sender === "dispatch" ? "Office" : "You";
        return `<div class="bub bub-${esc(m.sender)}">
                  <div class="bub-who">${who} · ${at}</div>
                  <div class="bub-body">${esc(m.body)}</div>
                </div>`;
      }).join("")
    : `<p class="thread-empty">Nothing said yet.</p>`;

  const closed = b.status === "completed" || b.status === "cancelled";
  return `
    <div class="thread-box">
      <div class="thread-scroll">${bubbles}</div>
      ${closed
        ? `<p class="thread-empty">This trip is finished — the thread is closed.</p>`
        : `<div class="quicks">
             ${["On my way", "At the dock", "Running 10 min late"]
               .map((q) => `<button type="button" class="quick" data-id="${b.id}" data-text="${esc(q)}">${esc(q)}</button>`)
               .join("")}
           </div>
           <div class="thread-compose">
             <input type="text" class="thread-input" data-id="${b.id}"
                    placeholder="Message ${esc(b.contact_name || "passenger")}…" maxlength="2000">
             <button type="button" class="thread-send" data-id="${b.id}">Send</button>
           </div>`}
    </div>`;
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

  tripsBody.querySelectorAll("button.msg-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      openThreads.has(id) ? openThreads.delete(id) : openThreads.add(id);
      renderTrips(window.__trips || []);
      const box = tripsBody.querySelector(`.trip .thread-scroll`);
      if (box) box.scrollTop = box.scrollHeight;
    });
  });
  tripsBody.querySelectorAll("button.thread-send").forEach((btn) => {
    const input = tripsBody.querySelector(`.thread-input[data-id="${btn.dataset.id}"]`);
    const fire = () => { const v = input.value; input.value = ""; sendMessage(btn.dataset.id, v, btn.closest(".trip")); };
    btn.addEventListener("click", fire);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fire(); } });
  });
  tripsBody.querySelectorAll("button.quick").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.id, btn.dataset.text, btn.closest(".trip")));
  });
  tripsBody.querySelectorAll("button.btn-accept").forEach((btn) => {
    btn.addEventListener("click", () =>
      answerOffer(btn.dataset.id, "accepted", null, btn.closest(".trip"))
    );
  });
  tripsBody.querySelectorAll("button.btn-decline").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reason = prompt("Anything the office should know? (optional)") ?? "";
      answerOffer(btn.dataset.id, "declined", reason.trim() || null, btn.closest(".trip"));
    });
  });
  tripsBody.querySelectorAll("button.btn-aboard").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(btn.dataset.id, "in_progress", btn.closest(".trip")));
  });
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
    btn.addEventListener("click", () => setStatus(btn.dataset.id, "completed", btn.closest(".trip")));
  });
}

/* Two taps, because a phone in a pocket on a boat presses things by itself and
   a captain has no way to undo a trip marked finished. */
function confirmDone(btn) {
  const card = btn.closest(".trip");
  btn.hidden = true;
  card.querySelector(".confirm-row").hidden = false;
}

async function answerOffer(id, answer, reason, card) {
  card.classList.add("saving");
  const { error } = await db
    .from("bookings")
    .update({
      captain_response: answer,
      response_by: "captain",
      responded_at: new Date().toISOString(),
      decline_reason: reason,
    })
    .eq("id", id);
  card.classList.remove("saving");
  if (error) {
    const msg = card.querySelector(".trip-msg");
    msg.textContent = "That didn't save — check your signal and try again.";
    msg.hidden = false;
    return;
  }
  await loadTrips();
}

async function setStatus(id, status, card) {
  card.classList.add("saving");
  const { error } = await db.from("bookings").update({ status }).eq("id", id);
  card.classList.remove("saving");
  if (error) {
    const msg = card.querySelector(".trip-msg");
    msg.textContent = "Couldn't save that — check your signal and try again.";
    msg.hidden = false;
    return;
  }
  const b = (window.__trips || []).find((x) => x.id === id);
  if (b) b.status = status;
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
  const aboard = b.status === "in_progress";
  // Being asked comes before everything else: until he answers, there is no
  // job, only a question.
  const beingAsked = !!b.offered_at && !b.captain_response && !done;
  const declined = b.captain_response === "declined" && !done;
  const waiting = b.status !== "confirmed" && !aboard && !done && !beingAsked && !declined;

  return `
    <article class="trip${done ? " is-done" : ""}${aboard ? " is-aboard" : ""}">
      <div class="trip-when">${when}${aboard ? ` <span class="aboard-tag">• Aboard</span>` : ""}</div>
      <div class="trip-route">${esc(b.pickup || "—")} <span class="arrow">→</span> ${esc(b.destination || "—")}</div>
      <div class="trip-meta">${b.passengers ?? "?"} passengers · ${esc(b.trip_type || "")} · ${fare}</div>
      ${b.return_at
        ? `<div class="return-leg">↩ Collect them again at ${esc(new Date(b.return_at).toLocaleString(undefined, {
             weekday: "short", hour: "numeric", minute: "2-digit" }))}</div>`
        : b.trip_type === "Round trip"
        ? `<div class="return-leg missing">↩ Round trip — no return time given, check with the office</div>`
        : ""}
      ${b.notes ? `<div class="trip-notes">${esc(b.notes)}</div>` : ""}

      <div class="trip-pax">
        <span class="pax-name">${esc(b.contact_name || "Passenger")}</span>
        ${(() => {
          const waiting = awaitingReply(b.id);
          const count = (threads.get(b.id) || []).length;
          return `<button type="button" class="msg-toggle${waiting ? " has-waiting" : ""}" data-id="${b.id}">
            ✉ ${waiting ? `${waiting} new` : count ? "Messages" : "Message"}
          </button>`;
        })()}
      </div>
      ${openThreads.has(b.id) ? threadHtml(b) : ""}

      <p class="trip-msg" hidden></p>

      ${done
        ? `<div class="done-banner">✓ Finished</div>`
        : beingAsked
        ? `<div class="ask-box">
             <div class="ask-q">Can you take this one?</div>
             <div class="ask-sub">Nobody's been promised a boat yet — the office is waiting on you.</div>
             <button type="button" class="btn-accept" data-id="${b.id}">Yes, I'll take it</button>
             <button type="button" class="btn-decline" data-id="${b.id}">Can't take this one</button>
           </div>`
        : declined
        ? `<div class="waiting-banner">You turned this one down${b.decline_reason ? ` — ${esc(b.decline_reason)}` : ""}</div>`
        : waiting
        ? `<div class="waiting-banner">Not confirmed by the office yet</div>`
        : aboard
        ? `<button type="button" class="btn-done" data-id="${b.id}">Passengers dropped off</button>
           <div class="confirm-row" hidden>
             <span class="confirm-q">Everyone off the boat?</span>
             <button type="button" class="btn-undo">Not yet</button>
             <button type="button" class="btn-really-done" data-id="${b.id}">Yes, finished</button>
           </div>`
        : `<button type="button" class="btn-aboard" data-id="${b.id}">Passengers aboard</button>`}
    </article>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
