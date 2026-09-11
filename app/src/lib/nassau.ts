/* Nassau's clock, on a phone that may be set to somebody else's.

   A passenger's phone is often still on home time — a cruise passenger who
   landed this morning, a European who never switched roaming on. Built with the
   phone's own zone, "10:30 AM" from a Berlin phone became 4:30 AM Nassau, and a
   captain would wait at dawn for nobody. Everything here works in Nassau time
   and hands back real instants. */

export const NASSAU_TZ = "America/Nassau";

/** Minutes Nassau's clock is ahead of UTC at a given instant: -240 or -300. */
export function nassauOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NASSAU_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((wall - at.getTime()) / 60000);
}

/** Today's date in Nassau, as the numbers on the calendar there. */
export function nassauToday(now: Date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NASSAU_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n("year"), m: n("month"), d: n("day") };
}

/** The instant at which Nassau's clocks read y-m-d h:mi. */
export function nassauInstant(y: number, m: number, d: number, h: number, mi: number): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  // Two passes: the offset can differ either side of a clock change.
  const first = wall - nassauOffsetMinutes(new Date(wall)) * 60000;
  return new Date(wall - nassauOffsetMinutes(new Date(first)) * 60000);
}

/**
 * "Today" or "Tomorrow" in Nassau, at a Nassau wall-clock time like "10:30 AM".
 * Days from today are counted on Nassau's calendar, not the phone's — at 11pm
 * in Berlin it is still late afternoon in Nassau, and "tomorrow" means Nassau's.
 */
export function nassauDayAt(daysFromToday: number, time: string, now: Date = new Date()): Date {
  const { y, m, d } = nassauToday(now);
  const match = time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  let h = 0;
  let mi = 0;
  if (match) {
    h = Number(match[1]) % 12;
    if (match[3].toUpperCase() === "PM") h += 12;
    mi = Number(match[2]);
  }
  // Date.UTC normalises an overflowing day, so "the 31st + 1" rolls into the
  // next month on its own.
  return nassauInstant(y, m, d + daysFromToday, h, mi);
}

/** Options to hand toLocaleString so a time reads in Nassau's clock. */
export const IN_NASSAU = { timeZone: NASSAU_TZ } as const;
