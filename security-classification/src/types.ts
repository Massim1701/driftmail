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
  confidenceScore: number; // 0.0 - 1.0
}
