// Bot/Human-Missbrauchserkennung beim Versand (WEB_INBOX.md 08.09. "Bot/
// Human-Missbrauchserkennung beim Versand", Tabellen seit Commit a5432e6
// -- diese Datei ist die bis 25.09. fehlende Erkennungslogik selbst,
// siehe WEB_INBOX.md 25.09. "send abuse jetzt umsetzen").
//
// Kein numerischer Schwellenwert war je vorgegeben worden (nur die vier
// flag_reason-Namen + die zwei Tabellen) -- die Werte unten sind eine
// eigene, pragmatische Entscheidung (siehe Kommentare je Konstante),
// bewusst als Ruecksprache dokumentiert statt stillschweigend als
// "richtig" behauptet, analog zum Auth-Design in TERMINAL_INBOX.md 10.09.
//
// Eskalationsprinzip (einheitlich fuer alle drei blockierbaren Gruende):
// beim ERSTEN Ueberschreiten eines Schwellenwerts wird nur gewarnt
// (action_taken='warned', Versand geht trotzdem durch) -- ein einzelner
// Ausreisser (z.B. ein Rundmail an die eigene Familie) soll niemanden
// aussperren. Wird DERSELBE Grund innerhalb von ESCALATION_WINDOW_MS
// erneut ueberschritten, wird eskaliert (action_taken='rate_limited',
// Versand wird abgelehnt, HTTP 429) -- erst wiederholtes, kurz
// aufeinanderfolgendes Verhalten gilt als hinreichend verdaechtig fuer
// eine echte Sperre. `no_read_before_reply` ist bewusst ausgenommen und
// eskaliert NIE (siehe eigener Kommentar unten).
import { createHash } from "node:crypto";
import type { AbuseFlagReason } from "../types";
import type { Store } from "../db/store";

/** Zeitfenster + Schwellenwert fuer rate_burst: viele Sende-Vorgaenge
 * (outgoing_send_log-Zeilen, unabhaengig davon ob aus einem oder mehreren
 * POST /messages/send-Aufrufen) in kurzer Zeit -- klassisches Muster eines
 * kompromittierten Kontos, das automatisiert Spam verschickt. 10 Zeilen in
 * 2 Minuten sind fuer einen tippenden Menschen praktisch unerreichbar,
 * aber fuer ein Skript trivial. */
export const RATE_BURST_WINDOW_MS = 2 * 60_000;
export const RATE_BURST_THRESHOLD = 10;

/** many_new_recipients: viele NOCH NIE zuvor angeschriebene Empfaenger in
 * kurzer Zeit -- typisches Muster eines Spam-/Phishing-Versands aus einem
 * gekaperten Konto (normale Nutzung schreibt meist wiederkehrende
 * Kontakte an). 6 neue Empfaenger in 10 Minuten. */
export const NEW_RECIPIENTS_WINDOW_MS = 10 * 60_000;
export const NEW_RECIPIENTS_THRESHOLD = 6;

/** duplicate_content: dieselbe Nachricht (exakter Text, siehe
 * computeBodyHash) an mehrere unterschiedliche Empfaenger in kurzer Zeit
 * -- Rundmail-Muster, das bei einem Massenversand/Bot deutlich haeufiger
 * vorkommt als bei normaler individueller Korrespondenz. 3 unterschiedliche
 * Empfaenger derselben Nachricht in 15 Minuten. */
export const DUPLICATE_CONTENT_WINDOW_MS = 15 * 60_000;
export const DUPLICATE_CONTENT_THRESHOLD = 3;

/** Fenster, innerhalb dessen ein bereits als 'warned' markierter,
 * unresolved-Flag eines Grundes eine ERNEUTE Ueberschreitung desselben
 * Grundes zu 'rate_limited' (Versand abgelehnt) eskaliert. */
export const ESCALATION_WINDOW_MS = 15 * 60_000;

/** no_read_before_reply: nur relevant bei Antworten (inReplyToMessageId
 * gesetzt) UND wenn der Client `timeSinceDraftShownMs` mitschickt (optional,
 * siehe api-spec.yaml -- kein Client sendet das bisher, der Check greift
 * einfach nicht, bis Web/iOS das nachziehen). Absichtlich NIE blockierend:
 * ein Mensch KANN in 1,5s antworten (kurze Bestaetigung, "Danke!" o.ae.),
 * das allein ist kein hinreichend sicheres Bot-Signal fuer eine Sperre --
 * nur informativ vermerkt (immer action_taken='warned', nie 'rate_limited'). */
export const NO_READ_BEFORE_REPLY_THRESHOLD_MS = 1500;

