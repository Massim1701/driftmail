// Abwesenheitsassistent -- automatischer Auslöse-Teil (WEB_INBOX.md 21.09.
// "NEUER AUFTRAG - Abwesenheitsassistent"). Die Einstellungs-Verwaltung
// selbst liegt in routes/absenceResponder.ts, diese Datei entscheidet pro
// eingehender Mail im Sync-Pfad (mail/sync.ts), ob eine automatische
// Antwort rausgeht.
//
// Sicherheits-Verbesserung ueber Gmail/Outlook hinaus (Massimos Vorschlag,
// explizit im Auftrag genannt): KEINE automatische Antwort an Absender,
// die als spam/phishing klassifiziert wurden -- verhindert, dass Betrueger
// per automatischer Abwesenheitsantwort erfahren, dass der User gerade
// nicht erreichbar ist (bekanntes Einfallstor fuer Social-Engineering
// waehrend der Abwesenheit). `advance_fee_scam` braucht hier KEINE eigene
// Pruefung: diese Nachrichten landen auf dem Auto-Delete-Pfad in
// mail/sync.ts (nie eine messages-Zeile, `continue` VOR dem Aufruf dieser
// Funktion) -- structurell koennen sie diese Funktion nie erreichen.

import { appendSignature } from "@driftmail/mail-actions";
import type { MailAccountRecord, Classification, SignatureRecord } from "../types";
import type { MailAdapter } from "./types";
import { parseListUnsubscribeHeader } from "./listUnsubscribe";
import { store } from "../db/store";

const DEFAULT_COOLDOWN_DAYS = 4;

function cooldownDays(): number {
  const raw = process.env.ABSENCE_RESPONDER_COOLDOWN_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COOLDOWN_DAYS;
}

/** mail-actions/SignatureStore erwartet die snake_case-Record-Form aus
 * db-schema.sql (siehe dortigen Kommentar "Feldnamen bewusst wie im
 * DB-Schema") -- backend/src/types.ts spiegelt camelCase wie jeder andere
 * Record hier, deshalb eine kleine Adapter-Zuordnung an dieser einen
 * Aufrufstelle statt die Konvention eines der beiden Module zu brechen. */
function toMailActionsSignature(s: SignatureRecord) {
  return {
    id: s.id,
    mail_account_id: s.mailAccountId,
    content_html: s.contentHtml,
    is_default: s.isDefault,
    apply_to_new: s.applyToNew,
    apply_to_replies: s.applyToReplies,
  };
}

export async function maybeSendAbsenceResponse(
  rawHeaders: Record<string, string>,
  fromAddress: string,
  classification: Classification,
  account: MailAccountRecord,
  adapter: MailAdapter,
): Promise<void> {
  const responder = await store.getAbsenceResponder(account.userId);
  if (!responder || !responder.active) return;

  const today = new Date().toISOString().slice(0, 10);
  if (responder.startDate && today < responder.startDate) return;
  if (responder.endDate && today > responder.endDate) return;

  // Sicherheits-Ausnahme (siehe Datei-Kopfkommentar).
  if (classification === "spam" || classification === "phishing") return;

  // Mailinglisten-Heuristik (WEB_INBOX.md-Vorgabe): ein List-Unsubscribe-
  // Header deutet auf Newsletter/Liste statt persoenlicher Mail hin.
  if (parseListUnsubscribeHeader(rawHeaders)) return;

  // Pro-Absender-Rate-Begrenzung (Default 4 Tage, wie Gmail) -- verhindert
  // Antwort-Schleifen bei wiederholten Mails derselben Person.
  const lastSent = await store.getAbsenceResponderLastSent(account.userId, fromAddress);
  if (lastSent) {
    const daysSinceLastSent = (Date.now() - new Date(lastSent).getTime()) / (24 * 3600 * 1000);
    if (daysSinceLastSent < cooldownDays()) return;
  }

  // Bestehende Default-Signatur des Kontos automatisch anhaengen, falls
  // vorhanden (siehe backend/README.md "Signaturen" -- kein eigenes
  // Signatur-Feld am Abwesenheitsassistenten selbst).
  const signatures = await store.listSignatures(account.id);
  const defaultSignature = signatures.find((s) => s.isDefault) ?? null;
  const bodyText = defaultSignature
    ? appendSignature(responder.body ?? "", toMailActionsSignature(defaultSignature))
    : (responder.body ?? "");

  try {
    await adapter.sendMail({
      to: [fromAddress],
      cc: [],
      bcc: [],
      subject: responder.subject ?? "Automatische Abwesenheitsantwort",
      bodyText,
      inReplyToMessageIdHeader: null,
    });
    await store.recordAbsenceResponderSent(account.userId, fromAddress, new Date().toISOString());
  } catch (err) {
    // Ein fehlgeschlagener automatischer Versand darf den restlichen
    // Mail-Sync nicht blockieren/abbrechen (gleiches Prinzip wie
    // maybeAutoUnsubscribeFromSpam()).
    console.error(`[absence-responder] Automatische Antwort an ${fromAddress} fehlgeschlagen:`, err);
  }
}
