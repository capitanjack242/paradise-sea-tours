/* The alert only works if four separate files agree, and nothing in a compiler
   or a test suite would catch them drifting apart:

     · the sound file exists, and is short enough for iOS
     · app.json bundles that exact filename
     · the app's channel ids match the ones the server puts on a push
     · a run gets the alert and a message does not
*/
import { readFileSync, statSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => { console.error("FAILED: " + m); process.exit(1); };

// ── the file itself ────────────────────────────────────────────────────────
const wavPath = `${ROOT}/captain-app/assets/run_alert.wav`;
const buf = readFileSync(wavPath);
if (buf.toString("ascii", 0, 4) !== "RIFF") fail("run_alert.wav isn't a WAV");
const rate = buf.readUInt32LE(24);
const bytesPerSec = buf.readUInt32LE(28);
const seconds = (statSync(wavPath).size - 44) / bytesPerSec;
if (seconds > 30) fail(`${seconds.toFixed(1)}s — iOS refuses a notification sound over 30`);
if (seconds < 5) fail(`${seconds.toFixed(1)}s is too short to be heard over an engine`);
console.log(`  ✓ run_alert.wav — ${seconds.toFixed(1)}s at ${rate} Hz, inside iOS's 30s limit`);

// Android turns the filename into a resource name and accepts only [a-z0-9_].
if (!/^[a-z0-9_]+\.wav$/.test("run_alert.wav"))
  fail("the filename won't survive Android's resource naming");
console.log("  ✓ the filename is legal as an Android resource");

// ── app.json bundles it, and asks for the right entitlement ────────────────
const appJson = JSON.parse(readFileSync(`${ROOT}/captain-app/app.json`, "utf8"));
const notif = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-notifications");
if (!notif) fail("expo-notifications plugin missing");
if (!(notif[1].sounds ?? []).some((s) => s.endsWith("run_alert.wav")))
  fail("app.json doesn't bundle run_alert.wav — the build would ship without it");
console.log("  ✓ app.json bundles the sound into both builds");

const ent = appJson.expo.ios?.entitlements ?? {};
if (!ent["com.apple.developer.usernotifications.time-sensitive"])
  fail("the Time Sensitive entitlement is off, so Focus modes will swallow runs");
console.log("  ✓ Time Sensitive entitlement is on");

// ── both sides agree on the channels ───────────────────────────────────────
const push = readFileSync(`${ROOT}/captain-app/src/lib/push.ts`, "utf8");
const fn = readFileSync(`${ROOT}/supabase/functions/notify-captain/index.ts`, "utf8");

const appRun = push.match(/RUN_CHANNEL\s*=\s*"([^"]+)"/)?.[1];
const appMsg = push.match(/MESSAGE_CHANNEL\s*=\s*"([^"]+)"/)?.[1];
const srvRun = fn.match(/RUN_ALERT\s*=\s*\{[\s\S]*?channelId:\s*"([^"]+)"/)?.[1];
const srvMsg = fn.match(/MESSAGE_ALERT\s*=\s*\{[\s\S]*?channelId:\s*"([^"]+)"/)?.[1];

if (!appRun || !srvRun || appRun !== srvRun)
  fail(`run channel drifted: app "${appRun}" vs server "${srvRun}" — the sound would silently not play`);
if (!appMsg || !srvMsg || appMsg !== srvMsg)
  fail(`message channel drifted: app "${appMsg}" vs server "${srvMsg}"`);
console.log(`  ✓ both sides agree: runs on "${appRun}", messages on "${appMsg}"`);

// The app must actually create the channel it claims, with the sound on it.
if (!new RegExp(`setNotificationChannelAsync\\(RUN_CHANNEL`).test(push))
  fail("the run channel is never created");
if (!/sound:\s*"run_alert\.wav"/.test(push))
  fail("the run channel doesn't carry the sound");
if (!/AndroidImportance\.MAX/.test(push))
  fail("the run channel isn't at maximum importance, so it won't come in as a heads-up");
console.log("  ✓ the run channel is created at MAX importance with the sound on it");

// ── a run gets the alert; a message does not ───────────────────────────────
if (!/\.\.\.RUN_ALERT/.test(fn)) fail("runs don't get the alert");
if (!/\.\.\.MESSAGE_ALERT/.test(fn)) fail("messages don't get their own quieter treatment");
const runAlert = fn.match(/const RUN_ALERT = \{[\s\S]*?\};/)[0];
const msgAlert = fn.match(/const MESSAGE_ALERT = \{[\s\S]*?\};/)[0];
if (!/run_alert\.wav/.test(runAlert)) fail("the run alert doesn't name the sound");
if (/run_alert\.wav/.test(msgAlert))
  fail("a message would play the 25-second Junkanoo — that's how you get the app silenced");
if (!/time-sensitive/.test(runAlert)) fail("runs aren't marked time-sensitive");
if (!/ttl/.test(runAlert)) fail("a run push has no expiry — a phone back in signal would alarm about an old one");
console.log("  ✓ runs ring, messages don't, and a stale run push expires");

console.log("");
console.log("PASSED");
