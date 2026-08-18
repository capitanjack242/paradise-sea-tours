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
/** Which side of the conversation is showing: the office, or the captain. */
let channel = "office";
let lastTrip = null;

function setChannel(next) {
  channel = next;
  document.querySelectorAll(".chan-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.channel === next)
  );
  lastCount = -1; // force a redraw; it's a different conversation
  if (lastTrip) render(lastTrip);
}

document.getElementById("chanTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-channel]");
  if (!btn) return;
  setChannel(btn.dataset.channel);
});

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
  lastTrip = t;
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

  const back = document.getElementById("returnLeg");
  if (t.return_at) {
    const at = new Date(t.return_at).toLocaleString(undefined, {
      weekday: "long", hour: "numeric", minute: "2-digit",
    });
    back.innerHTML = `<span class="lab">Coming back</span> Your captain collects you again at ${esc(at)}`;
    back.hidden = false;
  } else {
    back.hidden = true;
  }

  const boat = document.getElementById("boat");
  if (t.boat) {
    boat.innerHTML = `<span class="lab">Your boat</span> ${esc(t.boat)}${t.captain ? ` · Capt. ${esc(t.captain)}` : ""}`;
    boat.hidden = false;
  } else {
    boat.hidden = true;
  }

  const fare = document.getElementById("fare");
  if (t.fare_cents != null) {
    const owed = t.total_cents != null ? t.total_cents : t.fare_cents;
    fare.innerHTML =
      `<span class="lab">Total</span> $${(owed / 100).toFixed(2).replace(/\.00$/, "")}` +
      (t.vat_cents ? " <em>incl. VAT</em>" : "");
    fare.hidden = false;
  } else {
    fare.hidden = true;
  }

  renderBoatPosition(t);
  renderPayment(t);
  renderTip(t);

  // Only the channel being looked at. The office one is always available; the
  // captain's opens on payment, and until then the tab says why rather than
  // disappearing — a passenger should know the captain exists.
  const canCaptain = !!t.can_message_captain;
  const captainTab = document.getElementById("captainTab");
  captainTab.classList.toggle("locked", !canCaptain);
  captainTab.title = canCaptain ? "" : "Opens once the trip is paid for";
  // A locked tab still opens. Bouncing back to the office made the tap do
  // nothing at all, which reads as broken rather than as locked.

  const msgs = (t.messages || []).filter((m) => (m.channel || "office") === channel);
  // Only rebuild when it's actually changed, so a poll never yanks the view out
  // from under someone reading it.
  const stamp = `${channel}:${msgs.length}`;
  if (stamp !== lastCount) {
    const atBottom =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40 || lastCount === -1;
    thread.innerHTML = msgs.length
      ? msgs.map(bubble).join("")
      : channel === "captain" && !canCaptain
      ? "" // the lock note below says it; inviting them to write would contradict it
      : `<p class="empty">${
          channel === "captain"
            ? "Nothing here yet. Anything you need your captain to know — where you're standing, how much luggage — say it here."
            : "No messages yet. Ask us anything about your trip."
        }</p>`;
    if (atBottom) thread.scrollTop = thread.scrollHeight;
    lastCount = stamp;
  }

  const open = t.can_reply && (channel === "office" || canCaptain);
  composer.hidden = !open;
  closedNote.hidden = !!t.can_reply;

  // The one case the composer is hidden but the trip is live: the captain
  // channel, not yet paid for. Say so instead of showing an empty panel.
  const lockNote = document.getElementById("captainLockNote");
  lockNote.hidden = !(t.can_reply && channel === "captain" && !canCaptain);
}

/** What's owed, what's been paid, and how it gets paid. */
function renderPayment(t) {
  const section = document.getElementById("paySection");
  if (t.fare_cents == null) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const money = (c) => `$${((c || 0) / 100).toFixed(2).replace(/\.00$/, "")}`;
  const paid = t.amount_paid_cents || 0;
  // What's owed is the total, not the fare: paying the fare and leaving the tax
  // is not paying, and the captain gate reads the same figure.
  const total = t.total_cents != null ? t.total_cents : t.fare_cents;
  const due = t.balance_cents != null ? t.balance_cents : Math.max(total - paid, 0);

  document.getElementById("payFare").textContent = money(t.fare_cents);
  // A trip taken before VAT applied has no tax line rather than a $0 one.
  const hasVat = !!t.vat_cents;
  document.getElementById("payVatLine").hidden = !hasVat;
  document.getElementById("payTotalLine").hidden = !hasVat;
  if (hasVat) {
    const pct = Number(t.vat_pct);
    document.getElementById("payVatPct").textContent =
      Number.isInteger(pct) ? String(pct) : String(pct).replace(/0+$/, "");
    document.getElementById("payVat").textContent = money(t.vat_cents);
    document.getElementById("payTotal").textContent = money(total);
  }
  document.getElementById("payPaid").textContent = money(paid);
  document.getElementById("payPaidLine").hidden = paid === 0;
  document.getElementById("payDue").textContent = money(due);
  document.getElementById("payDueLine").hidden = due === 0;

  const state = document.getElementById("payState");
  const slot = document.getElementById("paySlot");

  if (t.paid_at) {
    section.classList.add("is-paid");
    state.textContent = "Paid in full. Your captain is reachable in Messages.";
    slot.innerHTML = "";
    return;
  }

  section.classList.remove("is-paid");
  const tooEarly = t.status === "requested" || t.status === "quoted";
  state.textContent = tooEarly
    ? "Nothing to pay yet — we're confirming a captain first."
    : "Payment opens up messaging with your captain.";

  if (tooEarly) {
    slot.innerHTML = "";
    return;
  }

  // The button is here before the payment provider is. Rather than let it do
  // nothing, it opens the office thread with the message already started —
  // which is how a passenger actually pays today.
  slot.innerHTML = `<button type="button" class="pay-btn" id="payBtn">Pay ${money(due)}</button>`;

  document.getElementById("payBtn").onclick = () => {
    setChannel("office");
    msgInput.value = msgInput.value || "I'd like to pay for my trip.";
    msgInput.focus();
  };
}

