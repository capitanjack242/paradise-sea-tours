/* ── Edit these with your real details ──────────────────────────── */
const CONFIG = {
  phone: "+12420000000",          // tel: dialable, no spaces
  phoneDisplay: "+1 (242) 000-0000",
  whatsapp: "12420000000",        // digits only, country code first
  email: "hello@paradiseseataxi.com",
};
/* ───────────────────────────────────────────────────────────────── */

// year
document.getElementById("year").textContent = new Date().getFullYear();

// mobile nav
const navLinks = document.getElementById("navLinks");
document.getElementById("navToggle").addEventListener("click", () =>
  navLinks.classList.toggle("open"));
navLinks.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => navLinks.classList.remove("open")));

// wire up phone / whatsapp / call links
document.querySelectorAll("[data-phone]").forEach((el) => {
  el.href = "tel:" + CONFIG.phone;
  if (el.textContent.includes("000")) el.textContent = "📞 " + CONFIG.phoneDisplay;
});
const waLink = (text) =>
  `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
document.querySelectorAll("[data-whatsapp]").forEach((el) =>
  (el.href = waLink("Hi! I'd like to book a boat taxi.")));
document.querySelectorAll("[data-call]").forEach((el) =>
  (el.href = waLink("Hi! I'd like to book a boat taxi.")));
document.querySelectorAll("[data-captain]").forEach((el) =>
  (el.href = waLink("Hi! I own a boat in Nassau and want to join the Paradise Sea Taxi network.")));

// booking form (client-side for now; phase 2 will POST to the API)
const form = document.getElementById("bookingForm");
const status = document.getElementById("formStatus");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  status.className = "form-status";
  const data = Object.fromEntries(new FormData(form).entries());

  // basic validation
  for (const k of ["name", "phone", "pickup", "destination", "date", "time"]) {
    if (!data[k]) {
      status.textContent = "Please fill in all required fields.";
      status.classList.add("err");
      return;
    }
  }

  // Build a WhatsApp message so the inquiry actually goes somewhere today.
  const msg =
    `New booking request%0A` +
    `Name: ${data.name}%0APhone: ${data.phone}%0A` +
    `Pickup: ${data.pickup}%0ADestination: ${data.destination}%0A` +
    `Date: ${data.date} ${data.time}%0AGuests: ${data.guests}%0A` +
    `Type: ${data.triptype}%0ANotes: ${data.notes || "-"}`;

  status.textContent = "Opening WhatsApp to send your request…";
  status.classList.add("ok");
  window.open(`https://wa.me/${CONFIG.whatsapp}?text=${msg}`, "_blank");
  form.reset();
});
