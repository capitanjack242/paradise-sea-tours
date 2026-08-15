/* The passenger's view of their own trip.

   No account, no login. The token in the link is the whole key, and it opens
   exactly one booking through two database functions — the messages table
   itself is closed to this page entirely. Nothing here can read another trip,
   because nothing here queries a table. */
const SUPABASE_URL = "https://fjdoaonnoezbbitbawzs.supabase.co";
const SUPABASE_KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const token = new URLSearchParams(location.search).get("t");

const loading = document.getElementById("loading");
const notFound = document.getElementById("notFound");
const tripView = document.getElementById("tripView");
const thread = document.getElementById("thread");
const composer = document.getElementById("composer");
const closedNote = document.getElementById("closedNote");
const chatErr = document.getElementById("chatErr");
const msgInput = document.getElementById("msgInput");

let lastCount = -1;
let pollTimer = null;

const STATUS_TEXT = {
  requested: ["We've got your request", "We're finding you a boat — we'll confirm here shortly."],
  quoted: ["We've got your request", "We're finding you a boat — we'll confirm here shortly."],
  confirmed: ["Your boat is confirmed", null],
  assigned: ["Your boat is confirmed", null],
  in_progress: ["You're on your way", null],
  completed: ["Trip finished", "Thanks for coming out with us."],
  cancelled: ["This trip was cancelled", "If that's not right, message us below."],
};

async function load() {
  if (!token) return showNotFound();

  const { data, error } = await db.rpc("trip_thread", { p_token: token });
  if (error) {
    console.error(error);
    return showNotFound();
  }
  if (!data) return showNotFound();

  loading.hidden = true;
  notFound.hidden = true;
  tripView.hidden = false;
  render(data);
}

function showNotFound() {
  loading.hidden = true;
  tripView.hidden = true;
  notFound.hidden = false;
  clearInterval(pollTimer);
}

function render(t) {
  const [headline, sub] = STATUS_TEXT[t.status] || ["Your trip", null];
  const banner = document.getElementById("statusBanner");
  banner.className = "status s-" + t.status;
  banner.innerHTML = `<strong>${esc(headline)}</strong>${sub ? `<span>${esc(sub)}</span>` : ""}`;
  banner.hidden = false;

  document.getElementById("route").innerHTML =
    `${esc(t.pickup || "—")} <span class="arw">→</span> ${esc(t.destination || "—")}`;

  const when = t.scheduled_at
    ? new Date(t.scheduled_at).toLocaleString(undefined, {
        weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "Time to be confirmed";
  document.getElementById("meta").textContent =
    `${when} · ${t.passengers ?? "?"} ${t.passengers === 1 ? "passenger" : "passengers"}${t.trip_type ? ` · ${t.trip_type}` : ""}`;

  const boat = document.getElementById("boat");
  if (t.boat) {
    boat.innerHTML = `<span class="lab">Your boat</span> ${esc(t.boat)}${t.captain ? ` · Capt. ${esc(t.captain)}` : ""}`;
    boat.hidden = false;
  } else {
    boat.hidden = true;
  }

  const fare = document.getElementById("fare");
  if (t.fare_cents != null) {
    fare.innerHTML = `<span class="lab">Fare</span> $${(t.fare_cents / 100).toFixed(2).replace(/\.00$/, "")}`;
    fare.hidden = false;
  } else {
    fare.hidden = true;
  }

  // Only rebuild the thread when it's actually changed, so a poll never yanks
  // the view out from under someone reading it.
  const msgs = t.messages || [];
  if (msgs.length !== lastCount) {
    const atBottom =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40 || lastCount === -1;
    thread.innerHTML = msgs.length
      ? msgs.map(bubble).join("")
      : `<p class="empty">No messages yet. Anything you need to tell your captain, say it here.</p>`;
    if (atBottom) thread.scrollTop = thread.scrollHeight;
    lastCount = msgs.length;
  }

  composer.hidden = !t.can_reply;
  closedNote.hidden = !!t.can_reply;
}

function bubble(m) {
  const at = new Date(m.at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  const mine = m.sender === "customer";
  const who = mine ? "You" : m.sender === "captain" ? "Your captain" : "Paradise Sea Tours";
  return `<div class="bub ${mine ? "mine" : "theirs"}">
            <div class="who">${who} · ${at}</div>
            <div class="body">${esc(m.body)}</div>
          </div>`;
}

async function send() {
  const body = msgInput.value.trim();
  if (!body) return;
  chatErr.hidden = true;
  msgInput.value = "";
  msgInput.disabled = true;

  const { error } = await db.rpc("trip_send", { p_token: token, p_body: body });
  msgInput.disabled = false;
  msgInput.focus();

  if (error) {
    msgInput.value = body; // don't lose what they wrote
    chatErr.textContent = "That didn't send. Check your connection and try again.";
    chatErr.hidden = false;
    return;
  }
  await load();
}

document.getElementById("sendBtn").addEventListener("click", send);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); send(); }
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

load();
// This page reads through a function, not a table, so realtime can't reach it —
// a slow poll keeps a reply appearing without anyone refreshing.
pollTimer = setInterval(load, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
