// Externe Lookup-Adapter (SYNC.md 08.09., Web-Antwort auf die vier "wer
// macht den externen Lookup"-Fragen): security-classification/ (Track B)
// bleibt bewusst zustandslos (kein Netzwerk, keine DB) -- Track A macht ALLE
// VIER Lookups als eigenen Nachbearbeitungsschritt NACH dem Aufruf von
// aiAdapter.analyzeMail() bzw. checkDraftForPhishingMock(), siehe
// src/mail/sync.ts und src/routes/messages.ts.
//
// Gleiches Grundmuster wie src/ai/types.ts (AiAdapter): ein Interface pro
// externem Dienst, austauschbar gegen eine echte Implementierung, ohne dass
// Aufrufer (Sync-Pipeline/Routen) etwas davon merken. Die aktuellen
// Implementierungen (siehe *.Mock.ts in diesem Ordner) sind bewusst simple
// Mocks mit plausiblen, deterministischen Beispieldaten -- KEINE echten
// WHOIS-/Spamhaus-/Fraud-Datenbank-Abfragen. Der Austausch gegen eine echte
// Implementierung betrifft jeweils nur die eine Zeile in src/lookups/index.ts.

export interface DomainReputationResult {
  senderDomainAgeDays: number;
  domainReputationScore: number;
}

/** Reale Implementierung: WHOIS-Abfrage + Reputationsdienst für die
 * Absenderdomain. Mock: siehe domainReputationMock.ts. */
export interface DomainReputationLookup {
  lookup(domain: string): Promise<DomainReputationResult>;
}

export type IpReputationFlag = "clean" | "known_botnet" | "unknown";

/** Reale Implementierung: Abgleich gegen eine Spamhaus XBL/CBL-artige
 * Blockliste. Mock: siehe ipReputationMock.ts. `ip === null` (keine IP aus
 * den Headern extrahierbar) liefert immer "unknown", nie geraten -- analog
 * zum bisherigen Verhalten in src/ai/mockAdapter.ts. */
export interface IpReputationLookup {
  lookup(ip: string | null): Promise<IpReputationFlag>;
}

/** Reale Implementierung: Abgleich gegen die IBAN-Historie des Absenders in
 * einer echten DB (Postgres). Mock: In-Memory-Historie im bestehenden Store
 * (src/db/store.ts, ibanHistory), siehe ibanHistoryCheck.ts. "neu" heißt
 * laut Web-Antwort (SYNC.md 08.09.): noch nie zuvor von diesem Absender an
 * diesen User gesehen. Merkt sich als Seiteneffekt alle übergebenen IBANs
 * für künftige Aufrufe. */
export interface IbanHistoryCheck {
  checkAndRecord(userId: string, senderAddress: string, ibans: string[]): Promise<boolean>;
}

export type RecipientReputation = "safe" | "unknown" | "flagged";

/** Reale Implementierung: Abgleich der Empfänger-Adresse gegen
 * fraud_alerts/Empfänger-Historie in einer echten DB. Mock: gegen
 * store.outgoingSendLog (bereits erfolgreich angeschriebene Empfänger ->
 * "safe") und store.messages/messageSecurity (Empfänger-Adresse/-Domain war
 * schon einmal Absender einer als "phishing" klassifizierten eingehenden
 * Mail -> "flagged"), siehe recipientReputationMock.ts.
 * `recipientAddress === null` (nicht mitgeschickt) liefert immer "unknown". */
export interface RecipientReputationLookup {
  lookup(userId: string, recipientAddress: string | null): Promise<RecipientReputation>;
}

export type AttachmentScanStatus = "pending" | "clean" | "malicious" | "blocked_type" | "scan_failed";

export interface AttachmentScanResult {
  scanStatus: AttachmentScanStatus;
  isDangerousType: boolean;
}

/** Reale Implementierung: echter Virenscan-Dienst (z.B. ClamAV/VirusTotal),
 * siehe WEB_INBOX.md 09.09. "Erweiterung des Send-Endpunkt-Eintrags von
 * eben". Mock: einfache Dateiendungs-Prüfung, siehe attachmentScanMock.ts. */
export interface AttachmentScanner {
  scan(input: { filename: string; mimeType: string | null; sizeBytes: number }): Promise<AttachmentScanResult>;
}
