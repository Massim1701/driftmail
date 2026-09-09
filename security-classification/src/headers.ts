/**
 * E-Mail-Header sind laut RFC 5322 case-insensitive. Der Contract übergibt
 * sie als Record<string, string> ohne festgelegte Groß-/Kleinschreibung der
 * Keys, deshalb hier ein case-insensitiver Lookup statt direktem Property-
 * Zugriff.
 */
export function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return undefined;
}