/* Where the boat is.

   Shown only while the captain is sharing and the fix is recent — the database
   withholds anything older than five minutes, so if this is here at all it is
   worth believing. The age is on screen regardless, because "two minutes ago"
   and "just now" mean different things to somebody watching a dock. */
function renderBoatPosition(t) {
  const box = document.getElementById("onway");
  if (t.boat_lat == null || t.boat_lng == null) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const boat = t.boat || "Your boat";
  const secs = Math.max(Math.round((Date.now() - new Date(t.boat_located_at)) / 1000), 0);
  const age =
    secs < 45 ? "just now" : `${Math.max(Math.round(secs / 60), 1)} min ago`;

  document.getElementById("onwayTitle").textContent = `${boat} is on the way`;
  document.getElementById("onwaySub").textContent = `Position updated ${age} · Tap for the map`;
  box.href = `https://www.google.com/maps/search/?api=1&query=${t.boat_lat},${t.boat_lng}`;
}

/* Tips.

   Offered once the fare is settled and there's a captain to give it to — the
   same moment Uber offers one, after the ride rather than before it. Nothing
   here is owed: the balance is already nil, and this is extra.

   The button starts a message rather than taking money, because no payment
   provider is connected yet. That's the same thing the Pay button does. When
   the link exists it takes its place and the office stops being involved. */
function renderTip(t) {
  const section = document.getElementById("tipSection");
  const given = document.getElementById("tipGiven");
  const note = document.getElementById("tipNote");
  const slot = document.getElementById("tipSlot");
  const money = (c) => `$${((c || 0) / 100).toFixed(2).replace(/\.00$/, "")}`;

  const tip = t.tip_cents || 0;
  const captain = t.captain ? `Capt. ${t.captain}` : "your captain";
  // Tipping opens when the trip is paid for and there's a named captain. A
  // finished trip still shows a tip that was given, but can't take a new one:
  // the message thread it goes through is closed by then.
  const canTip = !!t.paid_at && !!t.captain && !!t.can_reply;

  if (!tip && !canTip) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  given.hidden = !tip;
  if (tip) {
    given.innerHTML = `<strong>${money(tip)}</strong> tip for ${esc(captain)}`;
  }

  const other = document.getElementById("tipOther");
  if (!canTip) {
    note.textContent = "Every cent of it goes to the captain.";
    slot.innerHTML = "";
    other.hidden = true;
    return;
  }

  note.textContent = tip
    ? "Want to add more? Every cent goes to the captain."
    : `Nothing owed — the fare is settled. This is extra, and all of it goes to ${captain}.`;

  // Percentages of the fare, not the fare plus tax: nobody tips on tax.
  const base = t.fare_cents || 0;
  const options = [10, 15, 20]
    .map((pct) => ({ pct, cents: Math.max(Math.round((base * pct) / 100 / 100) * 100, 100) }))
    // Two percentages of a small fare can round to the same dollar.
    .filter((o, i, all) => all.findIndex((x) => x.cents === o.cents) === i);

  slot.innerHTML =
    options
      .map(
        (o) =>
          `<button type="button" class="tip-btn" data-cents="${o.cents}">${money(o.cents)}<span>${o.pct}%</span></button>`
      )
      .join("") +
    // A percentage of the fare is a suggestion, not a limit. Someone who wants
    // to give $50 on a $60 trip shouldn't have to ask the office for permission.
    `<button type="button" class="tip-btn tip-btn-other" id="tipOtherBtn">Other<span>any amount</span></button>`;

  const ask = (cents) => {
    setChannel("office");
    msgInput.value = `I'd like to add a ${money(cents)} tip for ${captain}.`;
    msgInput.focus();
  };

  slot.querySelectorAll("button.tip-btn[data-cents]").forEach((btn) => {
    btn.onclick = () => ask(Number(btn.dataset.cents));
  });

  const amount = document.getElementById("tipAmount");
  const err = document.getElementById("tipErr");
  document.getElementById("tipOtherBtn").onclick = () => {
    other.hidden = !other.hidden;
    if (!other.hidden) amount.focus();
  };
  amount.oninput = () => { err.hidden = true; };
  const submitOther = () => {
    const dollars = parseFloat(amount.value);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      err.hidden = false;
      amount.focus();
      return;
    }
    err.hidden = true;
    other.hidden = true;
    amount.value = "";
    ask(Math.round(dollars * 100));
  };
  document.getElementById("tipOtherGo").onclick = submitOther;
  amount.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitOther(); }
  };
}

function bubble(m) {
  const at = new Date(m.at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  const mine = m.sender === "customer";
  const who = mine ? "You" : m.sender === "captain" ? "Your captain" : "Paradise Sea Express";
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

  const { error } = await db.rpc("trip_send", {
    p_token: token,
    p_body: body,
    p_channel: channel,
  });
  msgInput.disabled = false;
  msgInput.focus();

  if (error) {
    msgInput.value = body; // don't lose what they wrote
    chatErr.textContent = /paid for|no captain/i.test(error.message || "")
      ? error.message
      : "That didn't send. Check your connection and try again.";
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
