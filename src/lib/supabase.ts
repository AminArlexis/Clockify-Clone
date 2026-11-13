import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://nlxcplagaqxkdgimnbdr.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_VblM-O0NPPsJyAgqR8hv_A_7Jtqt-RI";

export const isSupabaseConfigured =
  import.meta.env.MODE !== "test" && Boolean(supabaseUrl && supabaseAnonKey);
export const supabase =
  isSupabaseConfigured && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
