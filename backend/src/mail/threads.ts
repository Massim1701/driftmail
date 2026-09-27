// [2026-09-27] WEB_INBOX.md 27.09. "BUG - Thread-Ansicht gruppiert nicht":
// serverseitige Thread-Zuordnung ueber ALLE Ordner eines Kontos. Vorher hat
// der Client nur ueber inReplyToMessageId INNERHALB des geladenen Ordners
// gruppiert -- eine Antwort im Eingang haengt aber typischerweise an der
// eigenen gesendeten Mail (Ordner Gesendet) und wurde daher nie mit dem
// Original im Eingang zusammengefasst. Ausserdem wurde die Kette oft gar
// nicht aufgeloest (siehe mail/sync.ts, "sent-"-Praefix).
//
// Drei Verknuepfungsregeln (Union-Find, Thread-ID = aelteste Nachricht):
// 1. inReplyToMessageId (direkter Elternteil, schon aufgeloest).
// 2. Gemeinsame Message-IDs aus eigenem Message-ID-, In-Reply-To- und
//    References-Header -- verbindet auch zwei Antworten auf eine Mail, die
//    selbst nicht in driftmail liegt (z.B. aus dem Webmail gesendet).
// 3. Rueckfall ohne Header: gleicher Betreff nach Entfernen von Re:/AW:/
//    Fwd:/WG:, wenn mindestens eine der beiden Mails ein Antwort-Praefix hat
//    UND dieselbe Gegenseite beteiligt ist -- damit zwei unabhaengige Mails
//    mit Betreff "Rechnung" NICHT zusammenfallen.
import type { MessageRecord } from "../types";

const MESSAGE_ID_TOKEN = /<[^<>\s]+>/g;
const REPLY_PREFIX = /^\s*((re|aw|antw|fwd?|wg)(\[\d+\])?\s*:\s*)+/i;
const EMAIL = /[^\s<>,;:"'()[\]{}]+@[^\s<>,;:"'()[\]{}]+\.[a-z0-9-]+/gi;

function header(m: MessageRecord, name: string): string | undefined {
  if (!m.rawHeaders) return undefined;
  const key = Object.keys(m.rawHeaders).find((k) => k.toLowerCase() === name);
  return key ? m.rawHeaders[key] : undefined;
}

/** Eigene Message-ID plus alle referenzierten, jeweils mit spitzen Klammern.
 * Gesendete Kopien tragen `sent-<id>` (mail/sendMessage.ts) -- Praefix weg. */
function messageIdTokens(m: MessageRecord): string[] {
  const tokens = new Set<string>();
  const own = m.messageIdHeader.replace(/^sent-/, "");
  if (own.startsWith("<")) tokens.add(own.toLowerCase());
  for (const name of ["in-reply-to", "references"]) {
    for (const t of header(m, name)?.match(MESSAGE_ID_TOKEN) ?? []) tokens.add(t.toLowerCase());
  }
  return [...tokens];
}

function baseSubject(subject: string | null): { base: string; isReply: boolean } {
  const s = subject ?? "";
  const stripped = s.replace(REPLY_PREFIX, "").trim().toLowerCase().replace(/\s+/g, " ");
  return { base: stripped, isReply: stripped.length < s.trim().length };
}

/** Beteiligte Adressen ausser dem eigenen Konto (From/To/Cc). */
function counterparts(m: MessageRecord, ownAddress: string): Set<string> {
  const all = [m.fromAddress, header(m, "to") ?? "", header(m, "cc") ?? ""].join(" ");
  const found = (all.match(EMAIL) ?? []).map((a) => a.toLowerCase());
  return new Set(found.filter((a) => a !== ownAddress));
}

/** Liefert fuer jede Nachricht (per id) die Thread-ID = id der aeltesten
 * Nachricht ihres Threads. `messages` sollten ALLE Nachrichten eines Kontos
 * sein, sonst bleiben Ketten ueber nicht uebergebene Nachrichten offen. */
export function computeThreadIds(messages: MessageRecord[], ownAddress: string): Map<string, string> {
  const parent = new Map<string, string>(messages.map((m) => [m.id, m.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Regel 1
  for (const m of messages) {
    if (m.inReplyToMessageId && parent.has(m.inReplyToMessageId)) union(m.id, m.inReplyToMessageId);
  }

  // Regel 2
  const byToken = new Map<string, string>();
  for (const m of messages) {
    for (const t of messageIdTokens(m)) {
      const other = byToken.get(t);
      if (other) union(m.id, other);
      else byToken.set(t, m.id);
    }
  }

  // Regel 3
  const own = ownAddress.toLowerCase();
  const bySubject = new Map<string, { m: MessageRecord; isReply: boolean; people: Set<string> }[]>();
  for (const m of messages) {
    const { base, isReply } = baseSubject(m.subject);
    if (!base) continue;
    const people = counterparts(m, own);
    const candidates = bySubject.get(base) ?? [];
    for (const c of candidates) {
      if ((isReply || c.isReply) && [...people].some((p) => c.people.has(p))) union(m.id, c.m.id);
    }
    candidates.push({ m, isReply, people });
    bySubject.set(base, candidates);
  }

  // Thread-ID stabil = aelteste Nachricht der Gruppe (nicht der zufaellige
  // Union-Find-Root), damit sie sich nicht aendert, wenn Antworten dazukommen.
  const oldestByRoot = new Map<string, MessageRecord>();
  for (const m of messages) {
    const root = find(m.id);
    const current = oldestByRoot.get(root);
    if (!current || m.receivedAt < current.receivedAt) oldestByRoot.set(root, m);
  }
  return new Map(messages.map((m) => [m.id, oldestByRoot.get(find(m.id))!.id]));
}