export function computeBodyHash(bodyText: string): string {
  return createHash("sha256").update(bodyText.trim()).digest("hex");
}

export interface SendAbuseCheckInput {
  userId: string;
  /** to+cc+bcc, bereits lowercased+dedupliziert durch den Aufrufer. */
  recipients: string[];
  bodyText: string;
  isReply: boolean;
  timeSinceDraftShownMs: number | null;
}

export interface SendAbuseCheckResult {
  /** Gesetzt, wenn der Versand wegen wiederholtem Missbrauch abgelehnt werden soll (429). */
  blocked: { reason: AbuseFlagReason; message: string } | null;
  /** Gruende, die (nur wenn nicht blockiert) nach erfolgreichem Versand als 'warned' vermerkt werden sollen. */
  warnReasons: AbuseFlagReason[];
}

function humanMessage(reason: AbuseFlagReason): string {
  switch (reason) {
    case "rate_burst":
      return "Zu viele Sende-Vorgänge in kurzer Zeit. Bitte kurz warten und erneut versuchen.";
    case "many_new_recipients":
      return "Zu viele neue Empfänger in kurzer Zeit. Bitte kurz warten und erneut versuchen.";
    case "duplicate_content":
      return "Diese Nachricht wurde bereits mehrfach an unterschiedliche Empfänger gesendet. Bitte kurz warten und erneut versuchen.";
    default:
      return "Versand vorübergehend nicht möglich.";
  }
}

/** Wird VOR dem eigentlichen Versand aufgerufen (mail/sendMessage.ts) --
 * bei `blocked !== null` darf der Aufrufer NICHT an den Provider senden,
 * sondern muss 429 mit `blocked.message` zurückgeben und selbst
 * `store.createAbuseFlag({reason: blocked.reason, actionTaken:
 * 'rate_limited'})` aufrufen. Bei `blocked === null` sind die
 * `warnReasons` erst NACH erfolgreichem Versand als 'warned' zu
 * speichern (der eigentliche Sendeversuch selbst könnte noch am Provider
 * scheitern, siehe sendMessage.ts) -- diese Funktion selbst schreibt
 * bewusst nichts in send_abuse_flags, das bleibt Aufgabe des Aufrufers,
 * damit die Reihenfolge (erst wirklich senden, dann vermerken) an einer
 * Stelle sichtbar bleibt statt in dieser Funktion versteckt zu sein. */
export async function checkSendAbuse(store: Store, input: SendAbuseCheckInput): Promise<SendAbuseCheckResult> {
  const now = Date.now();
  const warnReasons: AbuseFlagReason[] = [];
  let blocked: SendAbuseCheckResult["blocked"] = null;

  async function evaluate(reason: AbuseFlagReason, triggered: boolean): Promise<void> {
    if (!triggered || blocked) return;
    const escalationSince = new Date(now - ESCALATION_WINDOW_MS).toISOString();
    const existing = await store.findRecentUnresolvedAbuseFlag(input.userId, reason, escalationSince);
    if (existing) {
      blocked = { reason, message: humanMessage(reason) };
    } else {
      warnReasons.push(reason);
    }
  }

  const recentSends = await store.countRecentOutgoingSends(input.userId, new Date(now - RATE_BURST_WINDOW_MS).toISOString());
  await evaluate("rate_burst", recentSends + input.recipients.length >= RATE_BURST_THRESHOLD);

  let newAmongCurrent = 0;
  for (const recipient of input.recipients) {
    if (!(await store.hasSentTo(input.userId, recipient))) newAmongCurrent++;
  }
  const recentNewRecipients = await store.countRecentNewRecipients(input.userId, new Date(now - NEW_RECIPIENTS_WINDOW_MS).toISOString());
  await evaluate("many_new_recipients", recentNewRecipients + newAmongCurrent >= NEW_RECIPIENTS_THRESHOLD);

  const bodyHash = computeBodyHash(input.bodyText);
  const recentDuplicateRecipients = await store.countRecentDuplicateContentRecipients(
    input.userId,
    bodyHash,
    new Date(now - DUPLICATE_CONTENT_WINDOW_MS).toISOString(),
  );
  await evaluate("duplicate_content", recentDuplicateRecipients + input.recipients.length >= DUPLICATE_CONTENT_THRESHOLD);

  // Nie blockierend, siehe Kommentar an der Konstante -- deshalb nicht ueber evaluate().
  if (
    !blocked &&
    input.isReply &&
    input.timeSinceDraftShownMs !== null &&
    input.timeSinceDraftShownMs < NO_READ_BEFORE_REPLY_THRESHOLD_MS
  ) {
    warnReasons.push("no_read_before_reply");
  }

  return { blocked, warnReasons };
}
