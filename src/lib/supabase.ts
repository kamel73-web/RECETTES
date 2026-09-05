import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies (voir .env.example).'
  );
}

// Clé anon uniquement ici. La clé service_role ne doit JAMAIS apparaître
// côté client — elle vit uniquement dans les Edge Functions (cahier des charges, section 10).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
