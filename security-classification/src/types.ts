// Spiegelt contracts/ai-adapter-interface.ts (dort liegt die verbindliche
// Definition, Track 0). Dieses Modul hält absichtlich eine eigene, minimale
// Kopie statt eines relativen Imports aus contracts/, damit
// security-classification/ als eigenständiges, verschiebbares Paket
// funktioniert (z.B. wenn Track A es später als npm-Dependency einbindet).
//
// Bei jeder Änderung an SecurityResult in contracts/ai-adapter-interface.ts
// muss diese Datei manuell nachgezogen werden -- siehe README.md
// "Contract-Sync".

export type Classification = "safe" | "spam" | "phishing" | "unclear";

export type AuthStatus = "pass" | "fail" | "none";

// Nur relevant wenn classification === "spam" (siehe SecurityResult.spamSubcategory
// unten). "adult"/"gambling" = eindeutig identifizierbarer Erotik-/
// Glücksspiel-Spam ohne Phishing-Risiko -> löst im Aufrufer (Track A) sofortiges
// Löschen statt Quarantäne/Spam-Ordner aus. "generic"/"marketing" = alles
// andere, Verhalten unverändert. Siehe WEB_INBOX.md 08.09. ("Neue
// Spam-Unterkategorie fuer aggressives Auto-Loeschen").
export type SpamSubcategory = "adult" | "gambling" | "generic" | "marketing";

export interface SecurityResult {
  spfStatus: AuthStatus;
  dkimStatus: AuthStatus;
  dmarcStatus: AuthStatus;
  senderDomainAgeDays: number | null;
  domainReputationScore: number | null; // 0.0 - 1.0
  homoglyphDetected: boolean;
  linkMismatchDetected: boolean;
  urgencyLanguageScore: number | null; // 0.0 - 1.0
  containsNewIban: boolean;
  classification: Classification;
  // Nur gesetzt wenn classification === "spam". Bei "phishing" (und
  // "safe"/"unclear") immer `null` -- das ist eine harte Contract-Regel,
  // keine Design-Entscheidung dieses Moduls.
  spamSubcategory: SpamSubcategory | null;
  confidenceScore: number; // 0.0 - 1.0
}
