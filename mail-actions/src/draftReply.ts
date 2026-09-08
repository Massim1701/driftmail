// driftmail — Track E: Antwortentwurf (draftReply)
//
// Implementiert draftReply(thread) aus contracts/ai-adapter-interface.ts.
// WICHTIG (Contract-Kommentar): das Ergebnis geht NIE automatisch raus,
// immer Review/Edit/Send durch den User. Das ist UI-seitig durchzusetzen
// (nicht Teil dieses Moduls) — hier liefern wir nur den Text.

import type { AiAdapterResult, MailThread } from "./types";
import {
  appendSignature,
  selectSignatureForReply,
  type SignatureRecord,
} from "./signatures";

/** Letzte Nachricht eines Threads, chronologisch (Array ist aufsteigend sortiert angenommen). */
function lastMessage(thread: MailThread): MailThread["messages"][number] | null {
  const { messages } = thread;
  return messages.length > 0 ? messages[messages.length - 1]! : null;
}

/**
 * Sehr grobe Namens-Herleitung aus der Absenderadresse, weil MailThread
 * (Contract) keinen separaten Display-Namen mitführt. "jane.doe@x.com" ->
 * "Jane Doe". Fällt auf null zurück, wenn nichts Sinnvolles extrahierbar ist.
 */
function guessNameFromAddress(fromAddress: string): string | null {
  const localPart = fromAddress.split("@")[0];
  if (!localPart) return null;

  const words = localPart
    .split(/[._+-]/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !/^\d+$/.test(w));

  if (words.length === 0) return null;

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * ===========================================================================
 * PLATZHALTER — hier kommt später echte KI-Textgenerierung rein.
 * ===========================================================================
 *
 * Reale Implementierung würde hier (analog zu analyzeMail/summarize):
 *  - on-device Modell versuchen (iOS/Android/Windows, siehe
 *    user_ai_capability), sonst
 *  - Cloud-Fallback über den Provider aus ai_provider_config mit
 *    task_type = 'reply_draft' (siehe db-schema.sql),
 *  - den ganzen Thread (nicht nur die letzte Nachricht) als Kontext
 *    übergeben, inkl. Tonalität/Sprache der bisherigen Konversation,
 *  - AiAdapterResult<string> mit korrektem `source` zurückgeben (die
 *    Signatur transportiert das jetzt, siehe unten — Contract wurde am
 *    08.09. auf Wunsch von Web angepasst, siehe SYNC.md).
 *
 * Für den Erst-Durchstich hier: einfaches, deterministisches Template
 * basierend auf Betreff + grob geratenem Absendernamen der letzten
 * Nachricht. Kein Netzwerk, kein Modell, rein synchron berechnet.
 */
function generateReplyDraftText(thread: MailThread): string {
  const last = lastMessage(thread);

  if (!last) {
    return [
      "Hallo,",
      "",
      "vielen Dank für Ihre Nachricht.",
      "",
      "[Platzhalter-Entwurf: Thread enthält keine Nachrichten, aus denen ein" +
        " Kontext abgeleitet werden konnte.]",
      "",
      "Viele Grüße",
    ].join("\n");
  }

  const name = guessNameFromAddress(last.fromAddress);
  const greeting = name ? `Hallo ${name},` : "Hallo,";
  const subject = last.subject?.trim() || "Ihre Nachricht";

  return [
    greeting,
    "",
    `vielen Dank für Ihre Nachricht zu "${subject}".`,
    "",
    "[Platzhalter-Entwurf: Hier würde ein KI-generierter Antworttext auf" +
      " Basis des gesamten Thread-Kontexts stehen. TODO: generateReplyDraftText" +
      " durch echten AI-Adapter-Aufruf ersetzen.]",
    "",
    "Viele Grüße",
  ].join("\n");
}

/**
 * draftReply(thread) — Contract-Implementierung.
 * Promise-Signatur bewusst beibehalten (async), obwohl die aktuelle
 * Platzhalter-Logik synchron ist: eine echte AI-Anbindung braucht await.
 *
 * `source` ist hier immer "cloud_fallback": die Platzhalter-Logik läuft
 * nicht on-device (kein Modell, kein user_ai_capability-Check), daher ist
 * "cloud_fallback" die ehrlichere der beiden erlaubten Werte, auch wenn
 * de facto kein Netzwerk-Call passiert. Sobald echte KI-Anbindung kommt,
 * muss `source` das tatsächlich verwendete Verfahren widerspiegeln.
 */
export async function draftReply(thread: MailThread): Promise<AiAdapterResult<string>> {
  return { data: generateReplyDraftText(thread), source: "cloud_fallback" };
}

/**
 * Orchestriert draftReply + Signatur-Logik, so wie es Track A (Backend) für
 * /messages/{messageId}/reply-draft (api-spec.yaml) tun würde: Entwurf
 * generieren, dann bei Bedarf die für "reply" freigeschaltete Signatur des
 * Mail-Accounts anhängen. Kein Teil des Track-0-Contracts, sondern
 * Beispiel/Baustein für die Integration von draftReply + Signaturen.
 */
export async function composeReplyDraft(
  thread: MailThread,
  mailAccountId: string,
  accountSignatures: readonly SignatureRecord[]
): Promise<string> {
  const { data: draftText } = await draftReply(thread);
  const signature = selectSignatureForReply(accountSignatures, mailAccountId);
  return appendSignature(draftText, signature);
}
