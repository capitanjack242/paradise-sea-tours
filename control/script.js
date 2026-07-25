/* Staff accounts are created in the Supabase dashboard (Authentication → Users),
   then promoted to admin with:
     update profiles set role = 'admin' where id = '<user-id>';
   run once in the SQL Editor. No public sign-up exists on this page. */
const SUPABASE_URL = "https://fjdoaonnoezbbitbawzs.supabase.co";
const SUPABASE_KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STATUSES = [
  "requested", "quoted", "confirmed", "assigned",
  "in_progress", "completed", "cancelled",
];

const loginView = document.getElementById("loginView");
const dashView = document.getElementById("dashView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const whoami = document.getElementById("whoami");
const bookingsBody = document.getElementById("bookingsBody");
const emptyState = document.getElementById("emptyState");
const countInfo = document.getElementById("countInfo");

let currentFilter = "active";
let pollTimer = null;
let boatsList = []; // active boats available to assign, loaded once per session

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
  clearInterval(pollTimer);
  await db.auth.signOut();
});

db.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showDashboard(session);
  } else {
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
  clearInterval(pollTimer);
  pollTimer = setInterval(loadBookings, 15000);
}

async function loadBoats() {
  const { data, error } = await db
    .from("boats")
    .select("id, name, captain_name, captain_whatsapp")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error("load boats failed:", error);
    return;
  }
  boatsList = data;
}

// ── filters ──────────────────────────────────────────────────────────────
document.getElementById("filterTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  renderBookings(window.__allBookings || []);
});
document.getElementById("refreshBtn").addEventListener("click", loadBookings);

// ── data ─────────────────────────────────────────────────────────────────
async function loadBookings() {
  const { data, error } = await db
    .from("bookings")
    .select("*, boats(name, captain_name, captain_whatsapp)")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("load bookings failed:", error);
    return;
  }
  window.__allBookings = data;
  renderBookings(data);
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
  bookingsBody.innerHTML = rows.map(rowHtml).join("");

  bookingsBody.querySelectorAll("select.status-select").forEach((sel) => {
    sel.classList.add("st-" + sel.value);
    sel.addEventListener("change", () => updateBooking(sel.dataset.id, { status: sel.value }, sel.closest("tr")));
  });
  bookingsBody.querySelectorAll("input.price-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      const dollars = parseFloat(inp.value);
      const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
      updateBooking(inp.dataset.id, { quoted_price_cents: cents }, inp.closest("tr"));
    });
  });
  bookingsBody.querySelectorAll("select.boat-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const boatId = sel.value || null;
      await updateBooking(sel.dataset.id, { assigned_boat_id: boatId }, sel.closest("tr"));
      const b = (window.__allBookings || []).find((x) => x.id === sel.dataset.id);
      if (b) {
        b.boats = boatId ? boatsList.find((x) => x.id === boatId) || null : null;
        renderBookings(window.__allBookings);
      }
    });
  });
  bookingsBody.querySelectorAll("button.btn-cancel-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tr = btn.closest("tr");
      const reason = tr.querySelector("input.cancel-reason").value.trim() || null;
      updateBooking(btn.dataset.id, { status: "cancelled", cancellation_reason: reason }, tr);
    });
  });
  bookingsBody.querySelectorAll("button.btn-complete-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateBooking(btn.dataset.id, { status: "completed" }, btn.closest("tr"));
    });
  });
}

async function updateBooking(id, patch, rowEl) {
  rowEl?.classList.add("row-saving");
  const { error } = await db.from("bookings").update(patch).eq("id", id);
  rowEl?.classList.remove("row-saving");
  if (error) {
    alert("Update failed: " + error.message);
    loadBookings();
  } else {
    const b = (window.__allBookings || []).find((x) => x.id === id);
    if (b) Object.assign(b, patch);
  }
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

function rowHtml(b) {
  const when = b.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "—";
  const received = new Date(b.created_at).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const price = b.quoted_price_cents != null ? (b.quoted_price_cents / 100).toFixed(2) : "";

  return `
    <tr>
      <td>${received}</td>
      <td>
        <div class="contact-name">${esc(b.contact_name || "—")}</div>
        <div class="contact-phone">${esc(b.contact_phone || "")}</div>
        ${b.contact_phone
          ? `<div class="assign-whatsapp"><a href="https://wa.me/${b.contact_phone.replace(/\D/g, "")}?text=${encodeURIComponent(customerConfirmMessage(b))}" target="_blank" rel="noopener">💬 Message customer</a></div>`
          : ""}
      </td>
      <td>
        <div class="trip">
          <span>${esc(b.pickup || "—")}</span>
          <span class="arrow">↓ ${esc(b.destination || "—")}</span>
        </div>
      </td>
      <td>${when}</td>
      <td>${b.passengers ?? ""}</td>
      <td>${esc(b.trip_type || "")}</td>
      <td class="notes">${esc(b.notes || "")}</td>
      <td>
        <select class="boat-select" data-id="${b.id}">
          <option value="">— Unassigned —</option>
          ${boatsList.map((boat) =>
            `<option value="${boat.id}" ${boat.id === b.assigned_boat_id ? "selected" : ""}>${esc(boat.name)} — Capt. ${esc(boat.captain_name || "?")}</option>`
          ).join("")}
        </select>
        ${b.boats?.captain_whatsapp
          ? `<div class="assign-whatsapp"><a href="https://wa.me/${b.boats.captain_whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener">💬 ${esc(b.boats.captain_name || "")}</a></div>`
          : ""}
      </td>
      <td>
        <select class="status-select" data-id="${b.id}">
          ${STATUSES.map((s) => `<option value="${s}" ${s === b.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}
        </select>
        ${b.status === "cancelled" && b.cancellation_reason
          ? `<div class="cancel-reason-shown">Reason: ${esc(b.cancellation_reason)}</div>`
          : ""}
      </td>
      <td><input type="number" step="0.01" min="0" class="price-input" data-id="${b.id}" value="${price}" placeholder="—"></td>
      <td class="actions-cell">
        <div class="action-row">
          <input type="text" class="cancel-reason" placeholder="Cancel reason (optional)">
          <button type="button" class="btn-cancel-row" data-id="${b.id}">Cancel</button>
        </div>
        <button type="button" class="btn-complete-row" data-id="${b.id}">✓ Complete</button>
      </td>
    </tr>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
