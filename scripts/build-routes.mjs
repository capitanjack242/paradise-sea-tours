// One page per stop, from the live price list: /boat-to/<stop>/.
//
//   node scripts/build-routes.mjs <site dir>
//
// Run by build-site.sh after the site is assembled. Each page lists every
// published fare to and from its stop, so search engines and visitors find
// "boat to Pearl Island" on a page about Pearl Island. Prices are written into
// the HTML (so they read without scripts) and refreshed from the database on
// load by /routes.js, so a fare changed in the database shows straight away.
//
// The price list is read from the public API with the publishable key. If that
// read fails during a build, the last good copy (routes-snapshot.json, next to
// this file) is used instead, so a network blip never breaks the deploy. A
// successful read refreshes that copy.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, "routes-snapshot.json");
const SITE = process.argv[2] || "_site";
const V = process.argv[3] || ""; // build stamp, so browsers never keep an old stylesheet
const ORIGIN = "https://paradiseseaexpress.com";
const API = "https://fjdoaonnoezbbitbawzs.supabase.co/rest/v1";
const KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP"; // public, as on the website
const PORT = "Nassau Cruise Port";

/** Same rule as web/script.js and web/routes.js — change one, change all three. */
export const slug = (name) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['\u2019]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dollars = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

async function get(path) {
  const res = await fetch(`${API}/${path}`, { headers: { apikey: KEY } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  try {
    const [docks, routes] = await Promise.all([
      get("docks?select=name,can_pickup&order=sort"),
      get("services?select=from_point,to_point,price_cents,round_trip_cents&category=eq.route&is_active=eq.true&order=sort"),
    ]);
    if (!docks.length || !routes.length) throw new Error("empty price list");
    writeFileSync(SNAPSHOT, JSON.stringify({ docks, routes }, null, 1) + "\n");
    return { docks, routes, live: true };
  } catch (e) {
    console.warn(`price list unreachable (${e.message}); using the last snapshot`);
    return { ...JSON.parse(readFileSync(SNAPSHOT, "utf8")), live: false };
  }
}

function page(stop, docks, routes) {
  const name = stop.name;
  const fares = routes
    .filter((r) => r.from_point === name || r.to_point === name)
    .map((r) => ({ other: r.from_point === name ? r.to_point : r.from_point, ...r }))
    // The Cruise Port first (it is where most visitors start), then cheapest first.
    .sort((a, b) => (b.other === PORT) - (a.other === PORT) || a.price_cents - b.price_cents);
  const fromPort = fares.find((f) => f.other === PORT);
  const isPort = name === PORT;
  const dropOff = stop.can_pickup === false;
  const others = docks.filter((d) => d.name !== name);
  const cheapest = fares.length ? Math.min(...fares.map((f) => f.price_cents)) : null;

  const h1 = isPort ? `Boat rides from ${name}` : `Boat to ${name}`;
  const title = isPort
    ? `Boat rides from Nassau Cruise Port, fixed fares | Paradise Sea Express`
    : `Boat to ${name} from Nassau, fixed fares | Paradise Sea Express`;
  const lead = isPort
    ? `Fixed per-person fares from the Cruise Port to ${fares.length} stops around Nassau, from $${dollars(cheapest)}, before 10% VAT.`
    : fromPort
    ? `$${dollars(fromPort.price_cents)} per person one way from Nassau Cruise Port, $${dollars(fromPort.round_trip_cents ?? fromPort.price_cents * 2)} round trip, before 10% VAT.`
    : `Fixed per-person fares to ${name} from ${fares.length} stops around Nassau, before 10% VAT.`;
  const description = `${isPort ? "Book a boat from Nassau Cruise Port" : `Book a boat to ${name} in Nassau, Bahamas`}: ${lead} A local captain confirms before you pay.`;
  const book = isPort ? "/?from=" + encodeURIComponent(PORT) + "#book" : "/?to=" + encodeURIComponent(name) + "#book";

  const rows = fares.map((f) => `
          <tr><td><a href="/boat-to/${slug(f.other)}/">${esc(f.other)}</a></td>
            <td data-from="${esc(f.from_point)}" data-to="${esc(f.to_point)}" data-kind="one">$${dollars(f.price_cents)}</td>
            <td data-from="${esc(f.from_point)}" data-to="${esc(f.to_point)}" data-kind="round">$${dollars(f.round_trip_cents ?? f.price_cents * 2)}</td></tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ORIGIN}/boat-to/${slug(name)}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(h1)} — Paradise Sea Express">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${ORIGIN}/boat-to/${slug(name)}/">
<meta property="og:image" content="${ORIGIN}/images/conch-pearl.jpg">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9B%B5%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css${V ? `?v=${V}` : ""}">
</head>
<body>
<header class="nav">
  <div class="container nav-inner">
    <a href="/" class="brand"><span class="brand-mark">⛵</span><span class="brand-text">Paradise<strong>Sea Express</strong></span></a>
    <nav class="nav-links"><a href="/#pricing">All fares</a><a href="${book}" class="btn btn-sm btn-primary">Book a ride</a></nav>
  </div>
</header>

<main class="section route-page">
  <div class="container">
    <p class="eyebrow"><a href="/">Paradise Sea Express</a> · Nassau, The Bahamas</p>
    <h1 class="section-title">${esc(h1)}</h1>
    <p class="section-sub">${esc(lead)} Book online and a local captain confirms before you pay.</p>
    ${dropOff ? `<p class="route-note">${esc(name)} is a drop-off stop: your boat takes you there, and on a round trip brings you back.</p>` : ""}
    <p><a href="${book}" class="btn btn-primary btn-lg">Book a boat${isPort ? "" : ` to ${esc(name)}`}</a></p>

    <div class="fares-wrap">
      <table class="fares-table">
        <caption>${isPort ? "From Nassau Cruise Port" : `Between ${esc(name)} and every stop`} · per person, before VAT</caption>
        <thead><tr><th>${isPort ? "To" : dropOff ? "From" : "To or from"}</th><th>One way</th><th>Round trip</th></tr></thead>
        <tbody>${rows}
        </tbody>
      </table>
    </div>
    <p class="fineprint">10% Bahamas VAT is added at checkout. You pay by card once a captain has confirmed your trip, never before.</p>

    <h2 class="route-others-title">Other stops</h2>
    <p class="route-others">${others.map((d) => `<a href="/boat-to/${slug(d.name)}/">${esc(d.name)}</a>`).join(" · ")}</p>
  </div>
</main>

<footer class="footer">
  <div class="container copyright">
    <span>© ${new Date().getFullYear()} Paradise Sea Express · <a href="mailto:hello@paradiseseaexpress.com">hello@paradiseseaexpress.com</a></span>
  </div>
</footer>
<script src="/routes.js${V ? `?v=${V}` : ""}" defer></script>
</body>
</html>
`;
}

const { docks, routes, live } = await load();
for (const stop of docks) {
  const dir = join(SITE, "boat-to", slug(stop.name));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(stop, docks, routes));
}

const urls = ["/", ...docks.map((d) => `/boat-to/${slug(d.name)}/`)];
writeFileSync(join(SITE, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc><changefreq>weekly</changefreq></url>`).join("\n") +
  `\n</urlset>\n`);

console.log(`${docks.length} stop pages from ${routes.length} fares (${live ? "live price list" : "snapshot"})`);
