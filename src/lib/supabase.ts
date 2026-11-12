import { createClient } from '@supabase/supabase-js';

// Supabase Project Credentials
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://nlxcplagaqxkdgimnbdr.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_VblM-O0NPPsJyAgqR8hv_A_7Jtqt-RI';

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('placeholder')
);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
