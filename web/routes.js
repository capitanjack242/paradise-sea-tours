/* Stop pages (/boat-to/…/): refresh the printed fares from the live price
   list. The numbers in the HTML are the price list as it stood when the site
   was built; this swaps in today's, so a fare changed in the database shows
   at once. If the read fails, the printed numbers stay. */
(async () => {
  const API = "https://fjdoaonnoezbbitbawzs.supabase.co/rest/v1";
  const KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP";
  try {
    const res = await fetch(
      `${API}/services?select=from_point,to_point,price_cents,round_trip_cents&category=eq.route&is_active=eq.true`,
      { headers: { apikey: KEY } }
    );
    if (!res.ok) return;
    const routes = await res.json();
    const key = (a, b) => `${a}\u0000${b}`;
    const byPair = new Map(routes.map((r) => [key(r.from_point, r.to_point), r]));
    const whole = (c) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
    document.querySelectorAll("td[data-from][data-to][data-kind]").forEach((td) => {
      const r = byPair.get(key(td.dataset.from, td.dataset.to));
      if (!r) return;
      const cents = td.dataset.kind === "round" ? r.round_trip_cents ?? r.price_cents * 2 : r.price_cents;
      td.textContent = `$${whole(cents)}`;
    });
  } catch {
    /* keep the printed fares */
  }
})();
