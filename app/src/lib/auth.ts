import React from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Phone number is the account, the way it is on Uber. The SMS code both signs
 * you in and verifies the number, so there's one system rather than two — and
 * no Apple/Google configuration needed to have working accounts.
 *
 * Requires an SMS provider connected in Supabase (Authentication → Providers →
 * Phone). Without one the API returns `phone_provider_disabled`.
 */

/** Supabase wants E.164 — "+12425550142", no spaces or punctuation. */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : `+${digits}`;
}

export function isPlausiblePhone(input: string): boolean {
  const digits = normalisePhone(input).slice(1);
  // Country code + number: 8 digits (short national) to 15 (E.164 maximum).
  return digits.length >= 8 && digits.length <= 15;
}

/** Pretty-print for reading back to the customer: +1 242 555 0142 */
export function prettyPhone(input: string): string {
  const d = normalisePhone(input).slice(1);
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  return `+${d}`;
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
  const { error } = await supabase.auth.signInWithOtp({
    phone: normalisePhone(phone),
  });
  if (error) {
    if ((error as any).code === "phone_provider_disabled") throw new AuthNotConfiguredError();
    throw error;
  }
}

/** Exchange the texted code for a session. */
export async function verifyCode(phone: string, code: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalisePhone(phone),
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
