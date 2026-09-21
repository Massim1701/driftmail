// driftmail — Track E (Antwort & Signatur)
//
// Typen, die 1:1 aus den Track-0-Contracts stammen (contracts/db-schema.sql,
// contracts/ai-adapter-interface.ts).
//
// [2026-09-21] KORREKTUR (Absenceresponder-Auftrag, WEB_INBOX.md 21.09.):
// vorher ein echter Cross-Package-Import ("../../contracts/..."). Das
// Modul hatte bis dahin nie einen "build"-Schritt/dist-Ausgabe und wurde
// nie von echtem Code konsumiert -- beim Nachziehen fuer den ersten
// echten Verbraucher (backend/, siehe Store/Route fuer /signatures) fiel
// auf: ein Cross-Package-Import ueber die Paketgrenze hinweg lässt `tsc`
// beim Bauen mit `outDir`/`declaration` das gemeinsame rootDir ueber
// mail-actions/ UND contracts/ hinweg berechnen -- das Ergebnis ist eine
// verschachtelte, nicht portable dist/-Struktur (dist/mail-actions/src/...
// statt dist/...), die `"main": "dist/index.js"` bricht. Jetzt lokal
// gespiegelt statt importiert, exakt das bereits etablierte Muster in
// backend/src/ai/types.ts und security-classification/ ("importiert
// bewusst nicht direkt aus contracts/, damit dieses Modul als
// eigenstaendiges npm-Package ohne Pfad-Abhaengigkeit ausserhalb seines
// eigenen Verzeichnisses baubar bleibt").

/** Spiegelt AiSource aus contracts/ai-adapter-interface.ts. */
export type AiSource = "on_device" | "cloud_fallback" | "heuristic";

/** Spiegelt MailThread aus contracts/ai-adapter-interface.ts. */
export interface MailThread {
  messages: Array<{
    fromAddress: string;
    subject: string;
    bodyText: string;
    receivedAt: string; // ISO datetime
  }>;
}

/** Spiegelt AiAdapterResult<T> aus contracts/ai-adapter-interface.ts. */
export interface AiAdapterResult<T> {
  data: T;
  source: AiSource;
}

/**
 * Spiegelt die Tabelle `signatures` aus contracts/db-schema.sql 1:1.
 * Feldnamen bewusst wie im DB-Schema (snake_case), damit eine spätere
 * Backend-Anbindung (Track A) diese Records ohne Mapping-Schicht
 * durchreichen kann.
 */
export interface SignatureRecord {
  id: string;
  mail_account_id: string;
  content_html: string;
  is_default: boolean;
  apply_to_new: boolean;
  apply_to_replies: boolean;
}

/** Kontext, in dem eine Signatur automatisch angehängt werden könnte. */
export type CompositionContext = "new" | "reply";
