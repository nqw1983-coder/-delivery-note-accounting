import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.warn("[supabase] env not set, falling back to localStorage-only mode");
}

export const supabase = url && key ? createClient(url, key) : null;

export const isCloudEnabled = () => supabase !== null;
