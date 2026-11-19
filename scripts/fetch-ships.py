#!/usr/bin/env python3
"""Write web/data/ships.json: the cruise ships calling at Nassau on each of the next 45
days, with arrival and sailing times, for the "In port today" strip on the home page.

    python3 scripts/fetch-ships.py

The schedule is CruiseTimetables.com's public Nassau page (credited on the site). Their
firewall turns away requests from Cloudflare's servers, so this runs elsewhere and the
result is published with the site: weekly, by .github/workflows/ships.yml, or by hand.
One page a second, as their robots.txt asks.
"""
import datetime as dt
import html
import json
import pathlib
import re
import sys
import time
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "ships.json"
URL = "https://www.cruisetimetables.com/nassaubahamasschedule-{}.html"
DAYS = 45
UA = "Mozilla/5.0 (compatible; paradiseseaexpress.com ships-in-port; hello@paradiseseaexpress.com)"


def clock(hhmm):
    if not hhmm:
        return None
    h, m = int(hhmm[:2]), hhmm[2:]
    return f"{h % 12 or 12}{'' if m == '00' else ':' + m}{'am' if h < 12 else 'pm'}"


def day(d):
    page = urllib.request.urlopen(urllib.request.Request(URL.format(d.strftime("%d%b%Y").lower()), headers={"User-Agent": UA}), timeout=30).read().decode("utf-8", "replace")
    page = re.sub(r"<(script|style)\b.*?</\1>", "", page, flags=re.S | re.I)
    lines = [l.strip() for l in html.unescape(re.sub(r"<[^>]+>", "\n", page)).split("\n") if l.strip()]
    ships = []
    for i, line in enumerate(lines[1:], 1):
        name = lines[i - 1]
        if not re.search(r"[a-z]", name, re.I) or len(name) > 60:
            continue
        # Two ways the site writes times: "a 0730 d 1730" (near days), "7am-4pm" (later ones).
        m = re.fullmatch(r"(?:a (\d{4}))?\s*(?:d (\d{4}))?", line)
        if m and (m[1] or m[2]):
            arrive, depart = m[1], m[2]
        else:
            m = re.fullmatch(r"(\d{1,2}(?::\d{2})?\s*[ap]m)?\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]m)?", line, re.I)
            if not m or not (m[1] or m[2]):
                continue
            arrive, depart = hhmm(m[1]), hhmm(m[2])
        ships.append({"name": name, "arrive": clock(arrive), "depart": clock(depart), "departs": depart})
    return ships


def hhmm(t):
    """'7am' / '2:30pm' → '0700' / '1430'."""
    if not t:
        return None
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*([ap]m)", t.strip(), re.I)
    h = int(m[1]) % 12 + (12 if m[3].lower() == "pm" else 0)
    return f"{h:02d}{m[2] or '00'}"


def main():
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()  # Nassau
    out, failed = {}, 0
    for n in range(DAYS):
        d = today + dt.timedelta(days=n)
        try:
            out[d.isoformat()] = day(d)
        except Exception as err:  # a missing day just isn't listed
            failed += 1
            print(f"{d}: {err}", file=sys.stderr)
        time.sleep(1)
    if not out:
        sys.exit("No days could be read: ships.json left as it was.")
    OUT.write_text(json.dumps({"source": "https://www.cruisetimetables.com/nassau-bahamas-cruise-ship-schedule.html", "updated": today.isoformat(), "days": out}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {OUT}: {len(out)} days, {sum(map(len, out.values()))} calls" + (f", {failed} days unread" if failed else ""))


if __name__ == "__main__":
    main()
