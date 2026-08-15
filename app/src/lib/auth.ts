import React from "react";
import type { Session } from "@supabase/supabase-js";
import { parsePhoneNumberFromString, type PhoneNumber } from "libphonenumber-js";
import { supabase } from "./supabase";

/**
 * Phone number is the account, the way it is on Uber. The SMS code both signs
 * you in and verifies the number, so there's one system rather than two — and
 * no Apple/Google configuration needed to have working accounts.
 *
 * Requires an SMS provider connected in Supabase (Authentication → Providers →
 * Phone). Without one the API returns `phone_provider_disabled`.
 */

/**
 * Work out what number someone meant, rather than making them format it.
 * People leave off the "+", write 00 instead, or type a local number with no
 * country code — all answerable. Local numbers are tried first (Bahamas, then
 * US, the two biggest sources of passengers), because "2425550100" is a
 * Bahamian number, not country code 242.
 */
export function parsePhone(input: string): PhoneNumber | null {
  const text = (input || "").trim();
  if (!text) return null;
  const digits = text.replace(/[^\d+]/g, "");

  const attempts: Array<[string, "BS" | "US" | undefined]> = digits.startsWith("+")
    ? [[digits, undefined]]
    : digits.startsWith("00")
    ? [["+" + digits.slice(2), undefined]]
    : [
        [digits, "BS"],
        [digits, "US"],
        ["+" + digits, undefined],
      ];

  for (const [value, country] of attempts) {
    try {
      const p = parsePhoneNumberFromString(value, country);
      if (p?.isValid()) return p;
    } catch {
      /* try the next interpretation */
    }
  }
  return null;
}

/** Supabase wants E.164 — "+12425550142". Null when we can't read it. */
export function normalisePhone(input: string): string | null {
  return parsePhone(input)?.number ?? null;
}

export function isPlausiblePhone(input: string): boolean {
  return parsePhone(input) !== null;
}

/** Pretty-print for reading back to the customer: +1 242 555 0142 */
export function prettyPhone(input: string): string {
  return parsePhone(input)?.formatInternational() ?? input;
}

export class AuthNotConfiguredError extends Error {
  constructor() {
    super(
      "Text messages aren't switched on yet. Connect an SMS provider in Supabase → Authentication → Providers → Phone."
    );
    this.name = "AuthNotConfiguredError";
  }
}

/** Ask Supabase to text a login code. Creates the account if it's a new number. */
export async function sendCode(phone: string): Promise<void> {
  const e164 = normalisePhone(phone);
  if (!e164) throw new Error("We couldn't read that as a phone number.");
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) {
    if ((error as any).code === "phone_provider_disabled") throw new AuthNotConfiguredError();
    throw error;
  }
}

/** Exchange the texted code for a session. */
export async function verifyCode(phone: string, code: string): Promise<Session> {
  const e164 = normalisePhone(phone);
  if (!e164) throw new Error("We couldn't read that as a phone number.");
  const { data, error } = await supabase.auth.verifyOtp({
    phone: e164,
    token: code.trim(),
    type: "sms",
  });
  if (error) throw error;
  if (!data.session) throw new Error("That code didn't work. Try again.");
  return data.session;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Phone auth gives us no name, so we ask for one and store it on the profile. */
export async function saveName(fullName: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim() })
    .eq("id", data.user.id);
  if (error) throw error;
}

export async function fetchProfileName(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: rows } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", data.user.id)
    .maybeSingle();
  return rows?.full_name ?? null;
}

/** Current session, kept in sync. Persisted to the device by the client. */
export function useSession() {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
