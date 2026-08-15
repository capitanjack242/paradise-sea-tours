import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Publishable key — safe on a device, access is scoped by row-level security.
// Same project the website and dispatch board already use.
const SUPABASE_URL = "https://fjdoaonnoezbbitbawzs.supabase.co";
const SUPABASE_KEY = "sb_publishable_RjTM-t2isu1Teq9P5z37PQ_h_Oy3EpP";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // Keep the session on the device so a returning passenger stays signed in.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Mobile has no URL bar to read an auth callback out of.
    detectSessionInUrl: false,
  },
});
