const DEFAULT_LISTINGS_BUCKET = "listings";

export function getOptionalSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    return null;
  }

  return {
    anonKey,
    url,
  };
}

export function isSupabaseConfigured() {
  return getOptionalSupabaseConfig() !== null;
}

function requirePublicConfig() {
  const config = getOptionalSupabaseConfig();

  if (!config) {
    throw new Error(
      "Supabase auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return config;
}

export function getSupabaseUrl() {
  return requirePublicConfig().url;
}

export function getSupabaseAnonKey() {
  return requirePublicConfig().anonKey;
}

export function getListingsBucket() {
  return process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_LISTINGS_BUCKET;
}
