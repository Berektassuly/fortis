export function getSafeRedirectPath(candidate: string | null | undefined, fallback = "/") {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  return candidate;
}

export function applyRedirectTarget(url: URL, target: string | null | undefined, fallback = "/") {
  const redirectTarget = new URL(getSafeRedirectPath(target, fallback), url.origin);

  url.pathname = redirectTarget.pathname;
  url.search = redirectTarget.search;

  return url;
}
