const DEFAULT_LISTINGS_BUCKET = "listings";

function requirePublicEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for Supabase auth and storage.`);
  }

  return value;
}

export function getSupabaseUrl() {
  return requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey() {
  return requirePublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getListingsBucket() {
  return process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_LISTINGS_BUCKET;
}
