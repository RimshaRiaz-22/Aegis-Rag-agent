/**
 * Normalize any namespace string to a safe, consistent format.
 * Always uses underscores (never hyphens) so that frontend-generated
 * namespaces (u_userId_with_underscores) always match DB-stored namespaces.
 */
export function normalizeNamespace(raw) {
  if (!raw) return null;
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}
