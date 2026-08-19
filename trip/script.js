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
  renderRating(t);
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

  // Two cases where the composer is hidden but the thread is still open, both on
  // the captain tab: the trip isn't paid for yet, or it's over and he's off it.
  // Say which instead of showing an empty panel.
  const lockNote = document.getElementById("captainLockNote");
  lockNote.hidden = !(t.can_reply && channel === "captain" && !canCaptain);
  lockNote.textContent =
    t.status === "completed"
      ? "Your captain is off this trip now. We're on the other tab if anything's outstanding — and you can still leave him a tip above."
      : "Your captain opens up here once the trip is paid for. Until then we're on the other tab and happy to help.";
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

/* How it went.

   Asked once, after the ride, and asked before the tip — a tip is a verdict, and
   this is where the verdict is made. Two scores because they are two different
   things: a good captain can have a bad boat, and dispatch has to be able to
   tell those apart. Neither is required to leave, but the tip waits on them. */
function renderRating(t) {
  const section = document.getElementById("rateSection");
  const note = document.getElementById("rateNote");
  const err = document.getElementById("rateErr");
  const send = document.getElementById("rateSend");
  const comment = document.getElementById("rateComment");
  const captain = t.captain ? `Capt. ${t.captain}` : "your captain";

  if (!t.can_rate) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  document.getElementById("rateCaptainLabel").textContent = captain;
  document.getElementById("rateRideLabel").textContent = t.boat || "The trip";

  // Their own answer wins over anything typed since, but only until they touch
  // a star — otherwise a poll two seconds later would undo what they just did.
  if (rating.captain === null) rating.captain = t.rating_captain || null;
  if (rating.ride === null) rating.ride = t.rating_ride || null;
  if (!comment.value && t.rating_note) comment.value = t.rating_note;

  note.textContent = t.rated_at
    ? "Thanks — you've rated this trip. Change it here if you like."
    : `How did ${captain} do, and how was the trip itself?`;
  drawStars("starsCaptain", "captain");
  drawStars("starsRide", "ride");

  const ready = rating.captain && rating.ride;
  send.disabled = !ready;
  send.textContent = t.rated_at ? "Update rating" : "Send rating";
  if (ready) err.hidden = true;
}

/** What they've picked so far. Null means untouched, not zero. */
const rating = { captain: null, ride: null, sending: false };

function drawStars(elementId, which) {
  const box = document.getElementById(elementId);
  const picked = rating[which] || 0;
  box.innerHTML = [1, 2, 3, 4, 5]
    .map(
      (n) => `<button type="button" class="star${n <= picked ? " on" : ""}"
                 role="radio" aria-checked="${n === picked}" data-n="${n}"
                 aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`
    )
    .join("");
  box.onclick = (e) => {
    const btn = e.target.closest("button[data-n]");
    if (!btn) return;
    rating[which] = Number(btn.dataset.n);
    if (lastTrip) renderRating(lastTrip);
  };
}

document.getElementById("rateSend").addEventListener("click", async () => {
  const err = document.getElementById("rateErr");
  const send = document.getElementById("rateSend");
  if (!rating.captain || !rating.ride || rating.sending) return;

  rating.sending = true;
  send.disabled = true;
  const { error } = await db.rpc("trip_rate", {
    p_token: token,
    p_captain: rating.captain,
    p_ride: rating.ride,
    p_note: document.getElementById("rateComment").value.trim() || null,
  });
  rating.sending = false;
  send.disabled = false;

  if (error) {
    err.textContent = /closed|between/i.test(error.message || "")
      ? error.message
      : "That didn't send. Check your connection and try again.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  await load(); // the tip card is waiting on this
});

/* Tips.

   Offered when the ride is over and the passenger has said how it went — rate
   first, tip if it was warranted. Not when the fare is paid: the fare is paid
   before anyone boards, and nobody tips a captain they haven't met yet. The
   window stays open for a week afterwards, which is the server's rule
   (`can_tip`), not this page's.

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
  // The server decides: trip completed, a boat on it, inside the week. A tip
  // already given still shows after that window closes, it just can't be topped up.
  const canTip = !!t.can_tip && !!t.captain;

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
    : `Hope the trip went well. Nothing is owed — this is extra, and all of it goes to ${captain}.`;

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
