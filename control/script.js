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
  await loadBookings();
  clearInterval(pollTimer);
  pollTimer = setInterval(loadBookings, 15000);
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
    .select("*")
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
        <select class="status-select" data-id="${b.id}">
          ${STATUSES.map((s) => `<option value="${s}" ${s === b.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}
        </select>
      </td>
      <td><input type="number" step="0.01" min="0" class="price-input" data-id="${b.id}" value="${price}" placeholder="—"></td>
    </tr>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
