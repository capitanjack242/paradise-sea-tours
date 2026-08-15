import React from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/* Captains sign in with the email and password created for them in Supabase,
   the same login the web board uses.

   The mockup drew phone sign-in to match the passenger app. That's still the
   better answer eventually — a captain has a phone, not necessarily an email
   he can find — but it waits on an SMS provider, and captains are staff whose
   logins are made for them anyway. Swapping later touches only this file. */

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export function useSession() {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
