// Parst den "In-Reply-To"-Header (RFC 5322) fuer die Thread-Verknuepfung
// (WEB_INBOX.md 15.09., "IBAN-Wechsel im selben Thread"). Grundlage fuer
// messages.in_reply_to_message_id -- siehe mail/sync.ts.

/**
 * Liefert den rohen Message-ID-Wert aus dem "In-Reply-To"-Header, inkl.
 * spitzer Klammern (gleiches Format wie message_id_header, siehe
 * db-schema.sql UNIQUE-Constraint) -- damit ist der Wert direkt gegen
 * store.findMessageByHeader() vergleichbar, ohne Format-Umweg.
 *
 * "In-Reply-To" enthaelt laut RFC 5322 normalerweise genau EINE Message-ID;
 * falls mehrere angegeben sind (nicht spezifikationskonform, kommt aber
 * vor), wird bewusst nur die erste verwendet -- mehr Praezision braeuchte
 * echtes Threading ueber den "References"-Header, das ist hier nicht
 * Umfang des Auftrags.
 */
export function parseInReplyToHeader(headers: Record<string, string>): string | null {
  const lower = "in-reply-to";
  let raw: string | undefined;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      raw = headers[key];
      break;
    }
  }
  if (!raw) return null;

  const match = raw.match(/<[^>]+>/);
  return match ? match[0] : raw.trim() || null;
}
